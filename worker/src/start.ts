import { COLLECTIONS } from '@ajaa/shared';
import { decryptSecret, encryptionKey, log, type AiProvider, type Config, type Db } from '@ajaa/core';
import { MockGateway, type TelegramGateway } from './gateway';
import { GramGateway } from './gramGateway';
import { Worker } from './worker';

/**
 * Builds and starts the Telegram worker. Used by the stand-alone worker process AND by the backend when
 * RUN_WORKER_IN_BACKEND=true (single free web service). Never run two workers for the same Telegram session.
 */
export function startWorker(config: Config, db: Db, ai: AiProvider, gatewayOverride?: TelegramGateway) {
  if (!config.OWNER_UID) throw new Error('OWNER_UID is required (your Firebase user id; shown on the Integrations page).');
  const uid = config.OWNER_UID;

  let gateway: TelegramGateway;
  if (gatewayOverride) gateway = gatewayOverride;
  else if (config.TELEGRAM_MODE === 'mock') {
    log('warn', 'TELEGRAM_MODE=mock: only DEMO messages are produced. No real Telegram monitoring is active.');
    gateway = new MockGateway(config.MOCK_MESSAGE_INTERVAL_SEC * 1000);
  } else {
    if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required for TELEGRAM_MODE=real (https://my.telegram.org).');
    const key = encryptionKey(config);
    gateway = new GramGateway({
      apiId: config.TELEGRAM_API_ID,
      apiHash: config.TELEGRAM_API_HASH,
      loadSession: async () => {
        const doc = await db.get<{ sessionEnc: string }>(COLLECTIONS.integrations, `${uid}_telegram`);
        return doc ? decryptSecret(doc.sessionEnc, key) : null;
      },
    });
  }

  const worker = new Worker({ uid, db, ai, aiDailyCap: config.AI_DAILY_CALL_CAP, gateway, tickMs: config.WORKER_TICK_SEC * 1000, pollMs: config.TELEGRAM_POLL_INTERVAL_SEC * 1000 });
  const ac = new AbortController();
  const done = worker.run(ac.signal);
  log('info', 'worker_started', { mode: gateway.mode, tickSec: config.WORKER_TICK_SEC, pollSec: config.TELEGRAM_POLL_INTERVAL_SEC });
  return { worker, done, stop: async () => { ac.abort(); await done; } };
}
