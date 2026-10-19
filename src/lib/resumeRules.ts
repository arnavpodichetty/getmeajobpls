// Picks a resume for the current page from keyword rules.
//
// 1. Job title first: the rule matching the most distinct keywords in the
//    title wins (ties go to the rule listed first).
// 2. Otherwise page text: each keyword scores its occurrence count (capped),
//    and the best rule wins if it reaches BODY_MIN_SCORE. Words like "data"
//    show up in almost every posting, so one stray mention is not enough.
// 3. Otherwise the default resume (or the first one uploaded).
// Tailored copies (see tailor.ts) are never picked automatically.
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
  const own = resumes.filter((r) => !r.tailoredFrom);
  return own.find((r) => r.isDefault) ?? own[0];
}

const nameTokens = (name: string) => new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

/**
 * The skill set that goes with a resume, so the two always start out matching:
 * the set linked to it (Skill sets → Use with resume), else the one unlinked set
 * whose name matches the resume's ("ML" ↔ "AI/ML"), else null. A tailored copy
 * goes with the skill set of the resume it came from.
 */
export function skillSetForResume(sets: SkillSet[], resumes: ResumeMeta[], resumeId: string | null): string | null {
  let resume = resumes.find((r) => r.id === resumeId);
  if (resume?.tailoredFrom) resume = resumes.find((r) => r.id === resume!.tailoredFrom);
  if (!resume) return null;
  const linked = sets.find((s) => s.resumeId === resume!.id);
  if (linked) return linked.id;
  const ids = new Set(resumes.map((r) => r.id));
  const unlinked = sets.filter((s) => !s.resumeId || !ids.has(s.resumeId));
  const want = nameTokens(resume.name);
  const exact = unlinked.filter((s) => s.name.trim().toLowerCase() === resume!.name.trim().toLowerCase());
  if (exact.length === 1) return exact[0].id;
  const overlap = unlinked.filter((s) => [...nameTokens(s.name)].some((t) => want.has(t)));
  return overlap.length === 1 ? overlap[0].id : null;
}

/** Skill set for the page: the one that goes with the picked resume, else by keywords like resumes are. */
export function pickSkillSetFor(sets: SkillSet[], resumes: ResumeMeta[], resumeId: string | null, page: PageContext): string | null {
  return skillSetForResume(sets, resumes, resumeId) ?? pickSkillSet(sets, page)?.resumeId ?? null;
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
  // Tailored resumes are only used when you pick one; rules and defaults choose among your own.
  resumes = resumes.filter((r) => !r.tailoredFrom);
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
