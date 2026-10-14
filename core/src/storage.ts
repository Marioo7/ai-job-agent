import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStorage } from 'firebase-admin/storage';
import { COLLECTIONS } from '@ajaa/shared';
import type { Config } from './config';
import { initFirebase } from './db/firestore';
import type { Db } from './db/types';

/** Private binary storage. Files are never served from a public URL; the API streams them after auth. */
export interface FileStore {
  put(filePath: string, data: Buffer, contentType: string): Promise<void>;
  read(filePath: string): Promise<Buffer>;
  remove(filePath: string): Promise<void>;
}

function safeRel(p: string): string {
  const n = path.posix.normalize(p);
  if (n.startsWith('..') || n.startsWith('/') || n.includes('\0')) throw new Error('Invalid storage path');
  return n;
}

export class LocalFileStore implements FileStore {
  constructor(private baseDir: string) {}
  private abs(p: string) { return path.resolve(this.baseDir, safeRel(p)); }
  async put(p: string, data: Buffer): Promise<void> {
    const f = this.abs(p);
    await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    await writeFile(f, data, { mode: 0o600 });
    await chmod(f, 0o600).catch(() => undefined);
  }
  read(p: string): Promise<Buffer> { return readFile(this.abs(p)); }
  async remove(p: string): Promise<void> { await rm(this.abs(p), { force: true }); }
}

export class FirebaseFileStore implements FileStore {
  constructor(private cfg: Config) {}
  private bucket() {
    if (!this.cfg.FIREBASE_STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET is required for STORAGE_MODE=firebase');
    return getStorage(initFirebase(this.cfg)).bucket(this.cfg.FIREBASE_STORAGE_BUCKET);
  }
  async put(p: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket().file(safeRel(p)).save(data, { contentType, resumable: false, private: true } as never);
  }
  async read(p: string): Promise<Buffer> { return (await this.bucket().file(safeRel(p)).download())[0]; }
  async remove(p: string): Promise<void> { await this.bucket().file(safeRel(p)).delete({ ignoreNotFound: true }); }
}

export class MemoryFileStore implements FileStore {
  files = new Map<string, Buffer>();
  async put(p: string, d: Buffer) { this.files.set(safeRel(p), d); }
  async read(p: string) { const f = this.files.get(safeRel(p)); if (!f) throw new Error('not_found'); return f; }
  async remove(p: string) { this.files.delete(safeRel(p)); }
}

/**
 * Stores files inside Firestore (base64 chunks of 500 KB, under the 1 MiB document limit). Works on the free Spark plan
 * (Cloud Storage for Firebase needs a billing account) and on hosts with an ephemeral disk. A 5 MB CV = about 10 small docs.
 */
export class FirestoreFileStore implements FileStore {
  static readonly CHUNK = 500_000;
  constructor(private db: Db) {}
  private key(p: string) { return createHash('sha256').update(safeRel(p)).digest('hex').slice(0, 40); }
  async put(p: string, data: Buffer): Promise<void> {
    const k = this.key(p);
    await this.remove(p);
    const n = Math.max(1, Math.ceil(data.length / FirestoreFileStore.CHUNK));
    for (let i = 0; i < n; i++) {
      const id = `${k}_${i}`;
      await this.db.set(COLLECTIONS.files, id, { id, key: k, i, data: data.subarray(i * FirestoreFileStore.CHUNK, (i + 1) * FirestoreFileStore.CHUNK).toString('base64') });
    }
    // meta is written LAST: a half-written upload is never readable
    await this.db.set(COLLECTIONS.files, `${k}_meta`, { id: `${k}_meta`, key: k, path: safeRel(p), size: data.length, chunks: n });
  }
  async read(p: string): Promise<Buffer> {
    const k = this.key(p);
    const meta = await this.db.get<{ size: number; chunks: number }>(COLLECTIONS.files, `${k}_meta`);
    if (!meta) throw new Error('not_found');
    const parts: Buffer[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      const c = await this.db.get<{ data: string }>(COLLECTIONS.files, `${k}_${i}`);
      if (!c) throw new Error('file_corrupted');
      parts.push(Buffer.from(c.data, 'base64'));
    }
    const out = Buffer.concat(parts);
    if (out.length !== meta.size) throw new Error('file_corrupted');
    return out;
  }
  async remove(p: string): Promise<void> {
    const k = this.key(p);
    const meta = await this.db.get<{ chunks: number }>(COLLECTIONS.files, `${k}_meta`);
    await this.db.delete(COLLECTIONS.files, `${k}_meta`);
    for (let i = 0; i < (meta?.chunks ?? 0); i++) await this.db.delete(COLLECTIONS.files, `${k}_${i}`);
  }
}

export function createFileStore(cfg: Config, db?: Db): FileStore {
  if (cfg.STORAGE_MODE === 'firestore') {
    if (!db) throw new Error('STORAGE_MODE=firestore needs a database');
    return new FirestoreFileStore(db);
  }
  return cfg.STORAGE_MODE === 'firebase' ? new FirebaseFileStore(cfg) : new LocalFileStore(cfg.STORAGE_DIR);
}
