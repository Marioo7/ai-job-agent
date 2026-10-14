import { config as loadEnv } from 'dotenv';
import { assertSafeForProduction, createAiProvider, createDb, loadConfig, log } from '@ajaa/core';
import { startWorker } from './start';

loadEnv({ path: ['.env', '../.env'] });
const config = loadConfig();
assertSafeForProduction(config, 'worker');
const handle = startWorker(config, createDb(config), createAiProvider(config));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { log('info', 'shutdown_requested', { signal: sig }); void handle.stop(); });
process.on('unhandledRejection', (e) => log('error', 'unhandled_rejection', { error: e }));
handle.done.then(() => process.exit(0), (e) => { log('error', 'worker_crashed', { error: e }); process.exit(1); });
