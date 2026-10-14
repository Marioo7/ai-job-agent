import { z } from 'zod';

const strList = (max = 50) => z.array(z.string().trim().min(1).max(60)).max(max);
const weight = z.number().min(0).max(100);

export const preferencesSchema = z.object({
  minScore: z.number().int().min(0).max(100),
  preferredTechnologies: strList(),
  jobTitles: strList(),
  workModes: z.array(z.enum(['remote', 'onsite', 'hybrid'])).max(3),
  locations: strList(),
  experienceLevel: z.enum(['any', 'junior', 'mid', 'senior']),
  excludedCompanies: strList(),
  excludedKeywords: strList(),
  weights: z.object({ skills: weight, experience: weight, seniority: weight, location: weight, titles: weight, qualifications: weight }),
  uiLanguage: z.enum(['en', 'ar']),
  emailLanguage: z.enum(['en', 'ar']),
  fullName: z.string().trim().max(100),
  aiEnabled: z.boolean(),
  autoApply: z.object({
    enabled: z.boolean(),
    minScore: z.number().int().min(50).max(100),
    dailyLimit: z.number().int().min(1).max(20),
    /** must be true when switching automatic mode on */
    acknowledged: z.boolean().optional(),
  }).optional(),
});

export const sourceInputSchema = z.object({
  ref: z.string().trim().min(1).max(200),
  title: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
});

export const extractedPatchSchema = z.object({
  title: z.string().trim().max(150).nullable().optional(),
  company: z.string().trim().max(150).nullable().optional(),
  location: z.string().trim().max(150).nullable().optional(),
  workMode: z.enum(['remote', 'onsite', 'hybrid']).nullable().optional(),
  technologies: strList(40).optional(),
  experienceYears: z.number().int().min(0).max(40).nullable().optional(),
  seniority: z.enum(['junior', 'mid', 'senior']).nullable().optional(),
  applicationEmail: z.string().trim().email().max(254).nullable().optional(),
  applicationLink: z.string().trim().url().max(500).nullable().optional(),
  salary: z.string().trim().max(100).nullable().optional(),
  deadline: z.string().trim().max(100).nullable().optional(),
});

export const jobPatchSchema = z.object({
  status: z.enum(['new', 'saved', 'rejected']).optional(),
  userRelevance: z.enum(['relevant', 'irrelevant']).nullable().optional(),
  extracted: extractedPatchSchema.optional(),
});

export const draftGenerateSchema = z.object({
  language: z.enum(['en', 'ar']).optional(),
  to: z.string().trim().email().max(254).nullable().optional(),
  useAi: z.boolean().optional(),
});

export const draftPatchSchema = z.object({
  to: z.string().trim().email().max(254).nullable().optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(10000).optional(),
  notes: z.string().max(2000).optional(),
});

/** The only payload that can trigger a send: explicit confirmation + the hash of what the user saw. */
export const sendSchema = z.object({
  confirmation: z.literal('SEND'),
  contentHash: z.string().min(16).max(128),
});

export const cvPatchSchema = z.object({
  fullName: z.string().trim().max(100).optional(),
  extractedText: z.string().max(200_000).optional(),
  skills: strList(100).optional(),
  technologies: strList(100).optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
  education: z.array(z.string().trim().max(200)).max(10).optional(),
  locations: strList(10).optional(),
  summary: z.string().max(2000).optional(),
});
