import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MemoryDb, MemoryFileStore, MockMailSender, MockProvider, autoApplyTick, loadConfig, makePdf, SAMPLE_CV_LINES, type TokenVerifier } from '@ajaa/core';
import { COLLECTIONS, type Application, type Job } from '@ajaa/shared';
import { createApp } from './app';

const KEY = Buffer.alloc(32, 3).toString('base64');
function build(env: Record<string, string> = {}, verify: TokenVerifier = async () => { throw new Error('no'); }) {
  const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'demo', DB_MODE: 'memory', SECRETS_ENCRYPTION_KEY: KEY, ...env });
  const mail = new MockMailSender();
  const app = createApp({ config, db: new MemoryDb(), files: new MemoryFileStore(), ai: new MockProvider(), mail, verify });
  return { app, mail };
}
const as = (u = 'demo') => ({ Authorization: `Bearer ${u}` });

describe('authentication', () => {
  it('rejects missing and malformed tokens', async () => {
    const { app } = build();
    expect((await request(app).get('/api/jobs')).status).toBe(401);
    expect((await request(app).get('/api/jobs').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
  it('verifies Firebase tokens and enforces the single-user allow-list', async () => {
    const verify = async (t: string) => {
      if (t === 'good') return { uid: 'u1', email: 'me@example.com' };
      if (t === 'other') return { uid: 'u2', email: 'stranger@example.com' };
      throw new Error('invalid');
    };
    const { app } = build({ AUTH_MODE: 'firebase', ALLOWED_EMAILS: 'me@example.com' }, verify);
    expect((await request(app).get('/api/me').set(as('bad'))).status).toBe(401);
    expect((await request(app).get('/api/me').set(as('other'))).status).toBe(403);
    expect((await request(app).get('/api/me').set(as('good'))).status).toBe(200);
    const open = build({ AUTH_MODE: 'firebase' }, verify); // no allow-list configured => deny everyone
    expect((await request(open.app).get('/api/me').set(as('good'))).status).toBe(403);
  });
  it('the demo token is rejected outside demo mode', async () => {
    const { app } = build({ AUTH_MODE: 'firebase', ALLOWED_EMAILS: 'me@example.com' });
    expect((await request(app).get('/api/me').set(as('demo'))).status).toBe(401);
  });
});

describe('end-to-end application flow with approval', () => {
  it('seed -> CV -> draft -> blocked send -> confirmed send; and user isolation', async () => {
    const { app, mail } = build();
    const A = as('demo:alice'), B = as('demo:bob');

    expect((await request(app).post('/api/cv').set(A).attach('file', Buffer.from('MZ fake exe'), 'cv.pdf')).status).toBe(415);
    const up = await request(app).post('/api/cv').set(A).attach('file', makePdf(SAMPLE_CV_LINES), 'cv.pdf');
    expect(up.status).toBe(201);
    expect(up.body.skills).toEqual(expect.arrayContaining(['react', 'typescript']));

    expect((await request(app).post('/api/demo/seed').set(A)).status).toBe(200);
    const jobs = (await request(app).get('/api/jobs').set(A)).body.items as Array<{ id: string; extracted: { applicationEmail: string | null }; isDemo: boolean }>;
    expect(jobs.length).toBe(3);
    expect(jobs.every((j) => j.isDemo)).toBe(true);
    const job = jobs.find((j) => j.extracted.applicationEmail === 'careers@example.com')!;

    // isolation
    expect((await request(app).get('/api/jobs').set(B)).body.items).toHaveLength(0);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(B)).status).toBe(404);
    expect((await request(app).post(`/api/jobs/${job.id}/draft`).set(B).send({})).status).toBe(404);

    const d = await request(app).post(`/api/jobs/${job.id}/draft`).set(A).send({});
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('draft');
    expect(mail.sent).toHaveLength(0);

    expect((await request(app).post(`/api/drafts/${d.body.id}/send`).set(B).send({ confirmation: 'SEND', contentHash: d.body.contentHash })).status).toBe(404);
    expect((await request(app).post(`/api/drafts/${d.body.id}/send`).set(A).send({})).status).toBe(400);
    expect((await request(app).post(`/api/drafts/${d.body.id}/send`).set(A).send({ confirmation: 'yes', contentHash: d.body.contentHash })).status).toBe(400);
    expect((await request(app).post(`/api/drafts/${d.body.id}/send`).set(A).send({ confirmation: 'SEND', contentHash: 'a'.repeat(64) })).status).toBe(409);
    expect(mail.sent).toHaveLength(0);

    const edited = await request(app).patch(`/api/drafts/${d.body.id}`).set(A).send({ subject: 'Application – Senior React Developer' });
    expect(edited.status).toBe(200);
    expect(mail.sent).toHaveLength(0);

    const sent = await request(app).post(`/api/drafts/${d.body.id}/send`).set(A).send({ confirmation: 'SEND', contentHash: edited.body.contentHash });
    expect(sent.status).toBe(200);
    expect(sent.body.simulated).toBe(true);
    expect(mail.sent).toHaveLength(1);
    const again = await request(app).post(`/api/drafts/${d.body.id}/send`).set(A).send({ confirmation: 'SEND', contentHash: edited.body.contentHash });
    expect(again.status).toBe(409);
    expect(mail.sent).toHaveLength(1);

    const dash = (await request(app).get('/api/dashboard').set(A)).body;
    expect(dash.counts.sent).toBe(1);
    expect(dash.counts.detected).toBe(3);
    expect((await request(app).get('/api/dashboard').set(B)).body.counts.detected).toBe(0);
  });

  it('validates input and never exposes stored secrets via the integrations endpoint', async () => {
    const { app } = build();
    expect((await request(app).put('/api/preferences').set(as()).send({ uiLanguage: 'xx' })).status).toBe(400);
    const r = await request(app).get('/api/integrations').set(as());
    expect(JSON.stringify(r.body)).not.toMatch(/token|secret|session/i);
  });

  it('automatic mode needs server permission and an explicit acknowledgement', async () => {
    const prefs = { preferredTechnologies: [], jobTitles: [], workModes: [], locations: [], experienceLevel: 'any', excludedCompanies: [], excludedKeywords: [], weights: { skills: 35, experience: 20, seniority: 10, location: 15, titles: 10, qualifications: 10 }, uiLanguage: 'en', emailLanguage: 'en', fullName: 'John Carter', aiEnabled: true };
    const on = { ...prefs, autoApply: { enabled: true, dailyLimit: 5, acknowledged: true } };
    const blocked = build();
    expect((await request(blocked.app).put('/api/preferences').set(as()).send(on)).status).toBe(403);
    const { app } = build({ ALLOW_AUTO_APPLY: 'true', OWNER_UID: 'demo-user' });
    expect((await request(app).put('/api/preferences').set(as()).send(on)).status).toBe(400); // no CV yet
    await request(app).post('/api/cv').set(as()).attach('file', makePdf(SAMPLE_CV_LINES), 'cv.pdf');
    expect((await request(app).put('/api/preferences').set(as()).send({ ...on, autoApply: { ...on.autoApply, acknowledged: false } })).status).toBe(400);
    const ok = await request(app).put('/api/preferences').set(as()).send(on);
    expect(ok.status).toBe(200);
    expect(ok.body.autoApply.enabled).toBe(true);
    expect(ok.body.autoApply.enabledAt).toBeTruthy();
    expect((await request(app).post('/api/auto-apply/pause').set(as())).status).toBe(200);
    expect((await request(app).get('/api/preferences').set(as())).body.autoApply.enabled).toBe(false);
  });

  it('worker is reported offline only after WORKER_OFFLINE_AFTER_SEC without a heartbeat', async () => {
    const mk = (env: Record<string, string>) => {
      const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'demo', DB_MODE: 'memory', SECRETS_ENCRYPTION_KEY: KEY, ...env });
      const db = new MemoryDb();
      return { db, app: createApp({ config, db, files: new MemoryFileStore(), ai: new MockProvider(), mail: new MockMailSender(), verify: async () => { throw new Error('no'); } }) };
    };
    const beat = { uid: 'demo-user', state: 'running', mode: 'real', telegramConnected: true, startedAt: '', lastUpdateAt: null, lastCatchUpAt: null, lastError: null, testRequestedAt: null, testResult: null, version: '1', lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() };
    const a = mk({}); await a.db.set(COLLECTIONS.workerStatus, 'demo-user', beat);
    expect((await request(a.app).get('/api/worker/status').set(as())).body.online).toBe(false);   // default 90 s
    const b = mk({ WORKER_OFFLINE_AFTER_SEC: '180' }); await b.db.set(COLLECTIONS.workerStatus, 'demo-user', beat);
    expect((await request(b.app).get('/api/worker/status').set(as())).body.online).toBe(true);    // free-hosting setting
  });

  it('API + automatic mode end to end: sends only jobs with a clear email, saves the rest, never twice', async () => {
    const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'demo', DB_MODE: 'memory', SECRETS_ENCRYPTION_KEY: KEY, ALLOW_AUTO_APPLY: 'true', OWNER_UID: 'demo-user' });
    const db = new MemoryDb(), files = new MemoryFileStore(), mail = new MockMailSender(), ai = new MockProvider();
    const app = createApp({ config, db, files, ai, mail, verify: async () => { throw new Error('no'); } });
    const deps = { db, ai, files, mail, aiDailyCap: 10 };
    const A = as();
    const prefs = { jobTitles: [], workModes: [], locations: [], experienceLevel: 'junior', excludedCompanies: [], excludedKeywords: [], weights: { skills: 35, experience: 20, seniority: 10, location: 15, titles: 10, qualifications: 10 }, uiLanguage: 'en', emailLanguage: 'en', fullName: '', aiEnabled: true };

    await request(app).post('/api/cv').set(A).attach('file', makePdf(SAMPLE_CV_LINES), 'cv.pdf');
    const on = await request(app).put('/api/preferences').set(A).send({ ...prefs, autoApply: { enabled: true, dailyLimit: 10, acknowledged: true } });
    expect(on.status).toBe(200);

    expect((await request(app).post('/api/demo/seed').set(A)).status).toBe(200);
    const jobs = (await request(app).get('/api/jobs').set(A)).body.items as Job[];
    expect(jobs).toHaveLength(3); // 2 with an email, 1 with only a link (the chit-chat post is ignored)

    const r1 = await autoApplyTick(deps, 'demo-user');
    expect(r1.sent).toBe(2);
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['careers@example.com', 'jobs@example.org']);

    const linkOnly = jobs.find((j) => !j.extracted.applicationEmail)!;
    expect(linkOnly.extracted.applicationLink).toBe('https://example.com/jobs/qa-junior');
    const saved = (await request(app).get(`/api/jobs/${linkOnly.id}`).set(A)).body;
    expect(saved.draft).toBeNull();
    expect(saved.job.status).not.toBe('sent');

    expect((await autoApplyTick(deps, 'demo-user')).sent).toBe(0);
    await request(app).post('/api/demo/seed').set(A); // same posts arrive again
    expect((await autoApplyTick(deps, 'demo-user')).sent).toBe(0);
    expect(mail.sent).toHaveLength(2);

    const apps = (await request(app).get('/api/applications').set(A)).body.items as Application[];
    expect(apps).toHaveLength(2);
    expect(apps.every((a) => a.autoApplied && a.status === 'sent')).toBe(true);
    const sentJob = jobs.find((j) => j.extracted.applicationEmail === 'careers@example.com')!;
    expect((await request(app).post(`/api/jobs/${sentJob.id}/draft`).set(A).send({})).status).toBe(409);
    expect(await db.count(COLLECTIONS.applications)).toBe(2);

    // the user adds an email to the saved link-only job through the API => it becomes eligible and is applied to
    const patched = await request(app).patch(`/api/jobs/${linkOnly.id}`).set(A).send({ extracted: { applicationEmail: 'QA@Example.org' } });
    expect(patched.status).toBe(200);
    expect((await autoApplyTick(deps, 'demo-user')).sent).toBe(1);
    expect(mail.sent.map((m) => m.to)).toContain('qa@example.org');
    expect(mail.sent).toHaveLength(3);
  });
});
