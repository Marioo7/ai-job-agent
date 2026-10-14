import type { Db, QueryOpts, Where } from './types';

type Doc = Record<string, unknown>;

export class MemoryDb implements Db {
  private cols = new Map<string, Map<string, Doc>>();
  private col(c: string): Map<string, Doc> {
    let m = this.cols.get(c);
    if (!m) this.cols.set(c, (m = new Map()));
    return m;
  }
  private matches(d: Doc, where: Where[] = []): boolean {
    return where.every(([f, op, v]) => {
      const x = d[f] as never;
      return op === '==' ? x === v : op === '<' ? x < (v as never) : x > (v as never);
    });
  }
  async get<T>(col: string, id: string): Promise<T | null> {
    const d = this.col(col).get(id);
    return d ? (structuredClone(d) as T) : null;
  }
  async create(col: string, id: string, data: object): Promise<boolean> {
    if (this.col(col).has(id)) return false;
    this.col(col).set(id, structuredClone(data as Doc));
    return true;
  }
  async set(col: string, id: string, data: object): Promise<void> {
    this.col(col).set(id, structuredClone(data as Doc));
  }
  async update(col: string, id: string, patch: object): Promise<void> {
    const d = this.col(col).get(id);
    if (!d) throw new Error(`not_found: ${col}/${id}`);
    Object.assign(d, structuredClone(patch as Doc));
  }
  async delete(col: string, id: string): Promise<void> {
    this.col(col).delete(id);
  }
  async list<T>(col: string, q: QueryOpts = {}): Promise<T[]> {
    let rows = [...this.col(col).values()].filter((d) => this.matches(d, q.where));
    if (q.orderBy) {
      const [f, dir] = q.orderBy;
      rows.sort((a, b) => {
        const x = a[f] as never, y = b[f] as never;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1);
      });
      if (q.startAfter !== undefined) rows = rows.filter((d) => (dir === 'asc' ? (d[f] as never) > (q.startAfter as never) : (d[f] as never) < (q.startAfter as never)));
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows.map((d) => structuredClone(d) as T);
  }
  async count(col: string, where?: Where[]): Promise<number> {
    return [...this.col(col).values()].filter((d) => this.matches(d, where)).length;
  }
  async compareAndSet(col: string, id: string, expected: Record<string, unknown>, patch: object): Promise<boolean> {
    const d = this.col(col).get(id);
    if (!d) return false;
    for (const [k, v] of Object.entries(expected)) if (d[k] !== v) return false;
    Object.assign(d, structuredClone(patch as Doc));
    return true;
  }
}
