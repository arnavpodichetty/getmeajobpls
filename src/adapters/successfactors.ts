import { blur, byId, fire, isVisible, queryAllDeep, queryDeep, realClick, sleep, typeInto, waitForElement, waitForStable } from '../lib/engine/dom';
import { fillCombobox, fillText, formatDate } from '../lib/engine/controls';
import { LANGUAGE_LEVEL_TIERS } from '../lib/engine/answers';
import { fillPage, markField } from '../lib/engine/fill';
import { cleanLabel, degreeTiers, majorPreferenceTiers, normalize, schoolVariants, US_STATES } from '../lib/engine/text';
import type { Education, Experience, FieldResult, FillReport, Language } from '../lib/types';
import type { Adapter, FillContext } from './types';

// SAP SuccessFactors (career4.successfactors.com, career5.successfactors.eu…)
// splits the application into sections. Some start collapsed, and the
// repeating ones (Previous Employment, Formal Education, Language Skills)
// have no fields at all until you click "Add" for each row. The markup is the
// same for every company on SuccessFactors, only the section names differ.
const SELECTORS = {
  section: '.rcmFormSection',
  // The section header button. Header nav toggles (Menu, Who we are) also use
  // aria-expanded, so only SuccessFactors' own section bars are clicked.
  collapsed: 'button.rcmFormSectionTopBar[aria-expanded="false"]',
  title: '.rcmFormSectionTopBar > span:not(.hiddenAriaContent):not([aria-hidden])',
  addRow: '.addRowButton, [role="button"][title="Add new row"]',
  row: '.rcmSectionComponent',
  label: 'label.rcmFormFieldLabel',
  field: '.RCMFormField',
  datePicker: '[ui5-date-picker], [data-testid="datePicker"]',
} as const;

const SECTIONS = {
  jobs: /employment|work (?:experience|history)|previous (?:jobs?|positions?|employers?)|^experience$/i,
  schools: /education|schools?|academic/i,
  languages: /languages?/i,
  // "Additional Training/Certifications" mentions education-like words but isn't schooling.
  notSchools: /training|certific|licen[cs]e|course/i,
};

/** Open every collapsed section; returns how many were opened. */
export async function expandSections(): Promise<number> {
  let opened = 0;
  for (let round = 0; round < 3; round++) {
    const toggles = queryAllDeep<HTMLElement>(SELECTORS.collapsed).filter(isVisible);
    if (!toggles.length) break;
    for (const toggle of toggles) {
      realClick(toggle);
      opened++;
    }
    await waitForStable(document.body, 400, 4000);
  }
  return opened;
}

const sectionTitle = (section: Element) => (section.querySelector(SELECTORS.title)?.textContent ?? '').trim();

function findSection(re: RegExp, not?: RegExp): HTMLElement | null {
  return queryAllDeep<HTMLElement>(SELECTORS.section).find((s) => {
    const title = sectionTitle(s);
    return re.test(title) && !not?.test(title);
  }) ?? null;
}

const rows = (section: Element) => [...section.querySelectorAll<HTMLElement>(SELECTORS.row)].filter(isVisible);

/** Click the section's Add button until it has `count` rows. */
export async function ensureRows(section: HTMLElement, count: number): Promise<HTMLElement[]> {
  for (let guard = 0; rows(section).length < count && guard < count + 2; guard++) {
    const add = [...section.querySelectorAll<HTMLElement>(SELECTORS.addRow)].find(isVisible);
    if (!add) break;
    const before = rows(section).length;
    realClick(add);
    // If Add didn't produce a row, clicking again won't either; stop waiting.
    if (!(await waitForElement(() => (rows(section).length > before ? section : null), 3000))) break;
    await sleep(250);
  }
  return rows(section);
}

