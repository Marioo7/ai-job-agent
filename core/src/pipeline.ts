import {
  COLLECTIONS, contentFingerprint, detectJob, extractJobFields, isValidEmail, messageKey, normalizeText, scoreMatch, findTechnologies,
  type CvProfile, type Extracted, type Job, type MatchResult, type Preferences, type TelegramMessage,
} from '@ajaa/shared';
import { aiCall } from './ai/guard';
import { AiError, type AiExtraction, type AiProvider } from './ai/types';
import type { Db } from './db/types';
import { errMsg } from './errors';
import { audit, getActiveCv, getPreferences, nowIso } from './repo';

export interface PipelineDeps {
  db: Db;
  ai: AiProvider;
  aiDailyCap: number;
  now?: () => Date;
}

export interface IncomingMessage {
  sourceId: string;
  sourceName: string;
  messageId: string | number;
  date: string;
  text: string;
  sourceLink?: string | null;
  isDemo?: boolean;
}

export type ProcessResult = { status: 'duplicate' | 'ignored' | 'job' | 'error' | 'empty'; jobId?: string; error?: string };

export const MAX_ATTEMPTS = 5;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const appearsIn = (value: string | null | undefined, text: string): value is string => !!value && squash(text).includes(squash(value));
function mostlyAppearsIn(value: string | null, text: string): value is string {
  if (!value) return false;
  const words = squash(value).split(' ').filter((w) => w.length > 2);
  if (!words.length) return false;
  const t = squash(text);
  return words.filter((w) => t.includes(w)).length / words.length >= 0.6;
}

/**
 * AI output is never trusted blindly: factual fields (email, link, company, salary, deadline, location)
 * are accepted only if they literally occur in the original message. Heuristic values win on conflict.
 */
