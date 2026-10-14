import { COLLECTIONS, type Application, type CvProfile, type EmailDraft } from '@ajaa/shared';
import { checkSendAllowed } from './approval';
import type { Db } from './db/types';
import { AppError, errMsg } from './errors';
import type { FileStore } from './storage';
import type { MailSender } from './gmail/gmail';
import { audit, nowIso } from './repo';

/** Same recipient + same subject (title/company) already sent => this is the same job applied to twice. */
export async function findDuplicateApplication(db: Db, uid: string, to: string, subject: string, exceptId: string): Promise<Application | null> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  // equality-only query on the recipient: reads only that recipient's applications (cheap on the free Firestore quota)
  const apps = await db.list<Application>(COLLECTIONS.applications, { where: [['uid', '==', uid], ['to', '==', to.toLowerCase()], ['status', '==', 'sent']], limit: 50 });
  return apps.find((a) => a.id !== exceptId && norm(a.subject) === norm(subject)) ?? null;
}

/**
 * The only code path that sends an email.
 *  1. pure approval gate (owner, explicit confirmation, content-hash of what the user reviewed, recipient…)
 *  2. atomic claim draft -> sending (compare-and-set) so concurrent/duplicate requests cannot both send
 *  3. send; record result on application, draft and job
 * A crash between "provider accepted" and "recorded" leaves status `sending`, which is never auto-retried
 * (documented): the user must check the Gmail Sent folder first, so a duplicate email can't be sent silently.
 */
export async function sendDraft(
  deps: { db: Db; files: FileStore; mail: MailSender },
  uid: string, draftId: string, input: { confirmation: unknown; contentHash: unknown; auto?: boolean },
): Promise<Application> {
  const { db } = deps;
  const draft = await db.get<EmailDraft>(COLLECTIONS.emailDrafts, draftId);
  const cv = draft ? await db.get<CvProfile>(COLLECTIONS.cvProfiles, draft.cvVersionId) : null;
  const check = checkSendAllowed({ draft, actingUid: uid, confirmation: input.confirmation, contentHash: input.contentHash, cv });
  if (!check.ok) {
    await audit(db, uid, 'send.blocked', 'draft', draftId, { code: check.code });
    throw new AppError(check.status, check.code, check.message);
  }
  const d = draft!;
  const c = cv!;
  if (await findDuplicateApplication(db, uid, d.to!, d.subject, d.id)) {
    await audit(db, uid, 'send.blocked', 'draft', d.id, { code: 'duplicate_application' });
    throw new AppError(409, 'duplicate_application', 'You already applied to this recipient with the same subject (same job). Not sending again.');
  }

  const claimed = await db.compareAndSet(COLLECTIONS.emailDrafts, d.id, { status: d.status, version: d.version }, { status: 'sending', updatedAt: nowIso() });
  if (!claimed) throw new AppError(409, 'already_sending', 'This email is already being sent.');

  const prev = await db.get<Application>(COLLECTIONS.applications, d.id);
  const now = nowIso();
  const app: Application = {
    id: d.id, uid, jobId: d.jobId, draftId: d.id, to: d.to!.toLowerCase(), subject: d.subject, body: d.body, cvVersionId: c.id, cvFileName: c.fileName,
    status: 'sending', attempts: (prev?.attempts ?? 0) + 1, gmailMessageId: null, simulated: false, autoApplied: !!input.auto, error: null, sentAt: null, createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
  await db.set(COLLECTIONS.applications, app.id, app);
  await audit(db, uid, 'send.approved', 'draft', d.id, { attempt: app.attempts, auto: !!input.auto });

  try {
    const file = await deps.files.read(c.storagePath);
    const r = await deps.mail.send(uid, { to: d.to!, subject: d.subject, body: d.body, attachment: { filename: c.fileName, contentType: 'application/pdf', data: file } });
    const done = nowIso();
    const sent = { status: 'sent' as const, gmailMessageId: r.messageId, simulated: r.simulated, sentAt: done, updatedAt: done, error: null };
    await db.update(COLLECTIONS.applications, app.id, sent);
    await db.update(COLLECTIONS.emailDrafts, d.id, { status: 'sent', approval: { approvedAt: now, approvedBy: uid, contentHash: input.contentHash as string }, lastError: null, updatedAt: done });
    await db.update(COLLECTIONS.jobs, d.jobId, { status: 'sent', updatedAt: done });
    await audit(db, uid, 'send.succeeded', 'application', app.id, { simulated: r.simulated });
    return { ...app, ...sent };
  } catch (e) {
    const msg = errMsg(e).slice(0, 300);
    const t = nowIso();
    await db.update(COLLECTIONS.applications, app.id, { status: 'failed', error: msg, updatedAt: t });
    await db.update(COLLECTIONS.emailDrafts, d.id, { status: 'failed', lastError: msg, updatedAt: t });
    await db.update(COLLECTIONS.jobs, d.jobId, { status: 'failed', updatedAt: t });
    await audit(db, uid, 'send.failed', 'application', app.id, { error: msg });
    throw new AppError(502, 'send_failed', `Sending failed: ${msg}. You can review and retry.`);
  }
}
