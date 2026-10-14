import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { cliEnv, loadSession } from './common';

/** Lists channels/groups your account can read, with IDs you can paste into the Sources page. Read-only. */
const env = cliEnv();
const session = await loadSession(env);
if (!session) { console.error('No stored session. Run: npm run telegram:login -w worker'); process.exit(1); }
const client = new TelegramClient(new StringSession(session), env.apiId, env.apiHash, { connectionRetries: 3 });
client.setLogLevel(LogLevel.ERROR);
await client.connect();
const dialogs = await client.getDialogs({ limit: 300 });
for (const d of dialogs) {
  if (!d.isChannel && !d.isGroup) continue;
  const id = d.entity ? String(await client.getPeerId(d.entity)) : String(d.id);
  const username = (d.entity as { username?: string } | undefined)?.username;
  console.log(`${id}\t${d.isChannel ? 'channel' : 'group'}\t${username ? '@' + username : '(private)'}\t${d.title}`);
}
await client.disconnect();
process.exit(0);
