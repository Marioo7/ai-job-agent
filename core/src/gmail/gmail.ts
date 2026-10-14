import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { COLLECTIONS } from '@ajaa/shared';
import { encryptionKey, type Config } from '../config';
import { decryptSecret, encryptSecret, signState, verifyState } from '../crypto';
import type { Db } from '../db/types';
import { AppError } from '../errors';
import { nowIso } from '../repo';
import { buildRawMime } from './mime';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'];

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  attachment: { filename: string; contentType: string; data: Buffer };
}

export interface MailSender {
  readonly mode: 'google' | 'mock';
  send(uid: string, m: MailMessage): Promise<{ messageId: string; simulated: boolean }>;
  status(uid: string): Promise<{ connected: boolean; email: string | null; mode: 'google' | 'mock'; connectedAt: string | null }>;
  authUrl(uid: string): Promise<string>;
  handleCallback(code: string, state: string): Promise<{ uid: string }>;
  test(uid: string): Promise<{ ok: boolean; email: string | null; detail: string }>;
  disconnect(uid: string): Promise<void>;
}

/** Simulated sender for development/tests. Nothing leaves the machine. */
export class MockMailSender implements MailSender {
  readonly mode = 'mock' as const;
  sent: MailMessage[] = [];
  failNext = false;
  async send(_uid: string, m: MailMessage) {
    if (this.failNext) { this.failNext = false; throw new Error('Simulated send failure'); }
    this.sent.push(m);
    return { messageId: `mock-${randomUUID()}`, simulated: true };
  }
  async status() { return { connected: true, email: 'demo@example.invalid', mode: this.mode, connectedAt: null }; }
  async authUrl(): Promise<string> { throw new AppError(400, 'mock_mode', 'Gmail runs in mock mode (GMAIL_MODE=mock). Set GMAIL_MODE=google to connect a real account.'); }
  async handleCallback(): Promise<{ uid: string }> { throw new AppError(400, 'mock_mode', 'Gmail runs in mock mode.'); }
  async test() { return { ok: true, email: null, detail: 'Mock mode: no real Gmail connection is used.' }; }
  async disconnect() { /* nothing to revoke */ }
}

interface GmailIntegration { id: string; uid: string; provider: 'gmail'; email: string | null; refreshTokenEnc: string; connectedAt: string; updatedAt: string }
const docId = (uid: string) => `${uid}_gmail`;

export class GoogleMailSender implements MailSender {
  readonly mode = 'google' as const;
  constructor(private cfg: Config, private db: Db) {}

  private client(): OAuth2Client {
    const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret, GOOGLE_OAUTH_REDIRECT_URI: redirect } = this.cfg;
    if (!id || !secret) throw new AppError(400, 'gmail_not_configured', 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set.');
    return new OAuth2Client(id, secret, redirect);
  }
  private async accessToken(uid: string): Promise<{ token: string; email: string | null }> {
    const integ = await this.db.get<GmailIntegration>(COLLECTIONS.integrations, docId(uid));
    if (!integ) throw new AppError(409, 'gmail_not_connected', 'Gmail is not connected.');
    const c = this.client();
    c.setCredentials({ refresh_token: decryptSecret(integ.refreshTokenEnc, encryptionKey(this.cfg)) });
    try {
      const { token } = await c.getAccessToken();
      if (!token) throw new Error('no token');
      return { token, email: integ.email };
    } catch {
      throw new AppError(409, 'gmail_token_invalid', 'Gmail authorization is no longer valid. Reconnect Gmail.');
    }
  }

  async authUrl(uid: string): Promise<string> {
    return this.client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES, state: signState({ uid }, encryptionKey(this.cfg)) });
  }

  async handleCallback(code: string, state: string): Promise<{ uid: string }> {
    const v = verifyState(state, encryptionKey(this.cfg));
    if (!v) throw new AppError(400, 'bad_state', 'Invalid or expired OAuth state.');
    const c = this.client();
    const { tokens } = await c.getToken(code);
    if (!tokens.refresh_token) throw new AppError(400, 'no_refresh_token', 'Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
    c.setCredentials(tokens);
    let email: string | null = null;
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      email = ((await r.json()) as { email?: string }).email ?? null;
    } catch { /* email is cosmetic */ }
    const now = nowIso();
    const doc: GmailIntegration = { id: docId(v.uid), uid: v.uid, provider: 'gmail', email, refreshTokenEnc: encryptSecret(tokens.refresh_token, encryptionKey(this.cfg)), connectedAt: now, updatedAt: now };
    await this.db.set(COLLECTIONS.integrations, doc.id, doc);
    return { uid: v.uid };
  }

  async status(uid: string) {
    const i = await this.db.get<GmailIntegration>(COLLECTIONS.integrations, docId(uid));
    return { connected: !!i, email: i?.email ?? null, mode: this.mode, connectedAt: i?.connectedAt ?? null };
  }

  async test(uid: string) {
    try {
      const { token } = await this.accessToken(uid);
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return { ok: false, email: null, detail: `Google returned HTTP ${r.status}` };
      const email = ((await r.json()) as { email?: string }).email ?? null;
      return { ok: true, email, detail: 'Token refreshed successfully. No email was sent.' };
    } catch (e) {
      return { ok: false, email: null, detail: e instanceof AppError ? e.message : 'Connection test failed.' };
    }
  }

  async send(uid: string, m: MailMessage) {
    const { token, email } = await this.accessToken(uid);
    const raw = buildRawMime({ from: email ?? undefined, ...m });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`Gmail API error ${res.status}: ${j.error?.message ?? 'unknown'}`);
    }
    return { messageId: ((await res.json()) as { id: string }).id, simulated: false };
  }

  async disconnect(uid: string): Promise<void> {
    const i = await this.db.get<GmailIntegration>(COLLECTIONS.integrations, docId(uid));
    if (!i) return;
    try { await this.client().revokeToken(decryptSecret(i.refreshTokenEnc, encryptionKey(this.cfg))); } catch { /* user can also revoke at myaccount.google.com/permissions */ }
    await this.db.delete(COLLECTIONS.integrations, docId(uid));
  }
}

export function createMailSender(cfg: Config, db: Db): MailSender {
  return cfg.GMAIL_MODE === 'google' ? new GoogleMailSender(cfg, db) : new MockMailSender();
}