/** The control for the row field whose label matches. */
function rowField(row: Element, re: RegExp): HTMLElement | null {
  for (const label of row.querySelectorAll<HTMLLabelElement>(SELECTORS.label)) {
    const text = cleanLabel(label.textContent).replace(/:$/, '');
    if (!re.test(text)) continue;
    const target = label.htmlFor ? byId(label, label.htmlFor) : null;
    const wrap = label.closest(SELECTORS.field) ?? label.parentElement;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return target;
    return (target ?? wrap)?.querySelector<HTMLElement>(`${SELECTORS.datePicker}, textarea, input:not([type=hidden]), select`) ?? target;
  }
  return null;
}

const valueOf = (el: HTMLElement | null) => ((el as HTMLInputElement | null)?.value ?? '').trim();

/** Row fields the adapter filled, outlined once the main pass has cleared old outlines. */
type Mark = { el: HTMLElement; status: 'filled' | 'review' };
let marks: Mark[] = [];

function record(results: FieldResult[], label: string, ok: boolean, reason?: string, el?: HTMLElement | null) {
  results.push({ label, status: ok ? 'filled' : 'review', reason: ok ? undefined : reason });
  if (el) marks.push({ el, status: ok ? 'filled' : 'review' });
}

async function setText(row: Element, re: RegExp, value: string, results: FieldResult[], label: string): Promise<void> {
  const el = rowField(row, re) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el || !value || !('value' in el) || el.matches(SELECTORS.datePicker) || el.getAttribute('role') === 'combobox' || valueOf(el)) return;
  const outcome = fillText(el, value);
  record(results, label, outcome.ok && !outcome.review, outcome.review, el);
  await sleep(80);
}

async function setPicklist(row: Element, re: RegExp, value: string, tiers: string[][], results: FieldResult[], label: string): Promise<boolean> {
  const el = rowField(row, re);
  if (!el || !value || valueOf(el)) return false;
  const outcome = el.getAttribute('role') === 'combobox' ? await fillCombobox(el, value, { tiers }) : fillText(el as HTMLInputElement, value);
  record(results, label, outcome.ok && !outcome.review, outcome.review ?? `Pick "${value}" yourself.`, el);
  return outcome.ok;
}

/** SuccessFactors dates are UI5 date pickers: type into the inner box, then commit. */
export async function setDate(row: Element, re: RegExp, iso: string, results: FieldResult[], label: string, isJob = false): Promise<void> {
  const el = rowField(row, re);
  if (!el || !iso) return;
  const host = (el.matches(SELECTORS.datePicker) ? el : el.querySelector<HTMLElement>(SELECTORS.datePicker)) as (HTMLElement & { value?: string }) | null;
  const inner = (host ? queryDeep<HTMLInputElement>('input', host.shadowRoot ?? host) ?? queryDeep<HTMLInputElement>('input', host) : el) as HTMLInputElement | null;
  const current = () => (host?.value ?? host?.getAttribute('value') ?? '') || inner?.value || '';
  if (current()) return;
  const pattern = host?.getAttribute('format-pattern') ?? '';
  const value = formatDate(iso, inner ?? host ?? el, pattern);
  if (inner) {
    inner.focus();
    typeInto(inner, value);
    fire(inner, 'change');
    // No Enter: the whole application is one <form>, and Enter submits it
    // (the browser then asks "Leave site?"). Leaving the box commits the date.
    blur(inner);
  }
  if (host && current() !== value) {
    host.value = value;
    host.setAttribute('value', value);
    host.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value, valid: true } }));
  }
  await sleep(80);
  // A date picker that wants the day when your profile only has the month: the 1st is a guess.
  if (isJob && current() === value && iso.split('-').length < 3 && /d/i.test(pattern)) {
    results.push({ label, status: 'review', reason: 'This form asks for the exact day and your profile only has the month, so the 1st was used. Add the day under Work experience.' });
    if (inner ?? host) marks.push({ el: (inner ?? host)!, status: 'review' });
    return;
  }
  record(results, label, current() === value, `Enter ${value} yourself.`, inner ?? host);
}

