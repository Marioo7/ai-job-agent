import { DEMO_MESSAGES } from '@ajaa/shared';

export interface RawMessage {
  sourceId: string;
  sourceTitle: string;
  messageId: number;
  date: string;
  text: string;
  link: string | null;
  isDemo?: boolean;
}

export interface ResolvedSource { id: string; title: string; username: string | null }
export interface SourceRef { ref: string; resolvedId: string; username: string | null }

/** Abstraction over Telegram so the worker logic can be tested without a real account. */
export interface TelegramGateway {
  readonly mode: 'real' | 'mock';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  resolveSource(ref: string): Promise<ResolvedSource | null>;
  /** Messages with id > minId in ascending order (or the newest `limit` when minId is 0). */
  fetchSince(src: SourceRef, minId: number, limit: number): Promise<RawMessage[]>;
  onMessage(cb: (m: RawMessage) => void): void;
  testConnection(): Promise<string>;
}

/** Emits clearly-labelled DEMO posts for every resolved source. Used when TELEGRAM_MODE=mock. */
export class MockGateway implements TelegramGateway {
  readonly mode = 'mock' as const;
  private connected = false;
  private cb: ((m: RawMessage) => void) | null = null;
  private resolved = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private i = 0;
  private counter = 1000;
  constructor(private intervalMs: number) {}

  async connect() {
    this.connected = true;
    this.timer ??= setInterval(() => this.emit(), this.intervalMs);
    this.timer.unref();
  }
  async disconnect() { this.connected = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
  isConnected() { return this.connected; }
  async resolveSource(ref: string): Promise<ResolvedSource> {
    const id = `mock-${ref.replace(/[^\w]/g, '').toLowerCase() || 'source'}`;
    this.resolved.set(id, ref);
    return { id, title: `${ref} (DEMO)`, username: null };
  }
  async fetchSince(): Promise<RawMessage[]> { return []; }
  onMessage(cb: (m: RawMessage) => void) { this.cb = cb; }
  async testConnection() { return 'Mock mode: no real Telegram account is connected. Messages are DEMO data.'; }

  private emit() {
    if (!this.cb) return;
    for (const [id, ref] of this.resolved) {
      const m = DEMO_MESSAGES[this.i % DEMO_MESSAGES.length]!;
      this.cb({ sourceId: id, sourceTitle: `${ref} (DEMO)`, messageId: ++this.counter, date: new Date().toISOString(), text: m.text, link: null, isDemo: true });
    }
    this.i++;
  }
}
