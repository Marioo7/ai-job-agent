export type ISODate = string;
export type WorkMode = 'remote' | 'onsite' | 'hybrid';
export type ExperienceLevel = 'any' | 'junior' | 'mid' | 'senior';
export type Seniority = 'junior' | 'mid' | 'senior';
export type Lang = 'en' | 'ar';
export type JobStatus = 'new' | 'matched' | 'low_match' | 'saved' | 'rejected' | 'draft_ready' | 'sent' | 'failed';
export type DraftStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'rejected';
export type ApplicationStatus = 'sending' | 'sent' | 'failed';

export const JOB_STATUSES: JobStatus[] = ['new', 'matched', 'low_match', 'saved', 'rejected', 'draft_ready', 'sent', 'failed'];
export const DRAFT_STATUSES: DraftStatus[] = ['draft', 'sending', 'sent', 'failed', 'rejected'];

export const COLLECTIONS = {
  users: 'users',
  userPreferences: 'userPreferences',
  cvProfiles: 'cvProfiles',
  telegramSources: 'telegramSources',
  telegramMessages: 'telegramMessages',
  jobs: 'jobs',
  emailDrafts: 'emailDrafts',
  applications: 'applications',
  integrations: 'integrations',
  workerStatus: 'workerStatus',
  auditLogs: 'auditLogs',
  aiUsage: 'aiUsage',
  jobKeys: 'jobKeys',
  files: 'files',
  autoApplyState: 'autoApplyState',
} as const;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Extracted {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: WorkMode | null;
  technologies: string[];
  experienceYears: number | null;
  seniority: Seniority | null;
  applicationEmail: string | null;
  emailCandidates: string[];
  applicationLink: string | null;
  salary: string | null;
  deadline: string | null;
}

export interface ScoreCriterion {
  key: ScoreKey;
  weight: number;
  /** 0..1 */
  score: number;
  /** contribution to the final 0..100 score */
  points: number;
  detail: string;
  /** false when the job post did not state the information (neutral score used) */
  known: boolean;
}

export type ScoreKey = 'skills' | 'experience' | 'seniority' | 'location' | 'titles' | 'qualifications';

export interface MatchResult {
  score: number;
  breakdown: ScoreCriterion[];
  matchedSkills: string[];
  missingSkills: string[];
  concerns: string[];
  excluded: boolean;
  meetsFilters: boolean;
  filterReasons: string[];
  cvVersionId: string;
  computedAt: ISODate;
}

export interface Job {
  id: string;
  uid: string;
  sourceId: string;
  sourceName: string;
  messageId: string;
  sourceLink: string | null;
  messageDate: ISODate;
  originalText: string;
  contentHash: string;
  extracted: Extracted;
  extractionMethod: 'heuristic' | 'heuristic+ai';
  match: MatchResult | null;
  aiAnalysis: string | null;
  aiError: string | null;
  status: JobStatus;
  userRelevance: 'relevant' | 'irrelevant' | null;
  /** false until the automatic-apply cycle has looked at this job once (keeps Firestore reads low) */
  autoChecked?: boolean;
  isDemo: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TelegramMessage {
  id: string;
  uid: string;
  sourceId: string;
  sourceName: string;
  messageId: string;
  date: ISODate;
  text: string;
  sourceLink: string | null;
  contentHash: string;
  processed: boolean;
  isJob: boolean | null;
  attempts: number;
  error: string | null;
  duplicateOf: string | null;
  isDemo: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TelegramSource {
  id: string;
  uid: string;
  ref: string;
  title: string;
  enabled: boolean;
  resolvedId: string | null;
  username: string | null;
  lastMessageId: number;
  lastSyncAt: ISODate | null;
  lastError: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CvProfile {
  id: string;
  uid: string;
  version: number;
  fileName: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  extractedText: string;
  fullName: string;
  skills: string[];
  technologies: string[];
  yearsExperience: number | null;
  education: string[];
  locations: string[];
  summary: string;
  active: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ScoreWeights {
  skills: number;
  experience: number;
  seniority: number;
  location: number;
  titles: number;
  qualifications: number;
}

export interface Preferences {
  uid: string;
  /** @deprecated kept for old documents; no longer used */
  preferredTechnologies: string[];
  jobTitles: string[];
  workModes: WorkMode[];
  locations: string[];
  experienceLevel: ExperienceLevel;
  excludedCompanies: string[];
  excludedKeywords: string[];
  weights: ScoreWeights;
  uiLanguage: Lang;
  emailLanguage: Lang;
  fullName: string;
  aiEnabled: boolean;
  /** Optional hands-free mode. OFF by default; see core/src/autoApply.ts for the safety rules. */
  autoApply: { enabled: boolean; dailyLimit: number; enabledAt: ISODate | null };
  updatedAt: ISODate;
}

export interface EmailDraft {
  id: string;
  uid: string;
  jobId: string;
  to: string | null;
  toSource: 'source' | 'user' | null;
  subject: string;
  body: string;
  notes: string;
  language: Lang;
  cvVersionId: string;
  cvFileName: string;
  generatedBy: 'template' | 'ai';
  status: DraftStatus;
  version: number;
  approval: { approvedAt: ISODate; approvedBy: string; contentHash: string } | null;
  lastError: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Application {
  id: string;
  uid: string;
  jobId: string;
  draftId: string;
  to: string;
  subject: string;
  body: string;
  cvVersionId: string;
  cvFileName: string;
  status: ApplicationStatus;
  attempts: number;
  gmailMessageId: string | null;
  simulated: boolean;
  autoApplied?: boolean;
  error: string | null;
  sentAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface WorkerStatus {
  uid: string;
  state: 'starting' | 'running' | 'degraded' | 'stopped';
  mode: 'real' | 'mock';
  telegramConnected: boolean;
  startedAt: ISODate;
  lastHeartbeatAt: ISODate;
  lastUpdateAt: ISODate | null;
  lastCatchUpAt: ISODate | null;
  lastError: string | null;
  testRequestedAt: ISODate | null;
  testResult: { at: ISODate; ok: boolean; detail: string } | null;
  version: string;
}

export interface AuditLog {
  id: string;
  uid: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, string | number | boolean | null>;
  createdAt: ISODate;
}

export function defaultPreferences(uid: string): Preferences {
  return {
    uid,
    preferredTechnologies: [],
    jobTitles: [],
    workModes: [],
    locations: [],
    experienceLevel: 'any',
    excludedCompanies: [],
    excludedKeywords: [],
    weights: { skills: 35, experience: 20, seniority: 10, location: 15, titles: 10, qualifications: 10 },
    uiLanguage: 'en',
    emailLanguage: 'en',
    fullName: '',
    aiEnabled: true,
    autoApply: { enabled: false, dailyLimit: 20, enabledAt: null },
    updatedAt: new Date(0).toISOString(),
  };
}
