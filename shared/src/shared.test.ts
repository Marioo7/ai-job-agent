import { describe, expect, it } from 'vitest';
import {
  buildTemplateDraft, contentFingerprint, defaultPreferences, detectJob, extractCvFields, extractJobFields, messageKey, normalizeText, scoreMatch, PLACEHOLDER_RE,
  type CvProfile,
} from './index';

const EN_JOB = `We are hiring: Senior React Developer
Company: Acme Labs
Location: Cairo (Hybrid)
Requirements: 4+ years of experience with React, TypeScript, Node.js and Docker.
Bachelor degree in Computer Science.
Salary: 40,000 EGP
Deadline: 30 November
Send your CV to careers@acme.example`;

const AR_JOB = `مطلوب مطور Python
الشركة: شركة المثال
الموقع: الرياض - عن بعد
المتطلبات: خبرة ٣ سنوات في Python و Django
للتقديم ارسل السيرة الذاتية على jobs@example.org`;

const cv = (over: Partial<CvProfile> = {}): CvProfile => ({
  id: 'cv1', uid: 'u', version: 1, fileName: 'cv.pdf', storagePath: 'x', sha256: 'abc', sizeBytes: 1, extractedText: '', fullName: 'John Carter',
  skills: ['react', 'typescript', 'node.js', 'git'], technologies: [], yearsExperience: 6, education: ['BSc Computer Science'], locations: ['cairo'], summary: '',
  active: true, createdAt: '', updatedAt: '', ...over,
});

describe('job parsing', () => {
  it('detects and extracts an English post without inventing data', () => {
    expect(detectJob(EN_JOB).isJob).toBe(true);
    const x = extractJobFields(EN_JOB);
    expect(x.title).toBe('Senior React Developer');
    expect(x.company).toBe('Acme Labs');
    expect(x.applicationEmail).toBe('careers@acme.example');
    expect(x.workMode).toBe('hybrid');
    expect(x.experienceYears).toBe(4);
    expect(x.seniority).toBe('senior');
    expect(x.technologies).toEqual(expect.arrayContaining(['react', 'typescript', 'node.js', 'docker']));
    expect(x.deadline).toBe('30 November');
    expect(x.salary).toContain('40,000');
  });

  it('handles Arabic posts and Arabic-Indic digits', () => {
    expect(detectJob(AR_JOB).isJob).toBe(true);
    const x = extractJobFields(AR_JOB);
    expect(x.experienceYears).toBe(3);
    expect(x.workMode).toBe('remote');
    expect(x.applicationEmail).toBe('jobs@example.org');
    expect(x.technologies).toEqual(expect.arrayContaining(['python', 'django']));
  });

  it('returns unknowns (null) for missing information', () => {
    const x = extractJobFields('We are hiring a developer. Apply via the link in our bio, details soon, thanks everyone for reading this post.');
    expect(x.applicationEmail).toBeNull();
    expect(x.company).toBeNull();
    expect(x.salary).toBeNull();
    expect(x.deadline).toBeNull();
    expect(x.experienceYears).toBeNull();
  });

  it('does not guess when several emails are present without a clear apply line', () => {
    const x = extractJobFields('Hiring QA engineer. Contacts: hr@a.example and info@b.example for general questions about the company.');
    expect(x.applicationEmail).toBeNull();
    expect(x.emailCandidates.sort()).toEqual(['hr@a.example', 'info@b.example']);
  });

  it('ignores chit-chat', () => {
    expect(detectJob('Good morning everyone! Meetup this Friday, pizza provided, see you there friends.').isJob).toBe(false);
    expect(detectJob('hi').isJob).toBe(false);
  });

  it('does not confuse java with javascript', () => {
    expect(extractJobFields('Hiring: Java developer needed, Java and Spring Boot experience required, send CV').technologies).toEqual(expect.arrayContaining(['java']));
    expect(extractJobFields('Hiring: Java developer needed, Java and Spring Boot experience required, send CV').technologies).not.toContain('javascript');
  });
});

