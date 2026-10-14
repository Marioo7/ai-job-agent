import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { COLLECTIONS } from '@ajaa/shared';
import { encryptSecret, nowIso } from '@ajaa/core';
import { ask, cliEnv, sessionDocId } from './common';

/**
 * One-time interactive login with YOUR Telegram account (phone, login code, optional 2FA password).
 * The resulting session is encrypted (AES-256-GCM) and stored server-side. It is never printed.
 */
const env = cliEnv();
console.log('Telegram login for the account that can read your job channels.');
console.log('Credentials are typed here only; the session is stored encrypted in your database.\n');

const client = new TelegramClient(new StringSession(''), env.apiId, env.apiHash, { connectionRetries: 5 });
client.setLogLevel(LogLevel.ERROR);
await client.start({
  phoneNumber: () => ask('Phone number with country code (e.g. +201234567890): '),
  phoneCode: () => ask('Login code sent by Telegram: '),
  password: () => ask('Two-step verification password (hidden): ', true),
  onError: (e) => console.error('Login error:', e.message),
});
const me = await client.getMe();
const session = client.session.save() as unknown as string;
const now = nowIso();
await env.db.set(COLLECTIONS.integrations, sessionDocId(env.uid), {
  id: sessionDocId(env.uid), uid: env.uid, provider: 'telegram', sessionEnc: encryptSecret(session, env.key),
  accountLabel: (me as { firstName?: string }).firstName ?? 'account', connectedAt: now, updatedAt: now,
});
await client.disconnect();
console.log('\nLogged in and session stored (encrypted). Start the worker with: npm run dev:worker');
process.exit(0);
