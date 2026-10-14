import { COLLECTIONS, buildTemplateDraft, type EmailDraft, type Job, type Lang } from '@ajaa/shared';
import { aiCall } from './ai/guard';
import { AiError, type AiProvider } from './ai/types';
import type { Db } from './db/types';
import { AppError } from './errors';
import { audit, getActiveCv, getPreferences, nowIso } from './repo';

export const draftIdFor = (jobId: string) => `d_${jobId}`;

/**
 * Creates or regenerates the single draft for a job. NEVER sends anything.
 * One draft per job (deterministic id) also prevents accidental duplicate applications.
 */
export async function generateDraft(
  deps: { db: Db; ai: AiProvider; aiDailyCap: number },
  uid: string, jobId: string, opts: { language?: Lang; to?: string | null; useAi?: boolean } = {},
): Promise<EmailDraft> {
  const { db } = deps;
  const job = await db.get<Job>(COLLECTIONS.jobs, jobId);
  if (!job || job.uid !== uid) throw new AppError(404, 'job_not_found', 'Job not found.');
  const cv = await getActiveCv(db, uid);
  if (!cv) throw new AppError(400, 'no_active_cv', 'Upload and activate a CV first.');
  const existing = await db.get<EmailDraft>(COLLECTIONS.emailDrafts, draftIdFor(jobId));
  if (existing && (existing.status === 'sent' || existing.status === 'sending')) throw new AppError(409, 'draft_locked', 'This application was already sent or is being sent.');

  const prefs = await getPreferences(db, uid);
  const language = opts.language ?? prefs.emailLanguage;
  const fullName = prefs.fullName || cv.fullName;
  const matched = job.match?.matchedSkills ?? [];
  let text = buildTemplateDraft({ extracted: job.extracted, cv, matchedSkills: matched, language, fullName });
  let generatedBy: EmailDraft['generatedBy'] = 'template';
  let lastError: string | null = null;

  if (opts.useAi !== false && deps.ai.enabled && prefs.aiEnabled) {
    try {
      const r = await aiCall(deps, uid, prefs.aiEnabled, () => deps.ai.writeEmail({ jobText: job.originalText, extracted: job.extracted, cv, matchedSkills: matched, language, fullName }));
      if (r) { text = r; generatedBy = deps.ai.isMock ? 'template' : 'ai'; }
    } catch (e) {
      lastError = e instanceof AiError ? `AI unavailable (${e.code}); template used.` : 'AI failed; template used.';
    }
  }

  let to = job.extracted.applicationEmail;
  let toSource: EmailDraft['toSource'] = to ? 'source' : null;
  if (opts.to !== undefined) { to = opts.to ? opts.to.toLowerCase() : opts.to; toSource = opts.to ? 'user' : null; }
  else if (existing?.toSource === 'user') { to = existing.to; toSource = 'user'; }

  const now = nowIso();
  const draft: EmailDraft = {
    id: draftIdFor(jobId), uid, jobId, to, toSource, subject: text.subject, body: text.body, notes: existing?.notes ?? '', language,
    cvVersionId: cv.id, cvFileName: cv.fileName, generatedBy, status: 'draft', version: (existing?.version ?? 0) + 1,
    approval: null, lastError, createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  await db.set(COLLECTIONS.emailDrafts, draft.id, draft);
  await db.update(COLLECTIONS.jobs, jobId, { status: 'draft_ready', updatedAt: now });
  await audit(db, uid, existing ? 'draft.regenerated' : 'draft.created', 'draft', draft.id, { generatedBy });
  return draft;
}

/** Edits never send. Any edit invalidates a previous approval and resets status to draft. */
export async function editDraft(db: Db, uid: string, draftId: string, patch: { to?: string | null; subject?: string; body?: string; notes?: string }): Promise<EmailDraft> {
  const d = await db.get<EmailDraft>(COLLECTIONS.emailDrafts, draftId);
  if (!d || d.uid !== uid) throw new AppError(404, 'draft_not_found', 'Draft not found.');
  if (d.status === 'sending' || d.status === 'sent') throw new AppError(409, 'draft_locked', 'This email was already sent or is being sent.');
  const next: EmailDraft = {
    ...d,
    ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.to !== undefined ? { to: patch.to ? patch.to.toLowerCase() : patch.to, toSource: patch.to ? ('user' as const) : null } : {}),
    status: 'draft', approval: null, version: d.version + 1, updatedAt: nowIso(),
  };
  await db.set(COLLECTIONS.emailDrafts, d.id, next);
  await audit(db, uid, 'draft.edited', 'draft', d.id);
  return next;
}

export async function rejectDraft(db: Db, uid: string, draftId: string): Promise<EmailDraft> {
  const d = await db.get<EmailDraft>(COLLECTIONS.emailDrafts, draftId);
  if (!d || d.uid !== uid) throw new AppError(404, 'draft_not_found', 'Draft not found.');
  if (d.status === 'sending' || d.status === 'sent') throw new AppError(409, 'draft_locked', 'This email was already sent or is being sent.');
  const now = nowIso();
  await db.update(COLLECTIONS.emailDrafts, d.id, { status: 'rejected', approval: null, updatedAt: now });
  await db.update(COLLECTIONS.jobs, d.jobId, { status: 'rejected', updatedAt: now });
  await audit(db, uid, 'draft.rejected', 'draft', d.id);
  return { ...d, status: 'rejected', approval: null, updatedAt: now };
}