/** Pair rows with entries: a row that already names one keeps it, empty rows take the rest in order. */
function assign<T>(found: HTMLElement[], items: T[], key: (row: HTMLElement) => string, name: (item: T) => string): (T | undefined)[] {
  const remaining = [...items];
  const order = found.map((row) => {
    const have = normalize(key(row));
    if (!have) return undefined;
    const idx = remaining.findIndex((item) => {
      const n = normalize(name(item));
      return n && (n.includes(have) || have.includes(n));
    });
    return idx >= 0 ? remaining.splice(idx, 1)[0] : null;
  });
  // null = a row filled with something not in the profile; leave it alone.
  return order.map((item) => (item === undefined ? remaining.shift() : item ?? undefined));
}

const RE = {
  company: /^(?:company|employer|organi[sz]ation)(?: name)?$/i,
  jobTitle: /^(?:job |position )?title$|^position$|^role$/i,
  location: /^(?:location|city|job location)$/i,
  // "Start Date", "Date Begin", "From Date"…
  start: /^(?:(?:start|begin|from)(?: date)?|date (?:begin|from|start))$/i,
  end: /^(?:(?:end|to|completion)(?: date)?|date (?:end|to))$/i,
  description: /^(?:impact|description|responsibilities|duties|achievements)/i,
  school: /^(?:school|institution|university|college|school name)$/i,
  major: /^(?:major|field of study|concentration|discipline)$/i,
  degree: /^(?:degree|degree type|qualification|degree (?:achieved|earned|obtained|received|level))$/i,
  // "Education" as a level picklist (Bachelor's, Master's…); Major and Degree lists depend on it.
  educationLevel: /^(?:education|education level|level of education|highest level of education)$/i,
  country: /^(?:company |employer |school )?country$/i,
  gradYear: /^(?:graduation year|year of graduation|year graduated)$/i,
  employerType: /^employer type$/i,
  positionType: /^(?:position|employment|job) type$/i,
  gpa: /^gpa$|grade point/i,
  language: /^languages?(?: skills?)?$/i,
  level: /^(?:level|proficiency|fluency)/i,
};

/** Rows the adapter filled, by report tag; the main pass leaves them alone. */
let handledRows = new Map<HTMLElement, string>();

/** "Current Employer" / "Previous Employer"; anything else is left to you. */
function employerTypeTiers(current: boolean): string[][] {
  return current ? [['Current Employer', 'Current']] : [['Previous Employer', 'Former Employer', 'Past Employer', 'Previous', 'Former']];
}

function positionTypeTiers(type: string): string[] | null {
  const n = normalize(type);
  if (/intern/.test(n)) return ['Internship', 'Intern'];
  if (/part time/.test(n)) return ['Part-time', 'Part Time'];
  if (/full time/.test(n)) return ['Full-time', 'Full Time'];
  if (/contract/.test(n)) return ['Contract', 'Contractor'];
  if (/temp/.test(n)) return ['Temporary', 'Temp'];
  return null;
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  'united states': ['United States', 'United States of America', 'USA', 'US'],
  'united kingdom': ['United Kingdom', 'UK', 'Great Britain'],
};

function countryNames(country: string): string[] {
  const n = normalize(country);
  const key = /^(?:us|usa|u s|u s a|united states(?: of america)?)$/.test(n) ? 'united states' : /^(?:uk|u k|great britain|england|scotland|wales)$/.test(n) ? 'united kingdom' : n;
  return COUNTRY_ALIASES[key] ?? [country.trim()];
}

/** The country a job's location names: "Seattle, WA" is the US; "London" alone is unclear. */
export function countryFromLocation(location: string): string[] | null {
  const parts = location.split(',').map((p) => normalize(p)).filter(Boolean);
  if (!parts.length || parts.some((p) => /^remote$/.test(p))) return null;
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && (US_STATES[last] || Object.values(US_STATES).includes(last))) return countryNames('United States');
  if (/^(?:us|usa|u s|u s a|united states(?: of america)?)$/.test(last)) return countryNames('United States');
  return parts.length >= 2 && !/\d/.test(last) ? countryNames(last.replace(/\b\w/g, (c) => c.toUpperCase())) : null;
}

