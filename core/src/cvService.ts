import { createHash, randomUUID } from 'node:crypto';
import { COLLECTIONS, extractCvFields, type CvProfile } from '@ajaa/shared';
import type { Db } from './db/types';
import { AppError } from './errors';
import { extractPdfText, validatePdfBuffer } from './pdf';
import { audit, nowIso } from './repo';
import type { FileStore } from './storage';

export async function listCvs(db: Db, uid: string): Promise<CvProfile[]> {
  return db.list<CvProfile>(COLLECTIONS.cvProfiles, { where: [['uid', '==', uid]], orderBy: ['version', 'desc'], limit: 50 });
}

export async function activateCv(db: Db, uid: string, id: string): Promise<void> {
  const cv = await db.get<CvProfile>(COLLECTIONS.cvProfiles, id);
  if (!cv || cv.uid !== uid) throw new AppError(404, 'cv_not_found', 'CV not found.');
  const all = await listCvs(db, uid);
  for (const o of all) if (o.active && o.id !== id) await db.update(COLLECTIONS.cvProfiles, o.id, { active: false, updatedAt: nowIso() });
  await db.update(COLLECTIONS.cvProfiles, id, { active: true, updatedAt: nowIso() });
  await audit(db, uid, 'cv.activated', 'cv', id);
}

/** Validates real PDF bytes, extracts text, stores the file privately and creates a new version. */
export async function uploadCv(deps: { db: Db; files: FileStore }, uid: string, file: { buffer: Buffer; originalName: string }, activate = true): Promise<CvProfile> {
  validatePdfBuffer(file.buffer);
  const { text } = await extractPdfText(file.buffer);
  const existing = await listCvs(deps.db, uid);
  const id = `cv_${randomUUID()}`;
  const storagePath = `cv/${uid}/${id}.pdf`;
  const now = nowIso();
  const fields = extractCvFields(text);
  const safeName = file.originalName.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'cv.pdf';
  const cv: CvProfile = {
    id, uid, version: (existing[0]?.version ?? 0) + 1, fileName: safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`, storagePath,
    sha256: createHash('sha256').update(file.buffer).digest('hex'), sizeBytes: file.buffer.length, extractedText: text.slice(0, 200_000),
    ...fields, active: false, createdAt: now, updatedAt: now,
  };
  await deps.files.put(storagePath, file.buffer, 'application/pdf');
  await deps.db.set(COLLECTIONS.cvProfiles, id, cv);
  if (activate || existing.length === 0) await activateCv(deps.db, uid, id);
  await audit(deps.db, uid, 'cv.uploaded', 'cv', id, { version: cv.version });
  return (await deps.db.get<CvProfile>(COLLECTIONS.cvProfiles, id))!;
}
