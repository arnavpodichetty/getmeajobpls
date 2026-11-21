// Phenom apply flows (phenompeople.com, and companies' own career sites on Phenom, like
// join.<company>careers.com/.../hvhapply). Fields are "phff-field-*" boxes. After a resume
// upload Phenom's parser pre-fills Work Experience and Education rows, often wrongly
// (two jobs merged into one row, a cut-off title, "University of California" for a campus),
// so each row is rewritten from your profile, in order. Dates are PrimeVue month/year pickers.
import { fillPrimeCalendar, fillText, type Outcome } from '../lib/engine/controls';
import { isVisible, realClick, sleep, waitForElement } from '../lib/engine/dom';
import { fillPage, markField } from '../lib/engine/fill';
import { normalize } from '../lib/engine/text';
import type { Education, Experience, FieldResult, FillReport } from '../lib/types';
import type { Adapter, FillContext } from './types';

const SELECTORS = {
  form: '.phff-form-field-group, [id^="phff-field-"]',
  jobs: '#phff-field-experienceData',
  schools: '#phff-field-educationData',
  row: 'ol > li',
  add: '.phff-add-button-container button, button.add-button',
  skills: '[identifier="skills"] textarea, textarea[input-id^="phff-field-skills"]',
  job: {
    title: '[identifier="title"] input',
    company: '[identifier="companyName"] input',
    location: '[identifier="location"] input',
    start: '[identifier="startDate"] input',
    end: '[identifier="endDate"] input',
    current: '[identifier="currentlyWorkHere"] input[type=checkbox]',
    description: '[identifier="description"] textarea',
  },
  school: {
    school: '[identifier="schoolName"] input',
    degree: '[identifier="degree"] input',
    major: '[identifier="fieldOfStudy"] input',
    gpa: '[identifier*="gpa" i] input, [identifier*="grade" i] input',
    start: '[identifier="startDate"] input',
    end: '[identifier="endDate"] input',
  },
} as const;

type Kind = 'jobs' | 'schools';

// Sections already rewritten, so watching for new fields doesn't redo them.
let done = new WeakSet<Element>();

const rowsOf = (section: Element) => [...section.querySelectorAll<HTMLElement>(SELECTORS.row)].filter(isVisible);

/** The section's own Add button (not one inside a row). */
const addButton = (section: Element) =>
  [...section.querySelectorAll<HTMLButtonElement>(SELECTORS.add)].find((b) => isVisible(b) && !b.disabled && !b.closest(SELECTORS.row)) ?? null;

/** Click Add until there are `count` rows, or the form won't take more. */
async function ensureRows(section: Element, count: number): Promise<HTMLElement[]> {
  for (let guard = 0; rowsOf(section).length < count && guard < count + 2; guard++) {
    const add = addButton(section);
    if (!add) break;
    const before = rowsOf(section).length;
    realClick(add);
    if (!(await waitForElement(() => (rowsOf(section).length > before ? section : null), 3000))) break;
  }
  return rowsOf(section);
}

interface Ctx {
  results: FieldResult[];
  highlight: boolean;
}

function record(ctx: Ctx, el: HTMLElement, label: string, outcome: Outcome, isGroup = false): void {
  const ok = outcome.ok && !outcome.review;
  ctx.results.push({ label, status: ok ? 'filled' : 'review', reason: ok ? undefined : outcome.review });
  markField(el, ok ? 'filled' : 'review', ctx.highlight, isGroup);
}

/** Put your value in the box, replacing whatever the parser put there. Empty values leave it alone. */
function setText(ctx: Ctx, row: Element, selector: string, value: string, label: string): void {
  const el = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el || !value.trim()) return;
  const same = normalize(el.value) === normalize(value);
  record(ctx, el, label, same ? { ok: true } : fillText(el, value));
}

async function setDate(ctx: Ctx, row: Element, selector: string, iso: string, label: string): Promise<void> {
  const el = row.querySelector<HTMLInputElement>(selector);
  if (!el || el.disabled) return;
  if (!iso) {
    // Nothing in your profile; a date the parser guessed stays only if you check it.
    if (el.value.trim()) record(ctx, el, label, { ok: false, review: 'Your profile has no date here; check this one.' });
    return;
  }
  record(ctx, el, label, await fillPrimeCalendar(el, iso.slice(0, 7)));
}

