import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import type { RawMessage, ResolvedSource, SourceRef, TelegramGateway } from './gateway';

export interface GramOptions {
  apiId: number;
  apiHash: string;
  /** Returns the decrypted session string (never logged, never sent anywhere). */
  loadSession: () => Promise<string | null>;
}

function normalizeRef(ref: string): string {
  return ref.trim().replace(/^https?:\/\/(?:t|telegram)\.me\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
}

export function buildLink(username: string | null, resolvedId: string, messageId: number): string | null {
  if (username) return `https://t.me/${username}/${messageId}`;
  if (resolvedId.startsWith('-100')) return `https://t.me/c/${resolvedId.slice(4)}/${messageId}`;
  return null;
}

/** Real MTProto client (GramJS) running as the user's own account. Read-only: it never sends or joins anything. */
export class GramGateway implements TelegramGateway {
  readonly mode = 'real' as const;
  private client: TelegramClient | null = null;
  private cb: ((m: RawMessage) => void) | null = null;
  private entities = new Map<string, unknown>();
  private titles = new Map<string, string>();
  private usernames = new Map<string, string | null>();
  private dialogs: Awaited<ReturnType<TelegramClient['getDialogs']>> | null = null;

  constructor(private opts: GramOptions) {}

  async connect(): Promise<void> {
    await this.disconnect();
    const session = await this.opts.loadSession();
    if (!session) throw new Error('No Telegram session stored. Run: npm run telegram:login -w worker');
    const client = new TelegramClient(new StringSession(session), this.opts.apiId, this.opts.apiHash, {
      connectionRetries: 5, autoReconnect: true, floodSleepThreshold: 60, deviceModel: 'AI Job Agent', appVersion: '1.0.0',
    });
    client.setLogLevel(LogLevel.ERROR);
    await client.connect();
    if (!(await client.checkAuthorization())) {
      await client.disconnect();
      throw new Error('Telegram session is no longer authorized. Run: npm run telegram:login -w worker');
    }
    client.addEventHandler((ev: NewMessageEvent) => { void this.handle(ev); }, new NewMessage({}));
    this.client = client;
    this.dialogs = null;
  }

  async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (c) { try { await c.disconnect(); await c.destroy(); } catch { /* ignore */ } }
  }

  isConnected(): boolean { return !!this.client && this.client.connected === true; }
  onMessage(cb: (m: RawMessage) => void): void { this.cb = cb; }

  private need(): TelegramClient {
    if (!this.client) throw new Error('Telegram client is not connected');
    return this.client;
  }

  async resolveSource(ref: string): Promise<ResolvedSource | null> {
    const c = this.need();
    const r = normalizeRef(ref);
    if (r.startsWith('+') || /^joinchat/i.test(r)) throw new Error('Invite links cannot be resolved without joining. Join in the Telegram app, then use the numeric ID or exact title (see: npm run telegram:dialogs -w worker).');
    let entity: unknown;
    this.dialogs ??= await c.getDialogs({ limit: 300 });
    if (/^-?\d+$/.test(r)) {
      for (const d of this.dialogs) { if (d.entity && String(await c.getPeerId(d.entity)) === r) { entity = d.entity; break; } }
    } else {
      entity = this.dialogs.find((d) => d.title?.toLowerCase() === r.toLowerCase())?.entity;
      if (!entity) { try { entity = await c.getEntity(r); } catch { entity = undefined; } }
    }
    if (!entity) return null;
    const id = String(await c.getPeerId(entity as never));
    const e = entity as { title?: string; username?: string | null };
    const title = e.title ?? r;
    this.entities.set(id, entity);
    this.titles.set(id, title);
    this.usernames.set(id, e.username ?? null);
    return { id, title, username: e.username ?? null };
  }

  async fetchSince(src: SourceRef, minId: number, limit: number): Promise<RawMessage[]> {
    const c = this.need();
    if (!this.entities.has(src.resolvedId)) await this.resolveSource(src.ref);
    const entity = this.entities.get(src.resolvedId);
    if (!entity) return [];
    const msgs = await c.getMessages(entity as never, minId > 0 ? { limit, offsetId: minId, reverse: true } : { limit });
    const out: RawMessage[] = [];
    for (const m of msgs) {
      if (!(m instanceof Api.Message) || !m.message) continue;
      out.push({
        sourceId: src.resolvedId, sourceTitle: this.titles.get(src.resolvedId) ?? src.ref, messageId: m.id,
        date: new Date(m.date * 1000).toISOString(), text: m.message, link: buildLink(src.username ?? this.usernames.get(src.resolvedId) ?? null, src.resolvedId, m.id),
      });
    }
    return out.sort((a, b) => a.messageId - b.messageId);
  }

  private async handle(ev: NewMessageEvent): Promise<void> {
    try {
      const m = ev.message;
      const chatId = ev.chatId?.toString();
      if (!chatId || !m.message) return;
      this.cb?.({
        sourceId: chatId, sourceTitle: this.titles.get(chatId) ?? chatId, messageId: m.id, date: new Date(m.date * 1000).toISOString(), text: m.message,
        link: buildLink(this.usernames.get(chatId) ?? null, chatId, m.id),
      });
    } catch { /* a single bad event must not kill the handler */ }
  }

  async testConnection(): Promise<string> {
    const me = await this.need().getMe();
    return `Connected as ${(me as Api.User).firstName ?? 'your account'}.`;
  }
}
