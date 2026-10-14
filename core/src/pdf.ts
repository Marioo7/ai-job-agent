import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from './errors';

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const MIN_CV_TEXT_CHARS = 100;
const MAX_PAGES = 15;

/** Validate the real bytes (magic header + size), not the file name or declared MIME type. */
export function validatePdfBuffer(buf: Buffer, maxBytes = MAX_CV_BYTES): void {
  if (!buf || buf.length === 0) throw new AppError(400, 'empty_file', 'The uploaded file is empty.');
  if (buf.length > maxBytes) throw new AppError(413, 'file_too_large', `The PDF is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(415, 'not_a_pdf', 'The file is not a valid PDF.');
}

export async function extractPdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  validatePdfBuffer(buf);
  let text = '';
  let pages = 0;
  try {
    const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    pages = doc.numPages;
    for (let i = 1; i <= Math.min(pages, MAX_PAGES); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      for (const it of tc.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : ' ');
      text += '\n';
    }
    await doc.destroy();
  } catch {
    throw new AppError(422, 'pdf_unreadable', 'The PDF could not be read. It may be corrupted or password-protected.');
  }
  text = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < MIN_CV_TEXT_CHARS) {
    throw new AppError(422, 'pdf_no_text', 'Almost no text could be extracted. Scanned/image-only PDFs are not supported — upload a text-based PDF.');
  }
  return { text, pages };
}
