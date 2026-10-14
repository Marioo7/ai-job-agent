import type { CvProfile, Extracted, Lang } from './types';

export const PLACEHOLDER_RE = /\[(?:your name|name|company|full name)\]/i;

export interface DraftText { subject: string; body: string }

/** Deterministic, no-AI draft. Uses only facts present in the job post and the CV. */
export function buildTemplateDraft(input: {
  extracted: Extracted;
  cv: Pick<CvProfile, 'yearsExperience' | 'skills' | 'technologies'>;
  matchedSkills: string[];
  language: Lang;
  fullName: string;
}): DraftText {
  const { extracted: ex, cv, matchedSkills, language } = input;
  const name = input.fullName.trim() || '[Your name]';
  const title = ex.title ?? (language === 'ar' ? 'الوظيفة المعلنة' : 'the advertised position');
  const skills = (matchedSkills.length ? matchedSkills : cv.skills).slice(0, 6);
  const years = cv.yearsExperience;

  if (language === 'ar') {
    const co = ex.company ? ` في ${ex.company}` : '';
    return {
      subject: `التقديم على وظيفة: ${title}`,
      body: [
        'السادة فريق التوظيف المحترمين،',
        '',
        `أتقدم لكم بطلب التقديم على وظيفة ${title}${co}.`,
        years !== null ? `لدي خبرة تقارب ${years} سنوات.` : '',
        skills.length ? `تشمل مهاراتي المرتبطة بالوظيفة: ${skills.join('، ')}.` : '',
        '',
        'أرفقت سيرتي الذاتية للاطلاع، ويسعدني مناقشة كيف يمكنني الإسهام في فريقكم.',
        '',
        'مع خالص التحية،',
        name === '[Your name]' ? '[Your name]' : name,
      ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
    };
  }
  const co = ex.company ? ` at ${ex.company}` : '';
  return {
    subject: `Application for ${title}${ex.company ? ` – ${ex.company}` : ''}`,
    body: [
      'Dear Hiring Team,',
      '',
      `I am writing to apply for the ${title} position${co}.`,
      years !== null ? `I have about ${years} years of experience.` : '',
      skills.length ? `My CV highlights experience relevant to this role, including ${skills.join(', ')}.` : '',
      '',
      'I have attached my CV for your review and would welcome the chance to discuss how I can contribute to your team.',
      '',
      'Kind regards,',
      name,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
  };
}
