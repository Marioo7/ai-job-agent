import type { CvProfile } from '@ajaa/shared';
import type { Db } from './db/types';
import { uploadCv } from './cvService';
import type { FileStore } from './storage';

/** Builds a minimal valid text PDF (for tests and demos). */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \r\n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \r\n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

export const SAMPLE_CV_LINES = [
  'John Carter',
  'Software Engineer based in Cairo',
  '6 years of experience building web applications.',
  'Skills: React, TypeScript, JavaScript, Node.js, Docker, Git, PostgreSQL, REST API, HTML, CSS',
  'Bachelor of Science in Computer Science, Cairo University',
  'Experience: 2019 - 2025 Senior developer delivering SaaS products.',
];

export async function seedCv(db: Db, files: FileStore, uid: string): Promise<CvProfile> {
  return uploadCv({ db, files }, uid, { buffer: makePdf(SAMPLE_CV_LINES), originalName: 'john-cv.pdf' }, true);
}
