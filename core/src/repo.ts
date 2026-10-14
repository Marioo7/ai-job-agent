import { randomUUID } from 'node:crypto';
import { COLLECTIONS, defaultPreferences, type AuditLog, type CvProfile, type Page, type Preferences } from '@ajaa/shared';
import type { Db, Where } from './db/types';

export const nowIso = (d: Date = new Date()): string => d.toISOString();

/** Always scopes by uid. Cursor is the last item's order-field value. */
export async function pageByUid<T extends Record<string, unknown>>(
  db: Db, col: string, uid: string,
  o: { where?: Where[]; orderField: string; dir?: 'asc' | 'desc'; limit?: number; cursor?: string | null },
): Promise<Page<T>> {
  const limit = Math.min(Math.max(o.limit ?? 25, 1), 100);
  const rows = await db.list<T>(col, {
    where: [['uid', '==', uid], ...(o.where ?? [])],
    orderBy: [o.orderField, o.dir ?? 'desc'],
    startAfter: o.cursor ?? undefined,
    limit: limit + 1,
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? String(items[items.length - 1]![o.orderField]) : null };
}

export async function getPreferences(db: Db, uid: string): Promise<Preferences> {
  const p = await db.get<Preferences>(COLLECTIONS.userPreferences, uid);
  return p ? { ...defaultPreferences(uid), ...p, weights: { ...defaultPreferences(uid).weights, ...p.weights }, autoApply: { ...defaultPreferences(uid).autoApply, ...(p.autoApply ?? {}) }, uid } : defaultPreferences(uid);
}

export async function getActiveCv(db: Db, uid: string): Promise<CvProfile | null> {
  const rows = await db.list<CvProfile>(COLLECTIONS.cvProfiles, { where: [['uid', '==', uid], ['active', '==', true]], limit: 1 });
  return rows[0] ?? null;
}

export async function audit(db: Db, uid: string, action: string, entityType: string | null = null, entityId: string | null = null, meta: AuditLog['meta'] = {}): Promise<void> {
  const id = randomUUID();
  const entry: AuditLog = { id, uid, action, entityType, entityId, meta, createdAt: nowIso() };
  try { await db.set(COLLECTIONS.auditLogs, id, entry); } catch { /* audit must never break the main flow */ }
}