export function mergeAiExtraction(base: Extracted, ai: AiExtraction, text: string): Extracted {
  const out: Extracted = { ...base, emailCandidates: [...base.emailCandidates], technologies: [...base.technologies] };
  if (!out.title && mostlyAppearsIn(ai.title, text)) out.title = ai.title!.slice(0, 100);
  if (!out.company && appearsIn(ai.company, text)) out.company = ai.company;
  if (!out.location && appearsIn(ai.location, text)) out.location = ai.location;
  if (!out.workMode && ai.workMode) out.workMode = ai.workMode;
  if (!out.salary && appearsIn(ai.salary, text)) out.salary = ai.salary;
  if (!out.deadline && appearsIn(ai.deadline, text)) out.deadline = ai.deadline;
  if (!out.applicationEmail && isValidEmail(ai.applicationEmail) && appearsIn(ai.applicationEmail, text) && base.emailCandidates.length <= 1) out.applicationEmail = ai.applicationEmail.toLowerCase();
  if (!out.applicationLink && appearsIn(ai.applicationLink, text) && /^https?:\/\//i.test(ai.applicationLink!)) out.applicationLink = ai.applicationLink;
  if (out.experienceYears === null && ai.experienceYears !== null) out.experienceYears = ai.experienceYears;
  const known = new Set(out.technologies);
  for (const t of ai.technologies) {
    const found = findTechnologies(t);
    for (const f of found) if (!known.has(f) && appearsIn(t, text)) { known.add(f); out.technologies.push(f); }
  }
  return out;
}

async function evaluate(deps: PipelineDeps, uid: string, text: string, extracted: Extracted, prefs: Preferences, cv: CvProfile | null, wantAnalysis: boolean) {
  let match: MatchResult | null = null;
  let aiAnalysis: string | null = null;
  let aiError: string | null = null;
  if (cv) {
    match = scoreMatch({ extracted, text }, cv, prefs, deps.now?.());
    if (wantAnalysis && match.meetsFilters) {
      try {
        aiAnalysis = await aiCall(deps, uid, prefs.aiEnabled, () => deps.ai.analyzeMatch({ jobText: text, extracted, cv, match: match! }));
      } catch (e) { aiError = e instanceof AiError ? e.code : 'error'; }
    }
  }
  const status: Job['status'] = !match ? 'new' : match.meetsFilters ? 'matched' : 'low_match';
  return { match, aiAnalysis, aiError, status };
}

export async function processIncomingMessage(deps: PipelineDeps, uid: string, msg: IncomingMessage): Promise<ProcessResult> {
  const { db } = deps;
  const now = nowIso(deps.now?.());
  const text = normalizeText(msg.text ?? '');
  if (text.length < 20) return { status: 'empty' };

  const key = messageKey(uid, msg.sourceId, msg.messageId);
  const fingerprint = contentFingerprint(text);
  const record: TelegramMessage = {
    id: key, uid, sourceId: String(msg.sourceId), sourceName: msg.sourceName, messageId: String(msg.messageId), date: msg.date, text,
    sourceLink: msg.sourceLink ?? null, contentHash: fingerprint, processed: false, isJob: null, attempts: 0, error: null,
    duplicateOf: null, isDemo: !!msg.isDemo, createdAt: now, updatedAt: now,
  };

  // Duplicate prevention: atomic create on a deterministic id (source + message).
  const created = await db.create(COLLECTIONS.telegramMessages, key, record);
  let attempts = 0;
  if (!created) {
    const existing = await db.get<TelegramMessage>(COLLECTIONS.telegramMessages, key);
    if (!existing || existing.processed) return { status: 'duplicate' };
    if (existing.attempts >= MAX_ATTEMPTS) return { status: 'error', error: 'max_attempts_reached' };
    attempts = existing.attempts;
  }

  try {
    const det = detectJob(text);
    if (!det.isJob) {
      await db.update(COLLECTIONS.telegramMessages, key, { processed: true, isJob: false, updatedAt: now });
      return { status: 'ignored' };
    }

    // Same post cross-posted to another channel? An ATOMIC claim on the content fingerprint makes sure only one
    // job is ever created per post, even when two channels deliver it at the same instant (or from two processes).
    const claimId = `${uid}_${fingerprint}`;
    const won = await db.create(COLLECTIONS.jobKeys, claimId, { id: claimId, uid, jobId: key, createdAt: now });
    let ownerJobId = key;
    if (!won) ownerJobId = (await db.get<{ jobId: string }>(COLLECTIONS.jobKeys, claimId))?.jobId ?? key;
    if (ownerJobId === key) {
      // legacy/safety net: a job with the same fingerprint that predates the claim
      const same = await db.list<Job>(COLLECTIONS.jobs, { where: [['uid', '==', uid], ['contentHash', '==', fingerprint]], limit: 2 });
      const legacy = same.find((j) => j.id !== key);
      if (legacy) ownerJobId = legacy.id;
    }
    if (ownerJobId !== key) {
      await db.update(COLLECTIONS.telegramMessages, key, { processed: true, isJob: true, duplicateOf: ownerJobId, updatedAt: now });
      return { status: 'duplicate', jobId: ownerJobId };
    }

    const prefs = await getPreferences(db, uid);
    const cv = await getActiveCv(db, uid);
    let extracted = extractJobFields(text);
    let method: Job['extractionMethod'] = 'heuristic';
    let aiError: string | null = null;
    try {
      const ai = await aiCall(deps, uid, prefs.aiEnabled, () => deps.ai.extractJob(text));
      if (ai && ai.isJob !== false) { extracted = mergeAiExtraction(extracted, ai, text); method = 'heuristic+ai'; }
    } catch (e) { aiError = e instanceof AiError ? e.code : 'error'; }

    const ev = await evaluate(deps, uid, text, extracted, prefs, cv, true);
    const job: Job = {
      id: key, uid, sourceId: String(msg.sourceId), sourceName: msg.sourceName, messageId: String(msg.messageId), sourceLink: msg.sourceLink ?? null,
      messageDate: msg.date, originalText: text, contentHash: fingerprint, extracted, extractionMethod: method, match: ev.match,
      aiAnalysis: ev.aiAnalysis, aiError: aiError ?? ev.aiError, status: ev.status, userRelevance: null, autoChecked: false, isDemo: !!msg.isDemo, createdAt: now, updatedAt: now,
    };
    await db.create(COLLECTIONS.jobs, key, job); // false on retry after partial failure: keep existing doc
    await db.update(COLLECTIONS.telegramMessages, key, { processed: true, isJob: true, error: null, updatedAt: now });
    await audit(db, uid, 'job.detected', 'job', key, { score: ev.match?.score ?? null, demo: !!msg.isDemo });
    return { status: 'job', jobId: key };
  } catch (e) {
    await db.update(COLLECTIONS.telegramMessages, key, { attempts: attempts + 1, error: errMsg(e).slice(0, 200), updatedAt: now }).catch(() => undefined);
    return { status: 'error', error: errMsg(e) };
  }
}

/** Re-score a job against the current active CV and preferences (keeps user-edited extraction). */
export async function rescoreJob(deps: PipelineDeps, uid: string, job: Job): Promise<Job> {
  const prefs = await getPreferences(deps.db, uid);
  const cv = await getActiveCv(deps.db, uid);
  const ev = await evaluate(deps, uid, job.originalText, job.extracted, prefs, cv, true);
  const keep: Job['status'][] = ['saved', 'rejected', 'draft_ready', 'sent', 'failed'];
  const patch = { match: ev.match, aiAnalysis: ev.aiAnalysis ?? job.aiAnalysis, aiError: ev.aiError, status: keep.includes(job.status) ? job.status : ev.status, updatedAt: nowIso(deps.now?.()) };
  await deps.db.update(COLLECTIONS.jobs, job.id, patch);
  return { ...job, ...patch };
}

/** Worker recovery: retry messages stored but never fully processed (e.g. crash mid-pipeline). */
export async function reprocessPending(deps: PipelineDeps, uid: string): Promise<number> {
  const pending = await deps.db.list<TelegramMessage>(COLLECTIONS.telegramMessages, { where: [['uid', '==', uid], ['processed', '==', false]], limit: 50 });
  let n = 0;
  for (const m of pending) {
    const r = await processIncomingMessage(deps, uid, { sourceId: m.sourceId, sourceName: m.sourceName, messageId: m.messageId, date: m.date, text: m.text, sourceLink: m.sourceLink, isDemo: m.isDemo });
    if (r.status === 'job') n++;
  }
  return n;
}
