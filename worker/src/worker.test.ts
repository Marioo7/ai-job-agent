import { describe, expect, it } from 'vitest';
import { COLLECTIONS, defaultPreferences, type Application, type Job, type TelegramSource, type WorkerStatus } from '@ajaa/shared';
import { MemoryDb, MemoryFileStore, MockMailSender, MockProvider, autoApplyTick, seedCv } from '@ajaa/core';
import type { RawMessage, SourceRef, TelegramGateway } from './gateway';
import { Worker } from './worker';
import { startWorker } from './start';
import { loadConfig } from '@ajaa/core';

const POST = (n: number) => `We are hiring: React Developer #${n}\nCompany: Acme ${n}\nRequirements: 3+ years of experience with React and TypeScript.\nSend your CV to jobs${n}@acme.example`;

class FakeGateway implements TelegramGateway {
  readonly mode = 'real' as const;
  connected = false;
  failConnects = 0;
  store: RawMessage[] = [];
  cb: ((m: RawMessage) => void) | null = null;
  async connect() { if (this.failConnects > 0) { this.failConnects--; throw new Error('network down'); } this.connected = true; }
  async disconnect() { this.connected = false; }
  isConnected() { return this.connected; }
  async resolveSource() { return { id: '-1001', title: 'Jobs Channel', username: 'jobs' }; }
  fetchCalls = 0;
  async fetchSince(s: SourceRef, minId: number, limit: number) {
    this.fetchCalls++;
    const all = this.store.filter((m) => m.sourceId === s.resolvedId && m.messageId > minId).sort((a, b) => a.messageId - b.messageId);
    return minId > 0 ? all.slice(0, limit) : all.slice(-limit); // after minId: oldest first; first sync: newest `limit`
  }
  onMessage(cb: (m: RawMessage) => void) { this.cb = cb; }
  async testConnection() { return 'Connected as Test.'; }
  emit(m: RawMessage) { this.cb?.(m); }
}
const raw = (id: number, source = '-1001'): RawMessage => ({ sourceId: source, sourceTitle: 'Jobs Channel', messageId: id, date: new Date().toISOString(), text: POST(id), link: `https://t.me/jobs/${id}` });

async function setup() {
  const db = new MemoryDb();
  const gateway = new FakeGateway();
  const src: TelegramSource = { id: 'src1', uid: 'u1', ref: 'jobs', title: 'jobs', enabled: true, resolvedId: null, username: null, lastMessageId: 0, lastSyncAt: null, lastError: null, createdAt: '', updatedAt: '' };
  await db.set(COLLECTIONS.telegramSources, src.id, src);
  const worker = new Worker({ uid: 'u1', db, ai: new MockProvider(), aiDailyCap: 10, gateway, tickMs: 1000, backoffBaseMs: 0 });
  return { db, gateway, worker };
}
const jobs = (db: MemoryDb) => db.count(COLLECTIONS.jobs, [['uid', '==', 'u1']]);

