import cors from 'cors';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import {
  AppError, audit, computeContentHash, getActiveCv, editDraft, generateDraft, getPreferences, listCvs, activateCv, uploadCv,
  nowIso, pageByUid, processIncomingMessage, rejectDraft, rescoreJob, sendDraft, MAX_CV_BYTES,
  type AiProvider, type Config, type Db, type FileStore, type MailSender, type TokenVerifier,
} from '@ajaa/core';
import {
  COLLECTIONS, DEMO_MESSAGES, cvPatchSchema, draftGenerateSchema, draftPatchSchema, jobPatchSchema, preferencesSchema, sendSchema, sourceInputSchema,
  type Application, type CvProfile, type EmailDraft, type Job, type TelegramSource, type WorkerStatus,
} from '@ajaa/shared';
import { authMiddleware, errorHandler, parse, uidOf, wrap } from './middleware';

export interface AppDeps {
  config: Config;
  db: Db;
  files: FileStore;
  ai: AiProvider;
  mail: MailSender;
  verify: TokenVerifier;
}

const q1 = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function createApp(deps: AppDeps) {
  const { config, db, files, ai, mail } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_ORIGIN.split(',').map((s) => s.trim()), allowedHeaders: ['Authorization', 'Content-Type'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '300kb' }));

  const limiter = (windowMs: number, max: number): RequestHandler =>
    config.NODE_ENV === 'test' ? (_q, _s, n) => n() : rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } } });

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  // Public: OAuth redirect from Google. Trusted via signed, expiring `state` — not via a header.
  app.get('/api/integrations/gmail/callback', limiter(15 * 60_000, 30), wrap(async (req, res) => {
    const back = (s: string) => res.redirect(`${config.FRONTEND_ORIGIN.split(',')[0]!.trim()}/integrations?gmail=${s}`);
    const code = q1(req.query.code), state = q1(req.query.state);
    if (req.query.error || !code || !state) return back('error');
    try {
      const { uid } = await mail.handleCallback(code, state);
      await audit(db, uid, 'gmail.connected');
      return back('connected');
    } catch { return back('error'); }
  }));

  const api = express.Router();
  api.use(limiter(15 * 60_000, 600));
  api.use(authMiddleware(config, deps.verify));
  app.use('/api', api);

  const withHash = async (d: EmailDraft) => {
    const cv = await db.get<CvProfile>(COLLECTIONS.cvProfiles, d.cvVersionId);
    return { ...d, contentHash: cv ? computeContentHash(d, cv.sha256) : '' };
  };
  const own = async <T extends { uid: string }>(col: string, id: string, label: string): Promise<T> => {
    const doc = await db.get<T>(col, id);
    return doc ?? (() => { throw new AppError(404, `${label}_not_found`, `${label} not found.`); })();
  };
  const owned = async <T extends { uid: string }>(req: express.Request, col: string, id: string, label: string): Promise<T> => {
    const d = await own<T>(col, id, label);
    if (d.uid !== uidOf(req)) throw new AppError(404, `${label}_not_found`, `${label} not found.`);
    return d;
  };

  // ---------- me / dashboard
  api.get('/me', wrap(async (req, res) => {
    res.json({ uid: uidOf(req), email: req.user?.email ?? null, demoAuth: config.AUTH_MODE === 'demo', dbMode: config.DB_MODE });
  }));

  const workerView = async (uid: string) => {
    const w = await db.get<WorkerStatus>(COLLECTIONS.workerStatus, uid);
    if (!w) return { exists: false as const, online: false };
    const ageMs = Date.now() - Date.parse(w.lastHeartbeatAt);
    return { exists: true as const, ...w, online: w.state !== 'stopped' && ageMs < config.WORKER_OFFLINE_AFTER_SEC * 1000, heartbeatAgeSec: Math.round(ageMs / 1000) };
  };

  api.get('/dashboard', wrap(async (req, res) => {
    const uid = uidOf(req);
    const J = (s?: string) => db.count(COLLECTIONS.jobs, [['uid', '==', uid], ...(s ? [['status', '==', s] as [string, '==', string]] : [])]);
    const A = (s?: string) => db.count(COLLECTIONS.applications, [['uid', '==', uid], ...(s ? [['status', '==', s] as [string, '==', string]] : [])]);
    const [detected, matched, drafted, rejected, pendingApproval, appsAll, appsSent, appsFailed, activity, worker, demoJobs] = await Promise.all([
      J(), J('matched'), J('draft_ready'), J('rejected'),
      db.count(COLLECTIONS.emailDrafts, [['uid', '==', uid], ['status', '==', 'draft']]),
      A(), A('sent'), A('failed'),
      pageByUid(db, COLLECTIONS.auditLogs, uid, { orderField: 'createdAt', limit: 10 }),
      workerView(uid),
      db.count(COLLECTIONS.jobs, [['uid', '==', uid], ['isDemo', '==', true]]),
    ]);
    res.json({
      counts: { detected, matching: matched + drafted, awaitingReview: matched, pendingApproval, approved: appsAll, sent: appsSent, rejected, failed: appsFailed },
      recentActivity: activity.items, worker, demoJobs, autoApply: (await getPreferences(db, uid)).autoApply, autoApplyAllowed: config.ALLOW_AUTO_APPLY,
    });
  }));

  // ---------- preferences
  api.get('/preferences', wrap(async (req, res) => { res.json(await getPreferences(db, uidOf(req))); }));
  api.put('/preferences', wrap(async (req, res) => {
    const uid = uidOf(req);
    const { autoApply: aa, ...p } = parse(preferencesSchema, req.body);
    const prev = await getPreferences(db, uid);
    let autoApply = prev.autoApply;
    if (aa) {
      if (aa.enabled) {
        if (!config.ALLOW_AUTO_APPLY) throw new AppError(403, 'auto_apply_disabled', 'Automatic applying is disabled on this server (set ALLOW_AUTO_APPLY=true in the backend .env).');
        if (!prev.autoApply.enabled) {
          if (!aa.acknowledged) throw new AppError(400, 'ack_required', 'Tick the acknowledgement: emails will be sent without your review.');
          const cv = await getActiveCv(db, uid);
          if (!cv) throw new AppError(400, 'no_active_cv', 'Upload and activate a CV first.');
          if (!(p.fullName.trim() || cv.fullName.trim())) throw new AppError(400, 'name_required', 'Set your full name first (emails are signed with it).');
          if (!(await mail.status(uid)).connected) throw new AppError(400, 'gmail_not_connected', 'Connect Gmail first.');
          autoApply = { enabled: true, dailyLimit: aa.dailyLimit, enabledAt: nowIso() };
          await audit(db, uid, 'autoapply.enabled', null, null, { dailyLimit: aa.dailyLimit });
        } else autoApply = { ...prev.autoApply, dailyLimit: aa.dailyLimit };
      } else {
        autoApply = { ...prev.autoApply, enabled: false, dailyLimit: aa.dailyLimit };
        if (prev.autoApply.enabled) await audit(db, uid, 'autoapply.disabled');
      }
    }
    const doc = { ...p, autoApply, uid, updatedAt: nowIso() };
    await db.set(COLLECTIONS.userPreferences, uid, doc);
    await audit(db, uid, 'preferences.updated');
    res.json(doc);
  }));

  api.post('/auto-apply/pause', wrap(async (req, res) => {
    const uid = uidOf(req);
    const prefs = await getPreferences(db, uid);
    await db.set(COLLECTIONS.userPreferences, uid, { ...prefs, autoApply: { ...prefs.autoApply, enabled: false }, updatedAt: nowIso() });
    await audit(db, uid, 'autoapply.disabled');
    res.json({ ok: true });
  }));

  // ---------- jobs
  api.get('/jobs', wrap(async (req, res) => {
    const uid = uidOf(req);
    const status = q1(req.query.status), search = q1(req.query.q)?.toLowerCase();
    const minScore = req.query.minScore !== undefined ? Number(req.query.minScore) : undefined;
    const relevance = q1(req.query.relevance);
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const where: Array<[string, '==', unknown]> = status ? [['status', '==', status]] : [];
    const inMemory = !!search || minScore !== undefined || !!relevance;
    let cursor = q1(req.query.cursor) ?? null;
    const items: Job[] = [];
    for (let i = 0; i < (inMemory ? 6 : 1); i++) {
      const page = await pageByUid<Job & Record<string, unknown>>(db, COLLECTIONS.jobs, uid, { where, orderField: 'createdAt', limit: inMemory ? 100 : limit, cursor });
      for (const j of page.items) {
        if (search && !`${j.extracted.title} ${j.extracted.company} ${j.extracted.technologies.join(' ')} ${j.originalText}`.toLowerCase().includes(search)) continue;
        if (minScore !== undefined && (j.match?.score ?? -1) < minScore) continue;
        if (relevance && j.userRelevance !== relevance) continue;
        items.push(j);
      }
      cursor = page.nextCursor;
      if (!cursor || items.length >= limit) break;
    }
    const slice = items.slice(0, limit);
    res.json({ items: slice, nextCursor: cursor && (slice.length ? slice[slice.length - 1]!.createdAt : cursor) });
  }));

  api.post('/jobs/rescore', limiter(60 * 60_000, 20), wrap(async (req, res) => {
    const uid = uidOf(req);
    const page = await pageByUid<Job & Record<string, unknown>>(db, COLLECTIONS.jobs, uid, { orderField: 'createdAt', limit: 100 });
    let n = 0;
    for (const j of page.items) if (j.status !== 'sent') { await rescoreJob({ db, ai, aiDailyCap: config.AI_DAILY_CALL_CAP }, uid, j); n++; }
    res.json({ rescored: n });
  }));

  api.get('/jobs/:id', wrap(async (req, res) => {
    const uid = uidOf(req);
    const job = await owned<Job>(req, COLLECTIONS.jobs, req.params.id!, 'job');
    const draft = await db.get<EmailDraft>(COLLECTIONS.emailDrafts, `d_${job.id}`);
    const [a, b] = await Promise.all([
      db.list<{ createdAt: string }>(COLLECTIONS.auditLogs, { where: [['uid', '==', uid], ['entityId', '==', job.id]], orderBy: ['createdAt', 'desc'], limit: 20 }),
      draft ? db.list<{ createdAt: string }>(COLLECTIONS.auditLogs, { where: [['uid', '==', uid], ['entityId', '==', draft.id]], orderBy: ['createdAt', 'desc'], limit: 20 }) : Promise.resolve([]),
    ]);
    const history = [...a, ...b].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    res.json({ job, draft: draft && draft.uid === uid ? await withHash(draft) : null, history });
  }));

  api.patch('/jobs/:id', wrap(async (req, res) => {
    const uid = uidOf(req);
    const job = await owned<Job>(req, COLLECTIONS.jobs, req.params.id!, 'job');
    const p = parse(jobPatchSchema, req.body);
    if (job.status === 'sent') throw new AppError(409, 'job_locked', 'This job was already applied to.');
    const patch: Record<string, unknown> = { updatedAt: nowIso() };
    if (p.status) patch.status = p.status === 'new' ? (job.match ? (job.match.meetsFilters ? 'matched' : 'low_match') : 'new') : p.status;
    if (p.userRelevance !== undefined) patch.userRelevance = p.userRelevance;
    if (p.extracted) {
      const merged = { ...job.extracted };
      for (const [k, v] of Object.entries(p.extracted)) if (v !== undefined) (merged as Record<string, unknown>)[k] = k === 'applicationEmail' && typeof v === 'string' ? v.toLowerCase() : v;
      patch.extracted = merged;
      patch.autoChecked = false; // edited details (e.g. a newly added email) are looked at again by the automatic cycle
    }
    await db.update(COLLECTIONS.jobs, job.id, patch);
    await audit(db, uid, 'job.updated', 'job', job.id, { fields: Object.keys(patch).filter((k) => k !== 'updatedAt').join(',') });
    res.json({ ...job, ...patch });
  }));

  api.post('/jobs/:id/reanalyze', limiter(60 * 60_000, 60), wrap(async (req, res) => {
    const job = await owned<Job>(req, COLLECTIONS.jobs, req.params.id!, 'job');
    if (job.status === 'sent') throw new AppError(409, 'job_locked', 'This job was already applied to.');
    res.json(await rescoreJob({ db, ai, aiDailyCap: config.AI_DAILY_CALL_CAP }, uidOf(req), job));
  }));

  api.post('/jobs/:id/draft', limiter(60 * 60_000, 60), wrap(async (req, res) => {
    const uid = uidOf(req);
    await owned<Job>(req, COLLECTIONS.jobs, req.params.id!, 'job');
    const body = parse(draftGenerateSchema, req.body ?? {});
    res.json(await withHash(await generateDraft({ db, ai, aiDailyCap: config.AI_DAILY_CALL_CAP }, uid, req.params.id!, body)));
  }));

  // ---------- drafts (create/edit never send)
  api.get('/drafts', wrap(async (req, res) => {
    const status = q1(req.query.status);
    const page = await pageByUid<EmailDraft & Record<string, unknown>>(db, COLLECTIONS.emailDrafts, uidOf(req), {
      where: status ? [['status', '==', status]] : [], orderField: 'updatedAt', limit: Number(req.query.limit) || 25, cursor: q1(req.query.cursor) ?? null,
    });
    const jobs = await Promise.all(page.items.map((d) => db.get<Job>(COLLECTIONS.jobs, d.jobId)));
    res.json({ items: await Promise.all(page.items.map(async (d, i) => ({ ...(await withHash(d)), job: jobs[i] ? { id: jobs[i]!.id, title: jobs[i]!.extracted.title, company: jobs[i]!.extracted.company, score: jobs[i]!.match?.score ?? null } : null }))), nextCursor: page.nextCursor });
  }));
  api.get('/drafts/:id', wrap(async (req, res) => { res.json(await withHash(await owned<EmailDraft>(req, COLLECTIONS.emailDrafts, req.params.id!, 'draft'))); }));
  api.patch('/drafts/:id', wrap(async (req, res) => {
    res.json(await withHash(await editDraft(db, uidOf(req), req.params.id!, parse(draftPatchSchema, req.body))));
  }));
  api.post('/drafts/:id/reject', wrap(async (req, res) => { res.json(await rejectDraft(db, uidOf(req), req.params.id!)); }));
  api.post('/drafts/:id/send', limiter(60 * 60_000, 15), wrap(async (req, res) => {
    const { confirmation, contentHash } = parse(sendSchema, req.body);
    res.json(await sendDraft({ db, files, mail }, uidOf(req), req.params.id!, { confirmation, contentHash }));
  }));

  api.get('/applications', wrap(async (req, res) => {
    res.json(await pageByUid<Application & Record<string, unknown>>(db, COLLECTIONS.applications, uidOf(req), { orderField: 'createdAt', limit: Number(req.query.limit) || 25, cursor: q1(req.query.cursor) ?? null }));
  }));

  // ---------- CV
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CV_BYTES, files: 1 } });
  api.get('/cv', wrap(async (req, res) => {
    const list = await listCvs(db, uidOf(req));
    res.json(list.map(({ extractedText, ...rest }) => ({ ...rest, textLength: extractedText.length })));
  }));
  api.post('/cv', limiter(60 * 60_000, 20), upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw new AppError(400, 'invalid_request', 'Attach a PDF in the "file" field.');
    const cv = await uploadCv({ db, files }, uidOf(req), { buffer: req.file.buffer, originalName: req.file.originalname }, req.body?.activate !== 'false');
    res.status(201).json(cv);
  }));
  api.get('/cv/:id', wrap(async (req, res) => { res.json(await owned<CvProfile>(req, COLLECTIONS.cvProfiles, req.params.id!, 'cv')); }));
  api.put('/cv/:id', wrap(async (req, res) => {
    const cv = await owned<CvProfile>(req, COLLECTIONS.cvProfiles, req.params.id!, 'cv');
    const patch = { ...parse(cvPatchSchema, req.body), updatedAt: nowIso() };
    await db.update(COLLECTIONS.cvProfiles, cv.id, patch);
    await audit(db, uidOf(req), 'cv.edited', 'cv', cv.id);
    res.json({ ...cv, ...patch });
  }));
  api.post('/cv/:id/activate', wrap(async (req, res) => { await activateCv(db, uidOf(req), req.params.id!); res.json({ ok: true }); }));
  api.get('/cv/:id/download', wrap(async (req, res) => {
    const cv = await owned<CvProfile>(req, COLLECTIONS.cvProfiles, req.params.id!, 'cv');
    const buf = await files.read(cv.storagePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${cv.fileName.replace(/[^\w.\- ]+/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }));

  // ---------- Telegram sources
  api.get('/sources', wrap(async (req, res) => {
    res.json(await db.list<TelegramSource>(COLLECTIONS.telegramSources, { where: [['uid', '==', uidOf(req)]], limit: 100 }));
  }));
  api.post('/sources', wrap(async (req, res) => {
    const uid = uidOf(req);
    const p = parse(sourceInputSchema, req.body);
    if ((await db.count(COLLECTIONS.telegramSources, [['uid', '==', uid]])) >= 50) throw new AppError(400, 'too_many_sources', 'Source limit (50) reached.');
    const now = nowIso();
    const s: TelegramSource = { id: `src_${randomUUID()}`, uid, ref: p.ref, title: p.title || p.ref, enabled: p.enabled ?? true, resolvedId: null, username: null, lastMessageId: 0, lastSyncAt: null, lastError: null, createdAt: now, updatedAt: now };
    await db.set(COLLECTIONS.telegramSources, s.id, s);
    await audit(db, uid, 'source.added', 'source', s.id);
    res.status(201).json(s);
  }));
  api.put('/sources/:id', wrap(async (req, res) => {
    const s = await owned<TelegramSource>(req, COLLECTIONS.telegramSources, req.params.id!, 'source');
    const p = parse(sourceInputSchema.partial(), req.body);
    const patch: Partial<TelegramSource> = { updatedAt: nowIso() };
    if (p.title !== undefined) patch.title = p.title;
    if (p.enabled !== undefined) patch.enabled = p.enabled;
    if (p.ref !== undefined && p.ref !== s.ref) { patch.ref = p.ref; patch.resolvedId = null; patch.username = null; patch.lastMessageId = 0; }
    await db.update(COLLECTIONS.telegramSources, s.id, patch);
    res.json({ ...s, ...patch });
  }));
  api.delete('/sources/:id', wrap(async (req, res) => {
    const s = await owned<TelegramSource>(req, COLLECTIONS.telegramSources, req.params.id!, 'source');
    await db.delete(COLLECTIONS.telegramSources, s.id);
    await audit(db, uidOf(req), 'source.removed', 'source', s.id);
    res.json({ ok: true });
  }));

  // ---------- worker status
  api.get('/worker/status', wrap(async (req, res) => { res.json(await workerView(uidOf(req))); }));
  api.post('/worker/test', limiter(60_000, 6), wrap(async (req, res) => {
    const uid = uidOf(req);
    const w = await db.get<WorkerStatus>(COLLECTIONS.workerStatus, uid);
    if (!w) throw new AppError(409, 'worker_never_started', 'The worker has never reported in. Start it first (see docs/WORKER.md).');
    const at = nowIso();
    await db.update(COLLECTIONS.workerStatus, uid, { testRequestedAt: at });
    res.json({ requestedAt: at });
  }));

  // ---------- integrations
  api.get('/integrations', wrap(async (req, res) => {
    const uid = uidOf(req);
    const gmail = await mail.status(uid);
    const w = await workerView(uid);
    res.json({
      uid,
      gmail,
      ai: { provider: ai.name, enabled: ai.enabled, mock: ai.isMock, externalProcessing: ai.enabled && !ai.isMock, model: config.AI_MODEL || null, maxInputChars: config.AI_MAX_INPUT_CHARS, dailyCap: config.AI_DAILY_CALL_CAP },
      telegram: { mode: w.exists ? w.mode : config.TELEGRAM_MODE, connected: w.exists ? w.telegramConnected : false, workerOnline: w.online },
      storage: config.STORAGE_MODE, database: config.DB_MODE, authMode: config.AUTH_MODE,
    });
  }));
  api.post('/integrations/gmail/auth-url', limiter(60_000, 10), wrap(async (req, res) => { res.json({ url: await mail.authUrl(uidOf(req)) }); }));
  api.post('/integrations/gmail/test', limiter(60_000, 10), wrap(async (req, res) => { res.json(await mail.test(uidOf(req))); }));
  api.post('/integrations/gmail/disconnect', wrap(async (req, res) => {
    await mail.disconnect(uidOf(req));
    await audit(db, uidOf(req), 'gmail.disconnected');
    res.json({ ok: true });
  }));

  // ---------- audit + demo
  api.get('/audit', wrap(async (req, res) => {
    res.json(await pageByUid(db, COLLECTIONS.auditLogs, uidOf(req), { orderField: 'createdAt', limit: Number(req.query.limit) || 50, cursor: q1(req.query.cursor) ?? null }));
  }));

  api.post('/demo/seed', limiter(60_000, 5), wrap(async (req, res) => {
    if (config.NODE_ENV === 'production') throw new AppError(403, 'demo_disabled', 'Demo data is disabled in production.');
    const uid = uidOf(req);
    const results = [];
    for (const [i, m] of DEMO_MESSAGES.entries()) {
      results.push(await processIncomingMessage({ db, ai, aiDailyCap: config.AI_DAILY_CALL_CAP }, uid, { sourceId: 'demo', sourceName: 'DEMO source', messageId: i + 1, date: nowIso(), text: m.text, isDemo: true }));
    }
    await audit(db, uid, 'demo.seeded');
    res.json({ results: results.map((r) => r.status) });
  }));

  api.use((_req, _res, next) => next(new AppError(404, 'not_found', 'Route not found.')));
  app.use(errorHandler);
  return app;
}

