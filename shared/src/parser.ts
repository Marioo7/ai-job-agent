import { findTechnologies } from './tech';
import type { Extracted, Seniority, WorkMode } from './types';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Non-cryptographic 53-bit hash (cyrb53) used for cross-post duplicate detection. */
export function textHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Hash used to detect the same post cross-posted in several channels (ignores case, spacing, links). */
export function contentFingerprint(text: string): string {
  const canon = normalizeText(text).toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return textHash(canon);
}

/** Stable unique key for a Telegram message: one job per (user, source, message). */
export function messageKey(uid: string, sourceId: string | number, messageId: string | number): string {
  return `${uid}_${String(sourceId).replace(/[^\w-]/g, '')}_${String(messageId).replace(/[^\w-]/g, '')}`;
}

const STRONG = [
  /\bhiring\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bjob (?:opening|opportunity|description)\b/i,
  /\bwe(?:'re| are) looking for\b/i,
  /\bposition\b/i,
  /مطلوب/,
  /وظيفة|وظائف|فرصة عمل|شاغر/,
];
const WEAK = [
  /\bapply\b/i,
  /\bcv\b/i,
  /\bresume\b/i,
  /\bresponsibilities\b/i,
  /\brequirements?\b/i,
  /\bqualifications\b/i,
  /\bexperience\b/i,
  /التقديم|السيرة الذاتية|ارسل|أرسل/,
  /المتطلبات|المسؤوليات|الخبرة|خبرة/,
];
const ROLE =
  /\b(?:developer|engineer|designer|analyst|manager|architect|devops|qa|tester|accountant|specialist|administrator|consultant|intern|officer|coordinator|scientist|programmer|writer|marketer)\b|مطور|مهندس|مصمم|محلل|مدير|محاسب|متخصص|أخصائي|اخصائي|مبرمج/i;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const PREFIX = String.raw`(?:^|\n)[^\p{L}\p{N}\n]*`;

export function detectJob(text: string): { isJob: boolean; signals: number } {
  const t = normalizeText(text);
  if (t.length < 40) return { isJob: false, signals: 0 };
  const strong = STRONG.filter((r) => r.test(t)).length;
  const weak = WEAK.filter((r) => r.test(t)).length;
  const role = ROLE.test(t) ? 1 : 0;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) ? 1 : 0;
  const signals = strong + weak + role + email;
  return { isJob: strong >= 1 && signals >= 3, signals };
}

function labeled(text: string, labels: string): string | null {
  const m = new RegExp(`${PREFIX}(?:${labels})\\s*[:：\\-–]\\s*(.+)`, 'iu').exec(text);
  const v = m?.[1]?.trim();
  return v ? v.slice(0, 120) : null;
}

function cleanTitle(line: string): string | null {
  const t = line
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\b(?:we are hiring|we're hiring|hiring|we are looking for|we're looking for|vacancy)\b[:!\-–]*/gi, '')
    .replace(/^(?:مطلوب|نبحث عن|فرصة عمل|وظيفة)\s*[:\-–]?\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 3 ? t.slice(0, 100) : null;
}

function extractTitle(text: string): string | null {
  const l = labeled(text, 'job title|position|role|vacancy|title|المسمى الوظيفي|الوظيفة|المسمى');
  if (l) return cleanTitle(l);
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const hit = lines.find((x) => ROLE.test(x) && x.length <= 140);
  return hit ? cleanTitle(hit) : null;
}

function extractCompany(text: string): string | null {
  const l = labeled(text, 'company|employer|organization|organisation|الشركة|جهة العمل');
  if (l) return l;
  const m1 = /^[^\p{L}\p{N}\n]*(.{2,50}?)\s+(?:is|are)\s+hiring\b/imu.exec(text);
  if (m1?.[1] && !/^(?:we|they|our|i|who|and)$/i.test(m1[1].trim())) return m1[1].trim();
  const m2 = /تعلن\s+(?:شركة\s+)?(.{2,40}?)\s+عن/u.exec(text);
  return m2?.[1]?.trim() ?? null;
}

