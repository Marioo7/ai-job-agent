import { canonTech } from './tech';
import type { CvProfile, Extracted, MatchResult, Preferences, ScoreCriterion, ScoreKey, Seniority } from './types';

const LEVEL: Record<Seniority, number> = { junior: 0, mid: 1, senior: 2 };
const round1 = (n: number) => Math.round(n * 10) / 10;

export function cvSeniority(years: number | null): Seniority | null {
  if (years === null) return null;
  return years < 2 ? 'junior' : years < 5 ? 'mid' : 'senior';
}

/**
 * Transparent, deterministic scoring. Every criterion reports its weight, a 0..1 score,
 * its contribution in points and a human-readable reason. Unknown job info gets a neutral score
 * and is flagged `known: false` — nothing is invented.
 */
export function scoreMatch(job: { extracted: Extracted; text: string }, cv: CvProfile, prefs: Preferences, now = new Date()): MatchResult {
  const ex = job.extracted;
  const text = job.text.toLowerCase();
  const w = prefs.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const concerns: string[] = [];
  const filterReasons: string[] = [];

  const mk = (key: ScoreKey, score: number, detail: string, known = true): ScoreCriterion => ({
    key, weight: w[key], score: Math.max(0, Math.min(1, score)), points: round1((w[key] / total) * Math.max(0, Math.min(1, score)) * 100), detail, known,
  });

  // --- skills
  const cvSkills = new Set([...cv.skills, ...cv.technologies].map(canonTech));
  const jobTech = [...new Set(ex.technologies.map(canonTech))];
  const matchedSkills = jobTech.filter((t) => cvSkills.has(t));
  const missingSkills = jobTech.filter((t) => !cvSkills.has(t));
  const skills = jobTech.length
    ? mk('skills', matchedSkills.length / jobTech.length, `${matchedSkills.length} of ${jobTech.length} listed technologies are in your CV`)
    : mk('skills', 0.5, 'The post lists no recognizable technologies (neutral score)', false);
  if (missingSkills.length) concerns.push(`Missing from CV: ${missingSkills.join(', ')}`);

  // --- experience
  let experience: ScoreCriterion;
  if (ex.experienceYears === null) experience = mk('experience', 0.6, 'Experience requirement not stated (neutral score)', false);
  else if (cv.yearsExperience === null) experience = mk('experience', 0.5, `Job asks ${ex.experienceYears}+ years; your CV experience is not set`, false);
  else if (cv.yearsExperience >= ex.experienceYears) experience = mk('experience', 1, `You have ${cv.yearsExperience} years vs ${ex.experienceYears} required`);
  else {
    experience = mk('experience', cv.yearsExperience / ex.experienceYears, `You have ${cv.yearsExperience} years vs ${ex.experienceYears} required`);
    concerns.push(`Experience gap: ${ex.experienceYears} years required, CV shows ${cv.yearsExperience}`);
  }

  // --- seniority
  const target: Seniority | null = prefs.experienceLevel !== 'any' ? prefs.experienceLevel : cvSeniority(cv.yearsExperience);
  let seniority: ScoreCriterion;
  if (!ex.seniority) seniority = mk('seniority', 0.6, 'Seniority not stated (neutral score)', false);
  else if (!target) seniority = mk('seniority', 0.6, `Job level is ${ex.seniority}; your level is unknown`, false);
  else {
    const diff = Math.abs(LEVEL[ex.seniority] - LEVEL[target]);
    seniority = mk('seniority', diff === 0 ? 1 : diff === 1 ? 0.5 : 0, `Job is ${ex.seniority}; your target is ${target}`);
    if (diff > 0) concerns.push(`Seniority mismatch: job is ${ex.seniority}, you target ${target}`);
  }

  // --- location / work mode
  let location: ScoreCriterion;
  const modes = prefs.workModes;
  if (modes.length === 0 && prefs.locations.length === 0) location = mk('location', 1, 'No location or work-mode preference set');
  else if (!ex.workMode && !ex.location) location = mk('location', 0.6, 'Location and work mode not stated (neutral score)', false);
  else {
    let s = 1;
    const parts: string[] = [];
    if (modes.length && ex.workMode) {
      if (modes.includes(ex.workMode)) parts.push(`${ex.workMode} is acceptable`);
      else { s = 0; parts.push(`${ex.workMode} is not in your preferred work modes`); concerns.push(`Work mode ${ex.workMode} is not preferred`); }
    }
    if (prefs.locations.length && ex.workMode !== 'remote') {
      if (ex.location) {
        const ok = prefs.locations.some((l) => ex.location!.toLowerCase().includes(l.toLowerCase()));
        if (ok) parts.push(`${ex.location} matches your locations`);
        else { s = Math.min(s, 0.2); parts.push(`${ex.location} is outside your preferred locations`); concerns.push(`Location ${ex.location} is outside preferred locations`); }
      } else s = Math.min(s, 0.6);
    }
    location = mk('location', s, parts.join('; ') || 'No conflicting information');
  }

  // --- title
  const titleText = `${ex.title ?? ''}`.toLowerCase();
  const titles = prefs.jobTitles.length === 0
    ? mk('titles', 1, 'No preferred job titles set')
    : prefs.jobTitles.some((t) => titleText.includes(t.toLowerCase()) || text.includes(t.toLowerCase()))
      ? mk('titles', 1, 'Matches a preferred job title')
      : mk('titles', 0, 'Does not match your preferred job titles');
  if (titles.score === 0) concerns.push('Job title is outside your preferred titles');

  // --- qualifications
  const mentionsDegree = /bachelor|b\.?sc|master|ph\.?d|degree|بكالوريوس|ماجستير|مؤهل/i.test(job.text);
  const qualifications = !mentionsDegree
    ? mk('qualifications', 0.8, 'No formal qualification stated', false)
    : cv.education.length
      ? mk('qualifications', 1, 'A degree is mentioned and your CV lists education')
      : mk('qualifications', 0.3, 'A degree is mentioned but your CV lists no education');
  if (mentionsDegree && !cv.education.length) concerns.push('Degree requirement mentioned; no education on your CV');

  const breakdown = [skills, experience, seniority, location, titles, qualifications];
  let score = Math.round(breakdown.reduce((a, c) => a + c.points, 0));

  // --- filters
  const excludedKw = prefs.excludedKeywords.filter((k) => k && text.includes(k.toLowerCase()));
  const excludedCo = prefs.excludedCompanies.filter((c) => c && ex.company && ex.company.toLowerCase().includes(c.toLowerCase()));
  const excluded = excludedKw.length > 0 || excludedCo.length > 0;
  if (excludedKw.length) filterReasons.push(`Excluded keyword: ${excludedKw.join(', ')}`);
  if (excludedCo.length) filterReasons.push(`Excluded company: ${excludedCo.join(', ')}`);
  if (excluded) score = 0;
  if (score < prefs.minScore) filterReasons.push(`Score ${score} is below your minimum of ${prefs.minScore}`);
  const pref = prefs.preferredTechnologies.map(canonTech);
  if (pref.length && jobTech.length && !jobTech.some((t) => pref.includes(t))) filterReasons.push('None of your preferred technologies are mentioned');

  return {
    score, breakdown, matchedSkills, missingSkills, concerns, excluded,
    meetsFilters: filterReasons.length === 0, filterReasons, cvVersionId: cv.id, computedAt: now.toISOString(),
  };
}
