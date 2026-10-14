import { config as loadEnv } from 'dotenv';
import readline from 'node:readline';
import { COLLECTIONS } from '@ajaa/shared';
import { createDb, decryptSecret, encryptionKey, loadConfig } from '@ajaa/core';

loadEnv({ path: ['.env', '../.env'] });

export function cliEnv() {
  const config = loadConfig();
  if (!config.OWNER_UID) throw new Error('OWNER_UID is required.');
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required (https://my.telegram.org).');
  const db = createDb(config);
  return { config, db, uid: config.OWNER_UID, apiId: config.TELEGRAM_API_ID, apiHash: config.TELEGRAM_API_HASH, key: encryptionKey(config) };
}

export const sessionDocId = (uid: string) => `${uid}_telegram`;

export async function loadSession(env: ReturnType<typeof cliEnv>): Promise<string | null> {
  const doc = await env.db.get<{ sessionEnc: string }>(COLLECTIONS.integrations, sessionDocId(env.uid));
  return doc ? decryptSecret(doc.sessionEnc, env.key) : null;
}

export function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(question); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}
