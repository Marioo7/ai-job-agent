import { COLLECTIONS, type TelegramSource, type WorkerStatus } from '@ajaa/shared';
import { errMsg, log, nowIso, processIncomingMessage, reprocessPending, type AiProvider, type Db } from '@ajaa/core';
import type { RawMessage, TelegramGateway } from './gateway';

export interface WorkerOptions {
  uid: string;
  db: Db;
  ai: AiProvider;
  aiDailyCap: number;
  gateway: TelegramGateway;
  tickMs: number;
  version?: string;
  backoffBaseMs?: number;
  now?: () => Date;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * Long-running monitor. Every tick it: reconnects if needed (exponential backoff), resolves new sources,
 * catches up on messages missed while offline, retries half-processed messages, answers "test connection"
 * requests and writes a heartbeat the dashboard uses to detect an offline worker.
 */
export class Worker {
  private startedAt: string;
  private lastUpdateAt: string | null = null;
  private lastCatchUpAt: string | null = null;
  private lastError: string | null = null;
  private failures = 0;
  private nextConnectAt = 0;
  private sources: TelegramSource[] = [];
  private catchingUp = false;
  private stopped = false;
  private firstHeartbeat = true;
  private pending: Promise<unknown>[] = [];

  constructor(private o: WorkerOptions) {
    this.startedAt = this.now().toISOString();
    o.gateway.onMessage((m) => { this.pending.push(this.handleMessage(m).catch((e) => log('error', 'message_handler_failed', { error: errMsg(e) }))); });
  }

  private now(): Date { return this.o.now?.() ?? new Date(); }
  private deps() { return { db: this.o.db, ai: this.o.ai, aiDailyCap: this.o.aiDailyCap, now: this.o.now }; }

  async flush(): Promise<void> { await Promise.all(this.pending.splice(0)); }

  async run(signal: AbortSignal): Promise<void> {
    await this.tick();
    while (!signal.aborted) {
      await sleep(this.o.tickMs, signal);
      if (signal.aborted) break;
      await this.tick();
    }
    await this.stop();
  }

  async tick(): Promise<void> {
    try {
      await this.ensureConnected();
      this.sources = await this.o.db.list<TelegramSource>(COLLECTIONS.telegramSources, { where: [['uid', '==', this.o.uid]], limit: 100 });
      if (this.o.gateway.isConnected()) {
        await this.resolveSources();
        await this.catchUp();
      }
      const n = await reprocessPending(this.deps(), this.o.uid);
      if (n) log('info', 'reprocessed_pending', { jobs: n });
      await this.handleTestRequest();
    } catch (e) {
      this.lastError = errMsg(e).slice(0, 300);
      log('error', 'tick_failed', { error: e });
    }
    await this.heartbeat();
  }

  private async ensureConnected(): Promise<void> {
    const g = this.o.gateway;
    if (g.isConnected()) { this.failures = 0; return; }
    if (this.now().getTime() < this.nextConnectAt) return;
    try {
      await g.connect();
      this.failures = 0;
      this.lastError = null;
      log('info', 'telegram_connected', { mode: g.mode });
    } catch (e) {
      this.failures++;
      const delay = Math.min(5 * 60_000, (this.o.backoffBaseMs ?? 5000) * 2 ** Math.min(this.failures, 6));
      this.nextConnectAt = this.now().getTime() + delay;
      this.lastError = `Telegram connection failed: ${errMsg(e)}`.slice(0, 300);
      log('warn', 'telegram_connect_failed', { attempt: this.failures, retryInMs: delay, error: e });
    }
  }

  private async resolveSources(): Promise<void> {
    for (const s of this.sources) {
      if (!s.enabled || s.resolvedId) continue;
      try {
        const r = await this.o.gateway.resolveSource(s.ref);
        if (!r) { await this.markSource(s, { lastError: 'Source not found or not accessible to your account.' }); continue; }
        await this.markSource(s, { resolvedId: r.id, title: r.title, username: r.username, lastError: null });
      } catch (e) {
        await this.markSource(s, { lastError: errMsg(e).slice(0, 200) });
      }
    }
  }

  private async markSource(s: TelegramSource, patch: Partial<TelegramSource>): Promise<void> {
    Object.assign(s, patch);
    await this.o.db.update(COLLECTIONS.telegramSources, s.id, { ...patch, updatedAt: nowIso(this.now()) });
  }

