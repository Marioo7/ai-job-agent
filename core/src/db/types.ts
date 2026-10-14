export type Where = [field: string, op: '==' | '<' | '>', value: unknown];

export interface QueryOpts {
  where?: Where[];
  orderBy?: [field: string, dir: 'asc' | 'desc'];
  startAfter?: unknown;
  limit?: number;
}

/** Minimal document-store interface implemented by Firestore (production) and memory (tests/demo). */
export interface Db {
  get<T>(col: string, id: string): Promise<T | null>;
  /** Atomically create; returns false if the document already exists (used for duplicate prevention). */
  create(col: string, id: string, data: object): Promise<boolean>;
  set(col: string, id: string, data: object): Promise<void>;
  update(col: string, id: string, patch: object): Promise<void>;
  delete(col: string, id: string): Promise<void>;
  list<T>(col: string, q?: QueryOpts): Promise<T[]>;
  count(col: string, where?: Where[]): Promise<number>;
  /** Atomic compare-and-set: applies `patch` only if every field in `expected` currently matches. */
  compareAndSet(col: string, id: string, expected: Record<string, unknown>, patch: object): Promise<boolean>;
}
