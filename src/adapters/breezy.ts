import { fillText, formatDate } from '../lib/engine/controls';
import { isVisible, realClick, sleep, waitForElement } from '../lib/engine/dom';
import { fillPage, markField } from '../lib/engine/fill';
import type { Education, Experience, FieldResult } from '../lib/types';
import { assign } from './successfactors';
import type { Adapter } from './types';

// Breezy HR (*.breezy.hr). Work History and Education are lists of rows with no labels,
// only placeholders, and every date box says "Company". Breezy's resume reader also adds
// rows of its own. Each row gets one job or school from your profile here; the shared
// engine fills the rest of the page.
const ROWS = {
  jobs: 'li[ng-repeat*="work_history"]',
  schools: 'li[ng-repeat*="candidate.education"]',
};
const ADD = {
  jobs: 'a[ng-click*="addPosition"]',
  schools: 'a[ng-click*="addEducation"]',
};

type Mark = { el: HTMLElement; status: 'filled' | 'review' };

const rows = (kind: keyof typeof ROWS) => [...document.querySelectorAll<HTMLElement>(ROWS[kind])];
const field = (row: Element, model: string) => row.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[ng-model="${model}"]`);
const valueOf = (el: HTMLInputElement | HTMLTextAreaElement | null) => (el?.value ?? '').trim();

async function ensureRows(kind: keyof typeof ROWS, count: number): Promise<HTMLElement[]> {
  for (let guard = 0; rows(kind).length < count && guard < count + 2; guard++) {
    const add = [...document.querySelectorAll<HTMLElement>(ADD[kind])].find(isVisible);
    if (!add) break;
    const before = rows(kind).length;
    realClick(add);
    if (!(await waitForElement(() => (rows(kind).length > before ? document.body : null), 3000))) break;
    await sleep(150);
  }
  return rows(kind);
}

function setText(row: Element, model: string, value: string, label: string, results: FieldResult[], marks: Mark[]): void {
  const el = field(row, model);
  if (!el || !value || valueOf(el)) return;
  const outcome = fillText(el, value);
  const ok = outcome.ok && !outcome.review;
  results.push({ label, status: ok ? 'filled' : 'review', reason: ok ? undefined : outcome.review });
  marks.push({ el, status: ok ? 'filled' : 'review' });
}

/** Date boxes take a full date; your profile has month and year, so jobs say the 1st was used. */
function setDate(row: Element, model: string, iso: string, label: string, results: FieldResult[], marks: Mark[], isJob: boolean): void {
  const el = field(row, model) as HTMLInputElement | null;
  if (!el || !iso || valueOf(el)) return;
  const outcome = fillText(el, formatDate(iso, el));
  if (!outcome.ok) {
    results.push({ label, status: 'review', reason: outcome.review });
    marks.push({ el, status: 'review' });
  } else if (isJob && iso.split('-').length < 3) {
    results.push({ label, status: 'review', reason: 'This form asks for the exact day and your profile only has the month, so the 1st was used.' });
    marks.push({ el, status: 'review' });
  } else {
    results.push({ label, status: 'filled' });
    marks.push({ el, status: 'filled' });
  }
}

/** A row Breezy's resume reader added that matches nothing in your profile. */
function flagUnknownRow(row: HTMLElement, label: string, results: FieldResult[], marks: Mark[]): void {
  results.push({ label, status: 'review', reason: 'Not in your profile (added from your resume by the site). Check it, or delete it.' });
  const first = row.querySelector<HTMLElement>('input, textarea');
  if (first) marks.push({ el: first, status: 'review' });
}

async function fillJobs(jobs: Experience[], results: FieldResult[], marks: Mark[]): Promise<void> {
  const found = await ensureRows('jobs', jobs.length);
  const order = assign(found, jobs, (r) => valueOf(field(r, 'candidatePosition.company_name')), (j) => j.company);
  for (let i = 0; i < found.length; i++) {
    const row = rows('jobs')[i] ?? found[i];
    const job = order[i];
    const filled = valueOf(field(row, 'candidatePosition.company_name'));
    if (!job) {
      if (filled) flagUnknownRow(row, `Job ${i + 1} (${filled})`, results, marks);
      continue;
    }
    const tag = `Job ${i + 1} (${job.company})`;
    setText(row, 'candidatePosition.company_name', job.company, `${tag}: company`, results, marks);
    setText(row, 'candidatePosition.title', job.title, `${tag}: title`, results, marks);
    setText(row, 'candidatePosition.summary', job.description, `${tag}: summary`, results, marks);
    setDate(row, 'candidatePosition.date_start', job.start, `${tag}: start`, results, marks, true);
    if (!job.current) setDate(row, 'candidatePosition.date_end', job.end, `${tag}: end`, results, marks, true);
    await sleep(50);
  }
  if (found.length < jobs.length) results.push({ label: 'Work History', status: 'review', reason: `Added ${found.length} of ${jobs.length} jobs. Add the rest yourself.` });
}

async function fillSchools(schools: Education[], results: FieldResult[], marks: Mark[]): Promise<void> {
  const found = await ensureRows('schools', schools.length);
  const order = assign(found, schools, (r) => valueOf(field(r, 'candidateSchool.school_name')), (s) => s.school);
  for (let i = 0; i < found.length; i++) {
    const row = rows('schools')[i] ?? found[i];
    const ed = order[i];
    const filled = valueOf(field(row, 'candidateSchool.school_name'));
    if (!ed) {
      if (filled) flagUnknownRow(row, `School ${i + 1} (${filled})`, results, marks);
      continue;
    }
    const tag = `School ${i + 1}`;
    setText(row, 'candidateSchool.school_name', ed.school, `${tag}: school`, results, marks);
    setText(row, 'candidateSchool.field_of_study', ed.major, `${tag}: field of study`, results, marks);
    setDate(row, 'candidateSchool.date_start', ed.start, `${tag}: start`, results, marks, false);
    setDate(row, 'candidateSchool.date_end', ed.end, `${tag}: end`, results, marks, false);
    await sleep(50);
  }
  if (found.length < schools.length) results.push({ label: 'Education', status: 'review', reason: `Added ${found.length} of ${schools.length} schools. Add the rest yourself.` });
}

export const breezy: Adapter = {
  id: 'breezy',
  name: 'Breezy HR',
  detect: (url) => /\.breezy\.hr$/.test(url.hostname),
  async fill(ctx) {
    const extra: FieldResult[] = [];
    const marks: Mark[] = [];
    if (!ctx.incremental) {
      // Rows first, so the label-based pass doesn't copy one job into every row.
      if (ctx.profile.experience.length) await fillJobs(ctx.profile.experience, extra, marks);
      if (ctx.profile.education.length) await fillSchools(ctx.profile.education, extra, marks);
    }
    const report = await fillPage(ctx, {
      ats: this.name,
      incremental: ctx.incremental,
      skip: (f) => !!f.el.closest(`${ROWS.jobs}, ${ROWS.schools}`),
    });
    for (const m of marks) if (m.el.isConnected) markField(m.el, m.status, ctx.settings.highlightFields);
    report.fields.unshift(...extra);
    report.filled += extra.filter((f) => f.status === 'filled').length;
    report.needsReview += extra.filter((f) => f.status === 'review').length;
    return report;
  },
};
