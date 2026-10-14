import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { COLLECTIONS } from '@ajaa/shared';
import { cliEnv, loadSession, sessionDocId } from './common';

/** Revokes the session on Telegram's side and deletes the stored copy. */
const env = cliEnv();
const session = await loadSession(env);
if (session) {
  const client = new TelegramClient(new StringSession(session), env.apiId, env.apiHash, { connectionRetries: 3 });
  client.setLogLevel(LogLevel.ERROR);
  try { await client.connect(); await client.invoke(new Api.auth.LogOut()); console.log('Session revoked on Telegram.'); }
  catch (e) { console.warn('Could not revoke remotely (already invalid?):', (e as Error).message); }
}
await env.db.delete(COLLECTIONS.integrations, sessionDocId(env.uid));
console.log('Stored session deleted. You can also check Telegram > Settings > Devices.');
process.exit(0);