const CITIES = ['cairo', 'giza', 'alexandria', 'riyadh', 'jeddah', 'dubai', 'abu dhabi', 'doha', 'kuwait', 'amman', 'القاهرة', 'الجيزة', 'الإسكندرية', 'الرياض', 'جدة', 'دبي'];
function extractLocation(text: string): string | null {
  const l = labeled(text, 'location|city|المكان|الموقع|المدينة');
  if (l) return l;
  const lower = text.toLowerCase();
  const city = CITIES.find((c) => lower.includes(c));
  return city ? city.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function extractWorkMode(text: string): WorkMode | null {
  if (/\bhybrid\b|هجين/i.test(text)) return 'hybrid';
  if (/\bremote\b|work from home|\bwfh\b|عن بعد|ريموت/i.test(text)) return 'remote';
  if (/\bon[- ]?site\b|in[- ]office|من المكتب|حضوري/i.test(text)) return 'onsite';
  return null;
}

function extractExperience(text: string): number | null {
  const re = /(\d{1,2})\s*(?:\+|plus)?(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?|سنوات|سنة|سنين|أعوام|عام)/gi;
  const lines = text.split('\n');
  const prefer = lines.filter((x) => /experience|\bexp\b|خبرة/i.test(x));
  for (const pool of [prefer, lines]) {
    for (const line of pool) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m?.[1]) {
        const n = parseInt(m[1], 10);
        if (n >= 0 && n <= 40) return n;
      }
    }
  }
  return null;
}

function extractSeniority(text: string, years: number | null): Seniority | null {
  if (/\b(?:senior|sr\.?|lead|principal|staff)\b|سينيور|خبير/i.test(text)) return 'senior';
  if (/\b(?:junior|jr\.?|fresh(?:er)?|graduate|entry[- ]level|trainee|intern)\b|مبتدئ|حديث التخرج|جونيور/i.test(text)) return 'junior';
  if (/\bmid(?:[- ]level)?\b|متوسط/i.test(text)) return 'mid';
  if (years === null) return null;
  return years <= 1 ? 'junior' : years < 5 ? 'mid' : 'senior';
}

function extractSalary(text: string): string | null {
  const l = /(?:salary|compensation|راتب|الراتب)\s*[:：\-–]?\s*([^\n]{3,60})/i.exec(text);
  if (l?.[1]) return l[1].trim();
  const m = /\$\s?\d[\d,]*(?:\s?[-–]\s?\$?\d[\d,]*)?(?:\s?(?:k|\/month|per month))?|\d[\d,]*\s?(?:EGP|USD|SAR|AED|جنيه|ريال|درهم)/i.exec(text);
  return m?.[0]?.trim() ?? null;
}

function extractDeadline(text: string): string | null {
  const m = /(?:deadline|apply (?:by|before)|closing date|آخر موعد|اخر موعد|الموعد النهائي)\s*[:：\-–]?\s*([^\n]{3,40})/i.exec(text);
  return m?.[1]?.trim() ?? null;
}

function extractEmails(text: string): { email: string | null; candidates: string[] } {
  const all = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.replace(/[.,;:]+$/, '').toLowerCase()))];
  if (all.length === 0) return { email: null, candidates: [] };
  if (all.length === 1) return { email: all[0]!, candidates: all };
  // several emails: only choose one if exactly one appears on a line that talks about applying
  const applyLine = text.split('\n').filter((l) => /apply|send|cv|resume|ارسل|أرسل|تقديم|التقديم|السيرة/i.test(l));
  const near = all.filter((e) => applyLine.some((l) => l.toLowerCase().includes(e)));
  return { email: near.length === 1 ? near[0]! : null, candidates: all };
}

function extractLink(text: string): string | null {
  const urls = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!]+$/, ''));
  const nonTelegram = urls.filter((u) => !/^https?:\/\/(?:t\.me|telegram\.me)\//i.test(u));
  const applyLine = text.split('\n').find((l) => /apply|link|التقديم|رابط/i.test(l) && nonTelegram.some((u) => l.includes(u)));
  if (applyLine) return nonTelegram.find((u) => applyLine.includes(u)) ?? null;
  return nonTelegram[0] ?? null;
}

export function extractJobFields(raw: string): Extracted {
  const text = normalizeText(raw);
  const experienceYears = extractExperience(text);
  const { email, candidates } = extractEmails(text);
  return {
    title: extractTitle(text),
    company: extractCompany(text),
    location: extractLocation(text),
    workMode: extractWorkMode(text),
    technologies: findTechnologies(text),
    experienceYears,
    seniority: extractSeniority(text, experienceYears),
    applicationEmail: email,
    emailCandidates: candidates,
    applicationLink: extractLink(text),
    salary: extractSalary(text),
    deadline: extractDeadline(text),
  };
}

export function emptyExtracted(): Extracted {
  return {
    title: null, company: null, location: null, workMode: null, technologies: [], experienceYears: null,
    seniority: null, applicationEmail: null, emailCandidates: [], applicationLink: null, salary: null, deadline: null,
  };
}

export function isValidEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/.test(s);
}
