import type { CvProfile, Extracted, Lang, MatchResult, WorkMode } from '@ajaa/shared';

export type AiErrorCode = 'missing_key' | 'quota' | 'network' | 'bad_response' | 'daily_cap';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiExtraction {
  isJob: boolean;
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: WorkMode | null;
  technologies: string[];
  experienceYears: number | null;
  applicationEmail: string | null;
  applicationLink: string | null;
  salary: string | null;
  deadline: string | null;
}

export interface AiProvider {
  readonly name: string;
  /** false = AI disabled entirely (nothing leaves the machine). */
  readonly enabled: boolean;
  /** true = offline deterministic stand-in for development. */
  readonly isMock: boolean;
  extractJob(text: string): Promise<AiExtraction | null>;
  analyzeMatch(i: { jobText: string; extracted: Extracted; cv: Pick<CvProfile, 'skills' | 'yearsExperience' | 'education' | 'summary'>; match: MatchResult }): Promise<string>;
  writeEmail(i: { jobText: string; extracted: Extracted; cv: Pick<CvProfile, 'extractedText' | 'skills' | 'yearsExperience'>; matchedSkills: string[]; language: Lang; fullName: string }): Promise<{ subject: string; body: string }>;
}