async function fillJob(ctx: Ctx, row: HTMLElement, job: Experience): Promise<void> {
  const tag = job.company || job.title;
  setText(ctx, row, SELECTORS.job.title, job.title, `${tag}: job title`);
  setText(ctx, row, SELECTORS.job.company, job.company, `${tag}: company`);
  setText(ctx, row, SELECTORS.job.location, job.location, `${tag}: location`);
  const current = row.querySelector<HTMLInputElement>(SELECTORS.job.current);
  if (current) {
    // PrimeVue keeps the state on its wrapper (data-p-highlight); the input's own flag can lag.
    const box = current.closest<HTMLElement>('[data-pc-name="checkbox"]');
    const checked = () => (box?.hasAttribute('data-p-highlight') ? box.getAttribute('data-p-highlight') === 'true' : current.checked);
    if (checked() !== job.current) {
      realClick(current);
      await sleep(250); // the To date turns on or off
      const ok = checked() === job.current;
      record(ctx, current, `${tag}: I currently work here`, ok ? { ok: true } : { ok: false, review: `${job.current ? 'Tick' : 'Untick'} "I currently work here".` });
    }
  }
  await setDate(ctx, row, SELECTORS.job.start, job.start, `${tag}: from`);
  if (!job.current) await setDate(ctx, row, SELECTORS.job.end, job.end, `${tag}: to`);
  setText(ctx, row, SELECTORS.job.description, job.description, `${tag}: role description`);
}

async function fillSchool(ctx: Ctx, row: HTMLElement, ed: Education): Promise<void> {
  const tag = ed.school;
  setText(ctx, row, SELECTORS.school.school, ed.school, `${tag}: school`);
  setText(ctx, row, SELECTORS.school.degree, ed.degree, `${tag}: degree`);
  setText(ctx, row, SELECTORS.school.major, ed.major, `${tag}: field of study`);
  setText(ctx, row, SELECTORS.school.gpa, ed.gpa, `${tag}: GPA`);
  await setDate(ctx, row, SELECTORS.school.start, ed.start, `${tag}: start year`);
  await setDate(ctx, row, SELECTORS.school.end, ed.end, `${tag}: end year`);
}

async function fillSection<T>(kind: Kind, entries: T[], fillRow: (ctx: Ctx, row: HTMLElement, entry: T) => Promise<void>, ctx: Ctx, report: FillReport): Promise<void> {
  const section = document.querySelector<HTMLElement>(SELECTORS[kind]);
  if (!section || !isVisible(section) || done.has(section) || !entries.length) return;
  done.add(section);
  const rows = await ensureRows(section, entries.length);
  for (let i = 0; i < Math.min(rows.length, entries.length); i++) {
    await fillRow(ctx, rowsOf(section)[i] ?? rows[i], entries[i]); // re-query: rows re-render as they change
  }
  const what = kind === 'jobs' ? 'job' : 'school';
  if (rows.length < entries.length) {
    report.notes.push(`This form took ${rows.length} ${what} entries; add the other ${entries.length - rows.length} yourself if you want them listed.`);
  }
  for (const extra of rowsOf(section).slice(entries.length)) {
    markField(extra, 'review', ctx.highlight, true);
    ctx.results.push({ label: `Extra ${what} entry`, status: 'review', reason: `Phenom added a ${what} that isn't in your profile; remove it if it's wrong.` });
  }
}

function fillSkills(ctx: Ctx, skills: string[]): void {
  const el = document.querySelector<HTMLTextAreaElement>(SELECTORS.skills);
  if (!el || !isVisible(el) || done.has(el) || !skills.length) return;
  done.add(el);
  const value = skills.join(', ');
  record(ctx, el, 'Skills', normalize(el.value) === normalize(value) ? { ok: true } : fillText(el, value));
}

const inRows = (el: Element) => !!el.closest(`${SELECTORS.jobs}, ${SELECTORS.schools}`) || el.matches(SELECTORS.skills);

export const phenom: Adapter = {
  id: 'phenom',
  name: 'Phenom',
  detect(url, doc) {
    return /(^|\.)phenompeople\.com$/.test(url.hostname) || !!doc.querySelector('[id^="phff-field-"], .phff-form-field-group');
  },
  async fill(ctx: FillContext) {
    if (!ctx.incremental) done = new WeakSet();
    const report = await fillPage(ctx, { ats: this.name, incremental: ctx.incremental, skip: (field) => inRows(field.el) });
    const rows: Ctx = { results: [], highlight: ctx.settings.highlightFields };
    const { experience, education } = ctx.profile;
    await fillSection('jobs', experience.filter((e) => e.company || e.title), fillJob, rows, report);
    await fillSection('schools', education.filter((e) => e.school), fillSchool, rows, report);
    fillSkills(rows, ctx.skills ?? ctx.profile.skills);
    report.fields.push(...rows.results);
    report.filled = report.fields.filter((f) => f.status === 'filled').length;
    report.needsReview = report.fields.filter((f) => f.status === 'review').length;
    return report;
  },
};
