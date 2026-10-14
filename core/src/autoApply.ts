import { COLLECTIONS, PLACEHOLDER_RE, isValidEmail, scoreMatch, type EmailDraft, type Job } from '@ajaa/shared';
import type { AiProvider } from './ai/types';
import { computeContentHash } from './approval';
import type { Db } from './db/types';
import { draftIdFor, generateDraft, rejectDraft } from './drafts';
import { errMsg } from './errors';
import { log } from './logger';
import { audit, getActiveCv, getPreferences, nowIso } from './repo';
import { findDuplicateApplication, sendDraft } from './send';
import type { FileStore } from './storage';
import type { MailSender } from './gmail/gmail';

export interface AutoDeps { db: Db; ai: AiProvider; files: FileStore; mail: MailSender; aiDailyCap: number }

const MAX_PER_TICK = 5;
const RESERVED = /(^|\.)(example\.(com|org|net)|invalid|test|localhost)$|\.example$/i;
const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster)@/i;
const running = new Set<string>();

/** "Clear and valid" application address: well-formed, not a no-reply/bounce box, not a reserved/test domain (unless mail is simulated). */
export function isClearApplicationEmail(email: string | null | undefined, allowReserved: boolean): email is string {
  if (!isValidEmail(email)) return false;
  const [local, domain] = email.split('@') as [string, string];
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.split('.').some((l) => !l || l.startsWith('-') || l.endsWith('-'))) return false;
  if (NO_REPLY.test(email)) return false;
  if (!allowReserved && RESERVED.test(domain)) return false;
  return true;
}

/**
 * OPTIONAL hands-free mode (opt-in). The rules are simple:
 *   SEND  <=> there is a clear, valid application email in the post itself.
 *   No email => the job is simply saved (nothing is sent, nothing is guessed).
 * Not used as reasons to skip: match score, specialty, seniority level, years of experience.
 * Still enforced (safety, not preference):
 *   - only jobs created AFTER automatic mode was switched on (no blasting the old backlog)
 *   - the user's own blacklist (excluded companies/keywords) and "marked irrelevant"
 *   - never the same job twice: one draft/application per job, cross-posts are merged at ingestion, and
 *     the same recipient + same subject is never emailed again
 *   - unresolved placeholders (e.g. "[Your name]") block sending
 *   - daily limit (user setting), max 5 per cycle
 *   - the first failed send pauses automatic mode (no retry loops)
 * Every send still goes through sendDraft(), the same gate manual sends use.
 *
 * Firestore-quota friendly: every job is looked at ONCE (`autoChecked`), the daily counter lives in one tiny doc,
 * and an idle cycle costs ~3 reads.
 */
export async function autoApplyTick(deps: AutoDeps, uid: string, now: Date = new Date()): Promise<{ sent: number; skipped: number; paused: boolean }> {
  const out = { sent: 0, skipped: 0, paused: false };
  if (running.has(uid)) return out;
  running.add(uid);
  try {
    const { db } = deps;
    const prefs = await getPreferences(db, uid);
    const aa = prefs.autoApply;
    if (!aa.enabled || !aa.enabledAt) return out;

    const today = now.toISOString().slice(0, 10);
    const st = await db.get<{ date: string; count: number }>(COLLECTIONS.autoApplyState, uid);
    let sentToday = st && st.date === today ? st.count : 0;
    if (sentToday >= aa.dailyLimit) return out;

    const cv = await getActiveCv(db, uid);
    if (!cv) return out;
    const jobs = await db.list<Job>(COLLECTIONS.jobs, { where: [['uid', '==', uid], ['autoChecked', '==', false]], orderBy: ['createdAt', 'asc'], limit: 50 });
    if (!jobs.length) return out;

    const done = (job: Job) => db.update(COLLECTIONS.jobs, job.id, { autoChecked: true });

    for (const job of jobs) {
      if (sentToday >= aa.dailyLimit || out.sent >= MAX_PER_TICK) break; // left unchecked: handled next cycle / tomorrow
      const email = job.extracted.applicationEmail;
      if (
        !['new', 'matched'].includes(job.status) || job.createdAt < aa.enabledAt || job.userRelevance === 'irrelevant' ||
        !isClearApplicationEmail(email, deps.mail.mode === 'mock') || (job.isDemo && deps.mail.mode !== 'mock')
      ) { out.skipped++; await done(job); continue; } // no clear email => the job stays saved, nothing is sent

      const m = scoreMatch({ extracted: job.extracted, text: job.originalText }, cv, prefs, now);
      if (m.excluded) { out.skipped++; await done(job); continue; }
      if (await db.get<EmailDraft>(COLLECTIONS.emailDrafts, draftIdFor(job.id))) { out.skipped++; await done(job); continue; }
      await db.update(COLLECTIONS.jobs, job.id, { match: m, autoChecked: true, updatedAt: nowIso(now) });

      const draft = await generateDraft(deps, uid, job.id, { useAi: false });
      if (PLACEHOLDER_RE.test(draft.body) || PLACEHOLDER_RE.test(draft.subject)) {
        out.skipped++;
        await audit(db, uid, 'autoapply.skipped', 'job', job.id, { reason: 'name_missing' });
        continue;
      }
      if (await findDuplicateApplication(db, uid, draft.to!, draft.subject, draft.id)) {
        await rejectDraft(db, uid, draft.id);
        out.skipped++;
        await audit(db, uid, 'autoapply.skipped', 'job', job.id, { reason: 'duplicate_application' });
        continue;
      }
      try {
        await sendDraft(deps, uid, draft.id, { confirmation: 'SEND', contentHash: computeContentHash(draft, cv.sha256), auto: true });
        out.sent++; sentToday++;
        await db.set(COLLECTIONS.autoApplyState, uid, { id: uid, uid, date: today, count: sentToday });
      } catch (e) {
        await db.update(COLLECTIONS.userPreferences, uid, { autoApply: { ...aa, enabled: false }, updatedAt: nowIso(now) });
        await audit(db, uid, 'autoapply.paused', 'job', job.id, { reason: errMsg(e).slice(0, 150) });
        log('error', 'autoapply_paused', { error: e });
        out.paused = true;
        break;
      }
    }
    return out;
  } finally { running.delete(uid); }
}
