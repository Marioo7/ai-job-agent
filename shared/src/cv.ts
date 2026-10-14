import { findTechnologies } from './tech';
import { normalizeText } from './parser';

export interface CvFields {
  fullName: string;
  skills: string[];
  technologies: string[];
  yearsExperience: number | null;
  education: string[];
  locations: string[];
  summary: string;
}

const CITY_RE = /\b(cairo|giza|alexandria|riyadh|jeddah|dubai|abu dhabi|doha|kuwait|amman)\b|القاهرة|الجيزة|الإسكندرية|الرياض|جدة|دبي/gi;

/** Heuristic extraction. Results are a starting point that the user must review and correct. */
export function extractCvFields(rawText: string): CvFields {
  const text = normalizeText(rawText);
  const techs = findTechnologies(text);

  let years: number | null = null;
  const explicit = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?experience/gi)].map((m) => parseInt(m[1]!, 10));
  if (explicit.length) years = Math.max(...explicit);
  else {
    const now = new Date().getFullYear();
    const spans = [...text.matchAll(/\b((?:19|20)\d{2})\s*[-–—to]+\s*((?:19|20)\d{2}|present|current|now)\b/gi)];
    if (spans.length) {
      const starts = spans.map((m) => parseInt(m[1]!, 10));
      const ends = spans.map((m) => (/^\d/.test(m[2]!) ? parseInt(m[2]!, 10) : now));
      const span = Math.max(...ends) - Math.min(...starts);
      if (span >= 0 && span <= 45) years = span;
    }
  }

  const education = text
    .split('\n')
    .filter((l) => /bachelor|b\.?sc|master|m\.?sc|ph\.?d|degree|university|بكالوريوس|ماجستير|جامعة|كلية/i.test(l))
    .map((l) => l.trim().slice(0, 160))
    .slice(0, 4);

  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const fullName = /^[\p{L}][\p{L} .'-]{2,40}$/u.test(first) && first.split(' ').length <= 4 ? first : '';

  const locations = [...new Set([...text.matchAll(CITY_RE)].map((m) => m[0].toLowerCase()))].slice(0, 3);

  return { fullName, skills: techs, technologies: techs, yearsExperience: years, education, locations, summary: '' };
}