async function fillJobs(section: HTMLElement, jobs: Experience[], results: FieldResult[]): Promise<void> {
  const found = await ensureRows(section, jobs.length);
  const order = assign(found, jobs, (r) => valueOf(rowField(r, RE.company)), (j) => j.company);
  for (let i = 0; i < order.length; i++) {
    const job = order[i];
    if (!job) continue;
    const row = rows(section)[i] ?? found[i];
    const tag = `Job ${i + 1} (${job.company})`;
    await setText(row, RE.company, job.company, results, `${tag}: company`);
    await setText(row, RE.location, job.location, results, `${tag}: location`);
    await setText(row, RE.jobTitle, job.title, results, `${tag}: title`);
    await setDate(row, RE.start, job.start, results, `${tag}: start`, true);
    if (!job.current) await setDate(row, RE.end, job.end, results, `${tag}: end`, true);
    await setText(row, RE.description, job.description, results, `${tag}: description`);
    await setPicklist(row, RE.employerType, job.current ? 'Current Employer' : 'Previous Employer', employerTypeTiers(job.current), results, `${tag}: employer type`);
    const country = countryFromLocation(job.location);
    if (country) await setPicklist(row, RE.country, country[0], [country], results, `${tag}: country`);
    const type = positionTypeTiers(job.type);
    if (type) await setPicklist(row, RE.positionType, type[0], [type], results, `${tag}: position type`);
    handledRows.set(row, tag);
  }
  if (found.length < jobs.length) results.push({ label: sectionTitle(section), status: 'review', reason: `Added ${found.length} of ${jobs.length} jobs. Add the rest yourself.` });
}

async function fillSchools(section: HTMLElement, schools: Education[], results: FieldResult[], ctx: FillContext): Promise<void> {
  const found = await ensureRows(section, schools.length);
  const order = assign(found, schools, (r) => valueOf(rowField(r, RE.school)), (s) => s.school);
  for (let i = 0; i < order.length; i++) {
    const ed = order[i];
    if (!ed) continue;
    const row = rows(section)[i] ?? found[i];
    const tag = `School ${i + 1}`;
    handledRows.set(row, tag);
    // Cascading lists: the level comes first (Major and Degree list nothing until it's
    // set), and the school list waits for the country.
    if (await setPicklist(row, RE.educationLevel, ed.degree, degreeTiers(ed.degree), results, `${tag}: education level`)) await waitForStable(document.body, 300, 3000);
    const homeCountry = ctx.profile.personal.country;
    if (homeCountry && (await setPicklist(row, RE.country, homeCountry, [countryNames(homeCountry)], results, `${tag}: country`))) await waitForStable(document.body, 300, 3000);
    const school = rowField(row, RE.school);
    if (school?.getAttribute('role') === 'combobox') await setPicklist(row, RE.school, ed.school, [schoolVariants(ed.school)], results, `${tag}: school`);
    else await setText(row, RE.school, ed.school, results, `${tag}: school`);
    const major = rowField(row, RE.major);
    if (major?.getAttribute('role') === 'combobox') await setPicklist(row, RE.major, ed.major, majorPreferenceTiers(ed.major, ed.majorFallbacks), results, `${tag}: major`);
    else await setText(row, RE.major, ed.major, results, `${tag}: major`);
    await setPicklist(row, RE.degree, ed.degree, degreeTiers(ed.degree), results, `${tag}: degree`);
    await setText(row, RE.gpa, ed.gpa, results, `${tag}: GPA`);
    await setText(row, RE.gradYear, ed.end.slice(0, 4), results, `${tag}: graduation year`);
    await setDate(row, RE.start, ed.start, results, `${tag}: start`);
    await setDate(row, RE.end, ed.end, results, `${tag}: end`);
  }
  if (found.length < schools.length) results.push({ label: sectionTitle(section), status: 'review', reason: `Added ${found.length} of ${schools.length} schools. Add the rest yourself.` });
}

/** Native, Fluent, Expert, then Advanced, as for other language questions. */
function levelTiers(lang: Language): string[][] {
  if (!(lang.fluent || /native|bilingual|fluent|expert/i.test(lang.proficiency))) return [[lang.proficiency]];
  return LANGUAGE_LEVEL_TIERS;
}

