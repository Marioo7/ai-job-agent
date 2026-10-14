import { config as loadEnv } from 'dotenv';
import {
  assertSafeForProduction, autoApplyTick, createAiProvider, createDb, createFileStore, createFirebaseVerifier, createMailSender, loadConfig, log, type TokenVerifier,
} from '@ajaa/core';
import { startWorker } from '@ajaa/worker';
import { createApp } from './app';

loadEnv({ path: ['.env', '../.env'] });
const config = loadConfig();
assertSafeForProduction(config, 'backend');

const db = createDb(config);
const verify: TokenVerifier = config.AUTH_MODE === 'firebase'
  ? createFirebaseVerifier(config)
  : async () => { throw new Error('demo auth mode: Firebase verification disabled'); };

const files = createFileStore(config, db);
const ai = createAiProvider(config);
const mail = createMailSender(config, db);
const app = createApp({ config, db, files, ai, mail, verify });

// Optional hands-free mode: only runs when the server allows it AND the user switched it on in Preferences.
let timer: NodeJS.Timeout | null = null;
if (config.ALLOW_AUTO_APPLY && config.OWNER_UID) {
  const uid = config.OWNER_UID;
  log('warn', 'auto_apply_allowed_by_server', { everySec: config.AUTO_APPLY_INTERVAL_SEC });
  timer = setInterval(() => { autoApplyTick({ db, ai, files, mail, aiDailyCap: config.AI_DAILY_CALL_CAP }, uid).then((r) => { if (r.sent || r.paused) log('info', 'auto_apply_cycle', { ...r }); }).catch((e) => log('error', 'auto_apply_failed', { error: e })); }, config.AUTO_APPLY_INTERVAL_SEC * 1000);
}

// Optional: run the Telegram worker inside this process (one free web service instead of two processes).
const embedded = config.RUN_WORKER_IN_BACKEND ? startWorker(config, db, ai) : null;
if (embedded) log('info', 'worker_embedded_in_backend');

const server = app.listen(config.PORT, () => {
  log('info', 'backend_started', { port: config.PORT, auth: config.AUTH_MODE, db: config.DB_MODE, storage: config.STORAGE_MODE, ai: config.AI_PROVIDER, gmail: config.GMAIL_MODE });
  if (config.AUTH_MODE === 'demo') log('warn', 'DEMO auth mode is active: anyone who can reach this server can use it. Never expose it publicly.');
});
const stop = () => { log('info', 'backend_stopping'); if (timer) clearInterval(timer); void embedded?.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
