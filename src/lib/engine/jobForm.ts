// Decides whether a form on an unrecognized site is a job application, so the
// on-page panel stays off sign-up, checkout, settings and contact forms.
import type { Field } from './scan';

/** A resume/CV upload is the clearest sign of an application. */
const RESUME = /\b(r[eé]sum[eé]|cv|curriculum vitae|cover letter)\b/i;

/** Words that show up around job applications; each distinct one counts once. */
const JOB_WORDS = /\b(apply|applying|application|applicant|candidate|careers?|jobs?|positions?|vacanc(?:y|ies)|hiring|recruit\w*|internships?|r[eé]sum[eé]|cv|cover letter|work authori[sz]ation|sponsorship|linkedin)\b/gi;

export const MIN_FORM_FIELDS = 4;

export interface PageContext {
  url: string;
  title: string;
  /** Text of the page's main headings (h1/h2). */
  headings: string;
}

export function looksLikeJobForm(fields: Field[], page: PageContext): boolean {
  if (fields.filter((f) => f.kind !== 'file').length < MIN_FORM_FIELDS) return false;
  if (fields.some((f) => f.kind === 'file' && RESUME.test(`${f.label} ${f.hints}`))) return true;

  let path = page.url;
  try {
    const u = new URL(page.url);
    path = `${u.hostname} ${u.pathname} ${u.search}`;
  } catch { /* use the raw string */ }
  const text = [path.replace(/[-_/.?=&]+/g, ' '), page.title, page.headings, ...fields.map((f) => f.label)].join(' \n ');
  const found = new Set([...text.matchAll(JOB_WORDS)].map((m) => m[1].toLowerCase().replace(/s$/, '')));
  return found.size >= 2;
}
