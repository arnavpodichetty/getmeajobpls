// Picks a resume for the current page from keyword rules.
//
// 1. Job title first: the rule matching the most distinct keywords in the
//    title wins (ties go to the rule listed first).
// 2. Otherwise page text: each keyword scores its occurrence count (capped),
//    and the best rule wins if it reaches BODY_MIN_SCORE. Words like "data"
//    show up in almost every posting, so one stray mention is not enough.
// 3. Otherwise the default resume (or the first one uploaded).
import type { ResumeMeta, ResumeRule, SkillSet } from './types';

export interface PageContext {
  title: string;
  text: string;
}

export interface ResumePick {
  resumeId: string;
  ruleId?: string;
  reason: string;
}

const BODY_OCCURRENCE_CAP = 5;
const BODY_MIN_SCORE = 2;

/**
 * Whole-word, case-insensitive matcher. "ML" does not match "HTML", a
 * trailing plural "s" is allowed, and spaces in a keyword also match hyphens.
 */
export function keywordRegex(keyword: string): RegExp | null {
  const kw = keyword.trim();
  if (!kw) return null;
  const body = kw
    .split(/[\s-]+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s-]+');
  const plural = /\p{L}$/u.test(kw) ? 's?' : '';
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${plural}(?![\\p{L}\\p{N}])`, 'giu');
}

export function countMatches(keyword: string, text: string): number {
  const re = keywordRegex(keyword);
  return re ? (text.match(re)?.length ?? 0) : 0;
}

export function defaultResume(resumes: ResumeMeta[]): ResumeMeta | undefined {
  return resumes.find((r) => r.isDefault) ?? resumes[0];
}

/** Pick a skill set for the page the same way resumes are picked (title first, then text). */
export function pickSkillSet(sets: SkillSet[], page: PageContext): ResumePick | null {
  const asResumes = sets.map((s, i) => ({
    id: s.id, name: s.name, tags: [], skills: s.skills, fileName: '', mimeType: '', size: 0, uploadedAt: i, isDefault: s.isDefault,
  }));
  const rules = sets.map((s) => ({ id: s.id, keywords: s.keywords, resumeId: s.id }));
  return pickResume(asResumes, rules, page);
}

export function pickResume(
  resumes: ResumeMeta[],
  rules: ResumeRule[],
  page: PageContext,
): ResumePick | null {
  if (resumes.length === 0) return null;
  const ids = new Set(resumes.map((r) => r.id));
  const usable = rules.filter((r) => ids.has(r.resumeId) && r.keywords.some((k) => k.trim()));

  let best: { rule: ResumeRule; score: number; hits: string[] } | null = null;
  for (const rule of usable) {
    const hits = rule.keywords.filter((k) => countMatches(k, page.title) > 0);
    if (hits.length > (best?.score ?? 0)) best = { rule, score: hits.length, hits };
  }
  if (best) {
    return {
      resumeId: best.rule.resumeId,
      ruleId: best.rule.id,
      reason: `title matches "${best.hits.join('", "')}"`,
    };
  }

  best = null;
  for (const rule of usable) {
    let score = 0;
    const hits: string[] = [];
    for (const k of rule.keywords) {
      const n = Math.min(countMatches(k, page.text), BODY_OCCURRENCE_CAP);
      if (n > 0) hits.push(k);
      score += n;
    }
    if (score >= BODY_MIN_SCORE && score > (best?.score ?? 0)) best = { rule, score, hits };
  }
  if (best) {
    return {
      resumeId: best.rule.resumeId,
      ruleId: best.rule.id,
      reason: `page text mentions "${best.hits.join('", "')}"`,
    };
  }

  const fallback = defaultResume(resumes)!;
  return { resumeId: fallback.id, reason: fallback.isDefault ? 'default resume' : 'first resume (no default set)' };
}
