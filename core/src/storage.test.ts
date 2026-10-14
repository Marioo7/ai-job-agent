import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@ajaa/shared';
import { FirestoreFileStore, MemoryDb } from './index';

describe('Firestore-backed file store (free plan, no Cloud Storage)', () => {
  it('round-trips files of any size, in chunks under the 1 MiB document limit', async () => {
    const db = new MemoryDb();
    const fs = new FirestoreFileStore(db);
    for (const size of [1, 499_999, 500_000, 500_001, 1_300_000]) {
      const data = randomBytes(size);
      await fs.put(`cv/u1/f${size}.pdf`, data);
      expect((await fs.read(`cv/u1/f${size}.pdf`)).equals(data)).toBe(true);
    }
    const docs = await db.list<{ data?: string }>(COLLECTIONS.files);
    expect(Math.max(...docs.map((d) => d.data?.length ?? 0))).toBeLessThan(1_000_000);
  });

  it('overwrites, removes, rejects path traversal and never exposes half-written files', async () => {
    const db = new MemoryDb();
    const fs = new FirestoreFileStore(db);
    await fs.put('cv/u1/a.pdf', randomBytes(900_000));
    const small = randomBytes(10);
    await fs.put('cv/u1/a.pdf', small);
    expect((await fs.read('cv/u1/a.pdf')).equals(small)).toBe(true);
    expect(await db.count(COLLECTIONS.files)).toBe(2); // 1 chunk + meta: old chunks were deleted

    await fs.remove('cv/u1/a.pdf');
    await expect(fs.read('cv/u1/a.pdf')).rejects.toThrow('not_found');
    expect(await db.count(COLLECTIONS.files)).toBe(0);
    await expect(fs.put('../etc/passwd', Buffer.from('x'))).rejects.toThrow();

    // simulate a crash after chunks were written but before the meta doc: not readable
    await db.set(COLLECTIONS.files, 'abc_0', { id: 'abc_0', data: 'AAAA' });
    await expect(fs.read('cv/u1/never.pdf')).rejects.toThrow();
  });
});