describe('duplicate detection helpers', () => {
  it('builds a stable unique key per user/source/message', () => {
    expect(messageKey('u1', -100123, 5)).toBe('u1_-100123_5');
    expect(messageKey('u1', -100123, 5)).not.toBe(messageKey('u2', -100123, 5));
  });
  it('fingerprints cross-posts regardless of case, spacing and links', () => {
    const a = contentFingerprint('Hiring React dev!  Apply: https://x.example/1');
    const b = contentFingerprint('hiring   react DEV! apply: https://y.example/2');
    expect(a).toBe(b);
    expect(a).not.toBe(contentFingerprint('Hiring Python dev! Apply: https://x.example/1'));
  });
  it('normalizes text', () => {
    expect(normalizeText('  a\u200b b \r\n\r\n\r\n\r\n c ')).toBe('a b\n\nc');
  });
});

describe('match scoring', () => {
  const ex = extractJobFields(EN_JOB);
  it('scores a good match highly and explains matched/missing skills', () => {
    const r = scoreMatch({ extracted: ex, text: EN_JOB }, cv(), defaultPreferences('u'));
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.matchedSkills).toEqual(expect.arrayContaining(['react', 'typescript', 'node.js']));
    expect(r.missingSkills).toEqual(['docker']);
    expect(r.concerns.join(' ')).toContain('docker');
    expect(r.breakdown).toHaveLength(6);
    expect(Math.round(r.breakdown.reduce((a, c) => a + c.points, 0))).toBe(r.score);
    expect(r.meetsFilters).toBe(true);
  });
  it('flags unknown information instead of inventing it', () => {
    const e = extractJobFields('We are hiring a developer. Send your CV to jobs@x.example for details, many thanks to everyone.');
    const r = scoreMatch({ extracted: e, text: 'We are hiring a developer.' }, cv(), defaultPreferences('u'));
    expect(r.breakdown.find((c) => c.key === 'skills')!.known).toBe(false);
    expect(r.breakdown.find((c) => c.key === 'experience')!.known).toBe(false);
  });
  it('applies excluded keywords and minimum score filters', () => {
    const p = { ...defaultPreferences('u'), excludedKeywords: ['bachelor'] };
    const r = scoreMatch({ extracted: ex, text: EN_JOB }, cv(), p);
    expect(r.excluded).toBe(true);
    expect(r.score).toBe(0);
    expect(r.meetsFilters).toBe(false);
    const hi = scoreMatch({ extracted: ex, text: EN_JOB }, cv({ skills: [] }), { ...defaultPreferences('u'), minScore: 95 });
    expect(hi.meetsFilters).toBe(false);
    expect(hi.filterReasons.join(' ')).toContain('below');
  });
  it('respects editable weights', () => {
    const base = defaultPreferences('u');
    const onlySkills = { ...base, weights: { skills: 100, experience: 0, seniority: 0, location: 0, titles: 0, qualifications: 0 } };
    const r = scoreMatch({ extracted: ex, text: EN_JOB }, cv(), onlySkills);
    expect(r.score).toBe(75); // 3 of 4 technologies
  });
  it('penalizes work-mode and location conflicts', () => {
    const p = { ...defaultPreferences('u'), workModes: ['remote' as const] };
    const r = scoreMatch({ extracted: ex, text: EN_JOB }, cv(), p);
    expect(r.breakdown.find((c) => c.key === 'location')!.score).toBe(0);
    expect(r.concerns.join(' ')).toContain('Work mode');
  });
});

describe('cv extraction + draft template', () => {
  const text = 'John Carter\nSoftware Engineer\n6 years of professional experience\nReact, TypeScript, Docker\nBachelor of Science, Cairo University\nCairo';
  it('extracts structured fields heuristically', () => {
    const f = extractCvFields(text);
    expect(f.fullName).toBe('John Carter');
    expect(f.yearsExperience).toBe(6);
    expect(f.skills).toEqual(expect.arrayContaining(['react', 'typescript', 'docker']));
    expect(f.education[0]).toContain('Bachelor');
  });
  it('drafts only from CV facts and leaves a visible placeholder if the name is unknown', () => {
    const ex = extractJobFields(EN_JOB);
    const d = buildTemplateDraft({ extracted: ex, cv: cv(), matchedSkills: ['react', 'typescript'], language: 'en', fullName: '' });
    expect(d.body).toContain('react, typescript');
    expect(d.body).not.toContain('docker');
    expect(d.body).toContain('about 6 years');
    expect(PLACEHOLDER_RE.test(d.body)).toBe(true);
    const named = buildTemplateDraft({ extracted: ex, cv: cv(), matchedSkills: [], language: 'ar', fullName: 'John Carter' });
    expect(named.body).toContain('John Carter');
    expect(PLACEHOLDER_RE.test(named.body)).toBe(false);
  });
});