async function fillLanguages(section: HTMLElement, languages: Language[], results: FieldResult[]): Promise<void> {
  const found = await ensureRows(section, languages.length);
  const order = assign(found, languages, (r) => valueOf(rowField(r, RE.language)), (l) => l.language);
  for (let i = 0; i < order.length; i++) {
    const lang = order[i];
    if (!lang) continue;
    const row = rows(section)[i] ?? found[i];
    await setPicklist(row, RE.language, lang.language, [[lang.language]], results, `Language ${i + 1}`);
    await setPicklist(row, RE.level, lang.proficiency || 'Fluent', levelTiers(lang), results, `Language ${i + 1}: level`);
    handledRows.set(row, `Language ${i + 1}`);
  }
}

/** Required row fields still empty after the row fill (a current job's End Date, say). */
function flagEmptyRequired(results: FieldResult[]): void {
  const flagged = new Set(marks.map((m) => m.el));
  for (const [row, tag] of handledRows) {
    for (const label of row.querySelectorAll<HTMLLabelElement>(SELECTORS.label)) {
      if (!label.querySelector('.requiredField')) continue;
      const text = cleanLabel(label.textContent).replace(/:$/, '');
      const el = rowField(row, new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
      if (!el) continue;
      const host = el.matches(SELECTORS.datePicker) ? (el as HTMLElement & { value?: string }) : null;
      const inner = host ? queryDeep<HTMLInputElement>('input', host.shadowRoot ?? host) : null;
      const target = inner ?? el;
      if (flagged.has(target) || flagged.has(el)) continue;
      if ((host?.value ?? '') || valueOf(inner) || (!host && valueOf(el))) continue;
      results.push({ label: `${tag}: ${text}`, status: 'review', reason: 'Required, and your profile has no answer.' });
      marks.push({ el: target, status: 'review' });
    }
  }
}

export const successfactors: Adapter & { fillRows(ctx: FillContext): Promise<FillReport> } = {
  id: 'successfactors',
  name: 'SAP SuccessFactors',
  detect: (url) => /(successfactors\.(com|eu)|sapsf\.(com|eu)|jobs\.sap\.com)$/.test(url.hostname),
  async fill(ctx) {
    // Nothing the fill does should submit the application; a stray submit
    // navigates away mid-fill and the browser asks "Leave site?".
    const stopSubmit = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('submit', stopSubmit, true);
    try {
      return await this.fillRows(ctx);
    } finally {
      window.removeEventListener('submit', stopSubmit, true);
    }
  },
  async fillRows(ctx: FillContext) {
    const extra: FieldResult[] = [];
    let opened = 0;
    if (!ctx.incremental) {
      marks = [];
      handledRows = new Map();
    }
    if (!ctx.incremental) {
      opened = await expandSections();
      // Rows first, so the label-based pass below doesn't copy one job into every row.
      const { experience, education, languages } = ctx.profile;
      const jobs = findSection(SECTIONS.jobs, SECTIONS.notSchools);
      if (jobs && experience.length) await fillJobs(jobs, experience, extra);
      const schools = findSection(SECTIONS.schools, SECTIONS.notSchools);
      if (schools && education.length) await fillSchools(schools, education, extra, ctx);
      const langs = findSection(SECTIONS.languages);
      if (langs && languages.length) await fillLanguages(langs, languages.filter((l) => l.language), extra);
    }
    if (!ctx.incremental) flagEmptyRequired(extra);
    const rowsDone = [...handledRows.keys()];
    const report = await fillPage(ctx, { ats: this.name, incremental: ctx.incremental, skip: (f) => rowsDone.some((r) => r.contains(f.el)) });
    for (const m of marks) if (m.el.isConnected) markField(m.el, m.status, ctx.settings.highlightFields);
    report.fields.unshift(...extra);
    report.filled += extra.filter((f) => f.status === 'filled').length;
    report.needsReview += extra.filter((f) => f.status === 'review').length;
    if (opened) report.notes.push(`Opened ${opened} collapsed section${opened === 1 ? '' : 's'} before filling.`);
    return report;
  },
};
