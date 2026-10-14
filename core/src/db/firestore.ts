import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import type { Config } from '../config';
import type { Db, QueryOpts, Where } from './types';

type FbCfg = Pick<Config, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_PATH' | 'FIREBASE_SERVICE_ACCOUNT_JSON' | 'FIREBASE_STORAGE_BUCKET'>;

export function initFirebase(cfg: FbCfg): App {
  const existing = getApps()[0];
  if (existing) return existing;
  let credential;
  if (cfg.FIREBASE_SERVICE_ACCOUNT_JSON) credential = cert(JSON.parse(cfg.FIREBASE_SERVICE_ACCOUNT_JSON));
  else if (cfg.FIREBASE_SERVICE_ACCOUNT_PATH) credential = cert(JSON.parse(readFileSync(cfg.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')));
  else credential = applicationDefault();
  return initializeApp({ credential, projectId: cfg.FIREBASE_PROJECT_ID, storageBucket: cfg.FIREBASE_STORAGE_BUCKET });
}

type DocData = FirebaseFirestore.DocumentData;

export class FirestoreDb implements Db {
  constructor(private fs: Firestore) {}

  private query(col: string, where?: Where[]): Query {
    let q: Query = this.fs.collection(col);
    for (const [f, op, v] of where ?? []) q = q.where(f, op, v);
    return q;
  }
  async get<T>(col: string, id: string): Promise<T | null> {
    const s = await this.fs.collection(col).doc(id).get();
    return s.exists ? (s.data() as T) : null;
  }
  async create(col: string, id: string, data: object): Promise<boolean> {
    try {
      await this.fs.collection(col).doc(id).create(data as DocData);
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 6) return false; // ALREADY_EXISTS
      throw e;
    }
  }
  async set(col: string, id: string, data: object): Promise<void> {
    await this.fs.collection(col).doc(id).set(data as DocData);
  }
  async update(col: string, id: string, patch: object): Promise<void> {
    await this.fs.collection(col).doc(id).update(patch as DocData);
  }
  async delete(col: string, id: string): Promise<void> {
    await this.fs.collection(col).doc(id).delete();
  }
  async list<T>(col: string, o: QueryOpts = {}): Promise<T[]> {
    let q = this.query(col, o.where);
    if (o.orderBy) {
      q = q.orderBy(o.orderBy[0], o.orderBy[1]);
      if (o.startAfter !== undefined) q = q.startAfter(o.startAfter);
    }
    if (o.limit) q = q.limit(o.limit);
    return (await q.get()).docs.map((d) => d.data() as T);
  }
  async count(col: string, where?: Where[]): Promise<number> {
    return (await this.query(col, where).count().get()).data().count;
  }
  async compareAndSet(col: string, id: string, expected: Record<string, unknown>, patch: object): Promise<boolean> {
    const ref = this.fs.collection(col).doc(id);
    return this.fs.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return false;
      const d = s.data() ?? {};
      for (const [k, v] of Object.entries(expected)) if (d[k] !== v) return false;
      tx.update(ref, patch as DocData);
      return true;
    });
  }
}

export function createFirestoreDb(cfg: FbCfg): Db {
  const app = initFirebase(cfg);
  const fs = getFirestore(app);
  try { fs.settings({ ignoreUndefinedProperties: true }); } catch { /* already configured */ }
  return new FirestoreDb(fs);
}

export interface VerifiedUser { uid: string; email?: string }
export type TokenVerifier = (token: string) => Promise<VerifiedUser>;

export function createFirebaseVerifier(cfg: FbCfg): TokenVerifier {
  const app = initFirebase(cfg);
  return async (token) => {
    const d = await getAuth(app).verifyIdToken(token);
    return { uid: d.uid, email: d.email_verified ? d.email : undefined };
  };
}