describe('worker', () => {
  it('connects, resolves sources, processes live messages once and ignores unmonitored chats', async () => {
    const { db, gateway, worker } = await setup();
    await worker.tick();
    const src = (await db.get<TelegramSource>(COLLECTIONS.telegramSources, 'src1'))!;
    expect(src.resolvedId).toBe('-1001');
    gateway.emit(raw(10));
    gateway.emit(raw(10)); // duplicate delivery
    gateway.emit(raw(11, '-999')); // not monitored
    await worker.flush();
    expect(await jobs(db)).toBe(1);
    const job = (await db.list<Job>(COLLECTIONS.jobs))[0]!;
    expect(job.sourceLink).toBe('https://t.me/jobs/10');
    expect((await db.get<TelegramSource>(COLLECTIONS.telegramSources, 'src1'))!.lastMessageId).toBe(10);
  });

  it('recovers from connection failures with backoff and reports degraded state', async () => {
    const { db, gateway, worker } = await setup();
    gateway.failConnects = 2;
    await worker.tick();
    let st = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    expect(st.state).toBe('degraded');
    expect(st.lastError).toContain('network down');
    await worker.tick();
    await worker.tick();
    st = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    expect(st.state).toBe('running');
    expect(st.telegramConnected).toBe(true);
    expect(st.lastError).toBeNull();
  });

  it('catches up on messages missed while offline, without duplicates', async () => {
    const { db, gateway, worker } = await setup();
    await worker.tick();
    gateway.emit(raw(1));
    await worker.flush();
    gateway.store = [raw(1), raw(2), raw(3)]; // 2 and 3 arrived while the worker was offline
    gateway.connected = false; // simulate dropped connection
    await worker.tick();
    expect(await jobs(db)).toBe(3);
    expect((await db.get<TelegramSource>(COLLECTIONS.telegramSources, 'src1'))!.lastMessageId).toBe(3);
    await worker.tick();
    expect(await jobs(db)).toBe(3);
  });

  it('answers test-connection requests, writes heartbeats and stops gracefully', async () => {
    const { db, worker } = await setup();
    await worker.tick();
    const before = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    await db.update(COLLECTIONS.workerStatus, 'u1', { testRequestedAt: new Date(Date.now() + 1000).toISOString() });
    await worker.tick();
    const mid = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    expect(mid.testResult?.ok).toBe(true);
    expect(mid.lastHeartbeatAt >= before.lastHeartbeatAt).toBe(true);
    await worker.stop();
    expect((await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!.state).toBe('stopped');
  });
});

const source = (id: string, resolvedId: string | null, lastMessageId = 0): TelegramSource => ({ id, uid: 'u1', ref: id, title: id, enabled: true, resolvedId, username: null, lastMessageId, lastSyncAt: null, lastError: null, createdAt: '', updatedAt: '' });

describe('worker: scheduled 5-minute check (nothing is missed)', () => {
  it('re-reads every source on the poll interval, not before', async () => {
    const db = new MemoryDb();
    const gateway = new FakeGateway();
    await db.set(COLLECTIONS.telegramSources, 'src1', source('src1', null));
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const worker = new Worker({ uid: 'u1', db, ai: new MockProvider(), aiDailyCap: 10, gateway, tickMs: 20_000, pollMs: 300_000, backoffBaseMs: 0, now: () => new Date(clock) });
    await worker.tick(); // connect + first sync (channel empty)
    gateway.store = [raw(5)]; // posted while the live stream missed it (never emitted)
    clock += 60_000; await worker.tick();
    expect(await jobs(db)).toBe(0); // 1 min later: not polled yet
    const callsBefore = gateway.fetchCalls;
    clock += 20_000; await worker.tick();
    expect(gateway.fetchCalls).toBe(callsBefore); // still no extra reads between polls
    clock += 230_000; await worker.tick(); // > 5 minutes since the last read
    expect(await jobs(db)).toBe(1);
    const st = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    expect(st.lastCatchUpAt).toBeTruthy();
  });

  it('pages through a large backlog (250 missed posts) without losing any', async () => {
    const db = new MemoryDb();
    const gateway = new FakeGateway();
    await db.set(COLLECTIONS.telegramSources, 'src1', source('src1', '-1001', 1));
    gateway.store = Array.from({ length: 250 }, (_, i) => raw(i + 2));
    const worker = new Worker({ uid: 'u1', db, ai: new MockProvider(), aiDailyCap: 10, gateway, tickMs: 20_000, pollMs: 300_000, backoffBaseMs: 0 });
    await worker.tick();
    expect(await jobs(db)).toBe(250);
    expect((await db.get<TelegramSource>(COLLECTIONS.telegramSources, 'src1'))!.lastMessageId).toBe(251);
    await worker.tick();
    expect(await jobs(db)).toBe(250);
  });
});

describe('worker + auto-apply: the rules are really applied', () => {
  it('sends only where a clear email exists, saves the rest, never twice (incl. cross-posts and re-delivery)', async () => {
    const db = new MemoryDb();
    const files = new MemoryFileStore();
    const mail = new MockMailSender();
    const gateway = new FakeGateway();
    await seedCv(db, files, 'u1');
    await db.set(COLLECTIONS.userPreferences, 'u1', { ...defaultPreferences('u1'), fullName: 'John Carter', experienceLevel: 'junior', autoApply: { enabled: true, dailyLimit: 50, enabledAt: '2000-01-01T00:00:00.000Z' } });
    await db.set(COLLECTIONS.telegramSources, 'a', source('a', '-1001'));
    await db.set(COLLECTIONS.telegramSources, 'b', source('b', '-1002'));
    const worker = new Worker({ uid: 'u1', db, ai: new MockProvider(), aiDailyCap: 10, gateway, tickMs: 20_000, pollMs: 300_000, backoffBaseMs: 0 });
    await worker.tick();

    const at = (sourceId: string, messageId: number, text: string): RawMessage => ({ sourceId, sourceTitle: sourceId, messageId, date: new Date().toISOString(), text, link: null });
    const hr = `Hiring: Senior Data Scientist\nCompany: Globex\nRequirements: 12+ years of experience in Python, PyTorch and machine learning. Onsite.\nSend your CV to talent@globex.example`;
    const linkOnly = `Hiring: React Developer\nCompany: Initech\nRequirements: 2+ years of experience with React.\nApply here: https://initech.example/jobs/42`;
    gateway.emit(at('-1001', 10, hr));        // wrong specialty/level/experience for this CV, but has an email => sent
    gateway.emit(at('-1001', 11, linkOnly));  // no email => saved only
    gateway.emit(at('-1002', 77, hr));        // same post cross-posted in another channel
    gateway.emit(at('-1001', 10, hr));        // same message delivered twice
    await worker.flush();
    await worker.tick();                      // poll must not create duplicates either

    expect(await jobs(db)).toBe(2);           // 2 distinct jobs (the cross-post was merged)
    const r1 = await autoApplyTick({ db, ai: new MockProvider(), files, mail, aiDailyCap: 10 }, 'u1');
    expect(r1.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe('talent@globex.example');

    const all = await db.list<Job>(COLLECTIONS.jobs);
    const saved = all.find((j) => j.extracted.applicationEmail === null)!;
    expect(saved.extracted.applicationLink).toBe('https://initech.example/jobs/42');
    expect(saved.status).not.toBe('sent');
    expect(await db.count(COLLECTIONS.emailDrafts)).toBe(1);

    gateway.emit(at('-1001', 12, hr)); gateway.emit(at('-1002', 78, hr)); await worker.flush();
    expect((await autoApplyTick({ db, ai: new MockProvider(), files, mail, aiDailyCap: 10 }, 'u1')).sent).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect((await db.list<Application>(COLLECTIONS.applications)).length).toBe(1);
  });
});

describe('embedded worker (single free web service)', () => {
  it('startWorker runs inside another process, reports heartbeats and stops cleanly', async () => {
    const db = new MemoryDb();
    const config = loadConfig({ NODE_ENV: 'test', DB_MODE: 'memory', TELEGRAM_MODE: 'mock', OWNER_UID: 'u1', WORKER_TICK_SEC: '60', SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
    const h = startWorker(config, db, new MockProvider());
    for (let i = 0; i < 50 && !(await db.get(COLLECTIONS.workerStatus, 'u1')); i++) await new Promise((r) => setTimeout(r, 20));
    const st = (await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!;
    expect(st.mode).toBe('mock');
    expect(st.state).toBe('running');
    await h.stop();
    expect((await db.get<WorkerStatus>(COLLECTIONS.workerStatus, 'u1'))!.state).toBe('stopped');
    expect(() => startWorker({ ...config, OWNER_UID: undefined }, db, new MockProvider())).toThrow(/OWNER_UID/);
  });
});
