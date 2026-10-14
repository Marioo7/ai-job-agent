import type { Config } from '../config';
import { createFirestoreDb } from './firestore';
import { MemoryDb } from './memory';
import type { Db } from './types';

export function createDb(cfg: Config): Db {
  return cfg.DB_MODE === 'memory' ? new MemoryDb() : createFirestoreDb(cfg);
}
export * from './types';
export { MemoryDb } from './memory';
export { FirestoreDb, createFirebaseVerifier, initFirebase } from './firestore';
export type { TokenVerifier, VerifiedUser } from './firestore';
