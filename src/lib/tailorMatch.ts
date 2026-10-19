// Finding the tailored copy already made for a job, so "Tailor resume" reuses
// it instead of asking Claude again. Delete the copy (Options → Resumes →
// Tailored resumes) to tailor that job again.
import type { ResumeMeta } from './types';

/** Trailing path steps that are the application form for the posting before them. */
const APPLY_STEP = /^(apply|application|applymanually|autofillwithresume|useMyLastApplication|start|form|submit)$/i;
/** Query parameters that identify the job; everything else (tracking, source) is ignored. */
const JOB_PARAM = /^(gh_jid|jid|job_?id|jobid|req(uisition)?_?id|posting_?id|id)$/i;

/** The same string for a posting and its application pages: host + path without apply steps + job-id params. */
export function jobKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  const parts = u.pathname.split('/').filter(Boolean);
  while (parts.length > 1 && APPLY_STEP.test(parts[parts.length - 1])) parts.pop();
  const params = [...u.searchParams].filter(([k]) => JOB_PARAM.test(k)).map(([k, v]) => `${k.toLowerCase()}=${v}`).sort();
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}/${parts.join('/').toLowerCase()}${params.length ? `?${params.join('&')}` : ''}`;
}

/** "Job Application for Data Engineering Intern at Hooli" → a short label for the resume list. */
export function jobLabel(tabTitle: string): string {
  const t = tabTitle.replace(/^(job application for|apply(ing)? (for|to)|application:?)\s+/i, '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'this job';
}

const host = (key: string) => key.split('/')[0];

/** The newest tailored copy of `baseId` made for this job (same job URL, or same job title on the same site). */
export function findTailored(resumes: ResumeMeta[], baseId: string, url: string, label: string): ResumeMeta | undefined {
  const key = jobKey(url);
  if (!key) return undefined;
  return resumes
    .filter((r) => r.tailoredFrom === baseId && r.tailoredUrl)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .find((r) => {
      const other = jobKey(r.tailoredUrl!);
      return other === key || (host(other) === host(key) && !!label && r.tailoredFor === label);
    });
}