  /** Fetch messages we missed while offline. First sync of a source only pulls the newest 20 (no deep history). */
  async catchUp(): Promise<void> {
    if (this.catchingUp) return;
    this.catchingUp = true;
    try {
      for (const s of this.sources.filter((x) => x.enabled && x.resolvedId)) {
        if (this.o.gateway.mode === 'mock') continue;
        try {
          const msgs = await this.o.gateway.fetchSince({ ref: s.ref, resolvedId: s.resolvedId!, username: s.username }, s.lastMessageId, s.lastMessageId === 0 ? 20 : 100);
          for (const m of msgs) await this.handleMessage(m);
        } catch (e) {
          await this.markSource(s, { lastError: errMsg(e).slice(0, 200) });
        }
      }
      this.lastCatchUpAt = nowIso(this.now());
    } finally { this.catchingUp = false; }
  }

  async handleMessage(m: RawMessage): Promise<void> {
    const s = this.sources.find((x) => x.enabled && x.resolvedId === m.sourceId);
    if (!s) return; // not a monitored source
    const r = await processIncomingMessage(this.deps(), this.o.uid, {
      sourceId: m.sourceId, sourceName: s.title || m.sourceTitle, messageId: m.messageId, date: m.date, text: m.text, sourceLink: m.link, isDemo: m.isDemo,
    });
    this.lastUpdateAt = nowIso(this.now());
    if (r.status !== 'error' && m.messageId > s.lastMessageId) {
      await this.markSource(s, { lastMessageId: m.messageId, lastSyncAt: this.lastUpdateAt, lastError: null });
    }
    log('info', 'message_processed', { source: s.id, messageId: m.messageId, result: r.status });
  }

  private async handleTestRequest(): Promise<void> {
    const w = await this.o.db.get<WorkerStatus>(COLLECTIONS.workerStatus, this.o.uid);
    if (!w?.testRequestedAt || (w.testResult && w.testResult.at >= w.testRequestedAt)) return;
    let result: WorkerStatus['testResult'];
    try {
      result = { at: nowIso(this.now()), ok: true, detail: await this.o.gateway.testConnection() };
    } catch (e) {
      result = { at: nowIso(this.now()), ok: false, detail: `Test failed: ${errMsg(e)}`.slice(0, 300) };
    }
    await this.o.db.update(COLLECTIONS.workerStatus, this.o.uid, { testResult: result });
  }

  private statusFields(state: WorkerStatus['state']) {
    return {
      state, mode: this.o.gateway.mode, telegramConnected: this.o.gateway.isConnected(), lastHeartbeatAt: nowIso(this.now()),
      lastUpdateAt: this.lastUpdateAt, lastCatchUpAt: this.lastCatchUpAt, lastError: this.lastError, version: this.o.version ?? '1.0.0',
    };
  }

 
  private async heartbeat(state?: WorkerStatus['state']): Promise<void> {
    const st = state ?? (this.o.gateway.isConnected() ? 'running' : 'degraded');

    try {
      const prev = await this.o.db.get<WorkerStatus>(
        COLLECTIONS.workerStatus,
        this.o.uid,
      );

      if (!prev) {
        // Re-create the status document if it was deleted.
        await this.o.db.set(COLLECTIONS.workerStatus, this.o.uid, {
          uid: this.o.uid,
          startedAt: this.startedAt,
          testRequestedAt: null,
          testResult: null,
          ...this.statusFields(st),
          lastUpdateAt: this.lastUpdateAt,
        });
      } else if (this.firstHeartbeat) {
        await this.o.db.set(COLLECTIONS.workerStatus, this.o.uid, {
          uid: this.o.uid,
          startedAt: this.startedAt,
          testRequestedAt: prev.testRequestedAt ?? null,
          testResult: prev.testResult ?? null,
          ...this.statusFields(st),
          lastUpdateAt: this.lastUpdateAt ?? prev.lastUpdateAt ?? null,
        });
      } else {
        await this.o.db.update(
          COLLECTIONS.workerStatus,
          this.o.uid,
          this.statusFields(st),
        );
      }

      this.firstHeartbeat = false;
    } catch (e) {
      log('error', 'heartbeat_failed', { error: e });
    }
  }


  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.flush();
    await this.heartbeat('stopped');
    await this.o.gateway.disconnect().catch(() => undefined);
    log('info', 'worker_stopped');
  }
}
