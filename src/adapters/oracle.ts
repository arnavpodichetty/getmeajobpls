// Oracle Recruiting (Candidate Experience, *.oraclecloud.com/hcmUI/CandidateExperience).
// Most of the form is ordinary fields the engine fills. Education and Experience
// are lists of entries: each is a tile, and its fields only exist in an inline
// form opened by "Add Education" / "Add Experience" (or a tile's Edit button)
// and closed by the form's save button. This adapter adds one entry per job and
// for your latest school, filling each form from that one entry.
import { isVisible, realClick, sleep, waitForElement } from '../lib/engine/dom';
import { monthName } from '../lib/engine/controls';
import { fillPage, type Override } from '../lib/engine/fill';
import type { Field } from '../lib/engine/scan';
import { normalize, schoolVariants } from '../lib/engine/text';
import type { Education, Experience, FillReport, Profile } from '../lib/types';
import type { Adapter, FillContext } from './types';

// Every Oracle selector. Update here when Oracle changes.
const SELECTORS = {
  app: '.apply-flow, apply-flow-block',
  block: '.apply-flow-block--tile-profile-items',
  title: '.apply-flow-block__title',
  tile: 'article.apply-flow-profile-item-tile',
  activeTile: 'article.apply-flow-profile-item-tile--active',
  invalidTile: 'article.apply-flow-profile-item-tile--invalid',
  tileEdit: '.apply-flow-profile-item-tile__edit-item-icon',
  add: 'button.apply-flow-profile-item-tile__new-tile',
  form: '.profile-item-content--form',
  save: '.profile-item-footer .save-btn',
  job: { company: 'input[name="employerName"]', title: 'input[name="jobTitle"]', city: 'input[name="employerCity"]' },
  school: { school: 'input[name="educationalEstablishmentId"]' },
  startMonth: 'input[id^="month-startDate"]',
  startYear: 'input[id^="year-startDate"]',
  endMonth: 'input[id^="month-endDate"]',
  endYear: 'input[id^="year-endDate"]',
  current: 'input[id*="currentJobFlag"]',
} as const;

type Kind = 'jobs' | 'schools';
type Entry = Experience | Education;

const kindOf = (block: Element): Kind | null => {
  const text = `${block.querySelector(SELECTORS.title)?.textContent ?? ''} ${block.querySelector(SELECTORS.add)?.textContent ?? ''}`;
  if (/experience|employment|work history/i.test(text)) return 'jobs';
  if (/education/i.test(text)) return 'schools';
  return null;
};

const nameOf = (kind: Kind, entry: Entry) => (kind === 'jobs' ? (entry as Experience).company : (entry as Education).school);

/**
 * True when a tile's (or form's) text names this job's employer or this school.
 * Oracle may show only a system's name ("University of California") for a campus,
 * so a school line that's the start of your school's name counts too.
 */
function mentions(kind: Kind, text: string, entry: Entry, schoolLine = ''): boolean {
  const shown = ` ${normalize(text)} `;
  if (kind === 'jobs') {
    const company = normalize((entry as Experience).company);
    return company.length > 1 && shown.includes(` ${company} `);
  }
  const line = normalize(schoolLine);
  return schoolVariants((entry as Education).school).some((v) => {
    const name = normalize(v);
    return (name.length > 3 && shown.includes(` ${name} `)) || (line.length > 10 && name.startsWith(line));
  });
}

/** Entries the profile should have in this block: every job, and your latest school (Oracle asks for the highest level). */
function wanted(kind: Kind, profile: Profile): Entry[] {
  return kind === 'jobs' ? profile.experience.filter((e) => e.company) : profile.education.slice(0, 1).filter((e) => e.school);
}

const tileText = (tile: Element) => tile.querySelector('[data-profile-item-tile]')?.getAttribute('aria-label') ?? tile.textContent ?? '';
/** First line of a tile's subtitle: the employer or school ("Acme\n05/2026 - Present"). */
const tileLine = (tile: Element) => (tile.querySelector('.apply-flow-profile-item-tile__summary-subtitle')?.textContent ?? '').trim().split('\n')[0];
const tileMentions = (kind: Kind, tile: Element, entry: Entry) => mentions(kind, tileText(tile), entry, tileLine(tile));

const openForm = (block: Element) => {
  const form = block.querySelector<HTMLElement>(SELECTORS.form);
  return form && isVisible(form) && form.querySelector('input, textarea') ? form : null;
};

/** Answers for one entry's form, keyed by Oracle's field names; null leaves the field alone. */
function entryOverrides(kind: Kind, entry: Entry): Override[] {
  const date = (iso: string, part: 'month' | 'year') => (iso ? (part === 'year' ? iso.slice(0, 4) : monthName(iso)) : null);
  const end = kind === 'jobs' && (entry as Experience).current ? '' : entry.end;
  const out: Override[] = [
    { selector: SELECTORS.startMonth, key: 'entryStartMonth', value: () => date(entry.start, 'month') },
    { selector: SELECTORS.startYear, key: 'entryStartYear', value: () => date(entry.start, 'year') },
    { selector: SELECTORS.endMonth, key: 'entryEndMonth', value: () => date(end, 'month') },
    { selector: SELECTORS.endYear, key: 'entryEndYear', value: () => date(end, 'year') },
  ];
  if (kind === 'jobs') {
    const job = entry as Experience;
    out.push(
      { selector: SELECTORS.job.company, key: 'entryCompany', value: () => job.company || null },
      { selector: SELECTORS.job.title, key: 'entryTitle', value: () => job.title || null },
      { selector: SELECTORS.job.city, key: 'entryCity', value: () => job.location.split(',')[0].trim() || null },
      { selector: SELECTORS.current, key: 'entryCurrent', value: () => (job.current ? 'Yes' : 'No') },
    );
  }
  return out;
}

/**
 * Fields in an entry form that must not fall back to your personal details:
 * the employer's country and city aren't your address, and "Internal" or
 * "Achievements" have no profile answer. Dates without a value stay empty.
 */
function skipInForm(kind: Kind, overrides: Override[]) {
  return (field: Field) => {
    const el = field.el;
    const override = overrides.find((o) => el.matches(o.selector));
    if (override) return !override.value({ profile: {} as Profile, skills: [] });
    return kind === 'jobs' && (el.matches('input[name="countryCode"], textarea[name="achievements"]') || /^internal$/i.test(field.label));
  };
}

async function fillForm(ctx: FillContext, kind: Kind, entry: Entry, form: HTMLElement, report: FillReport): Promise<void> {
  const profile: Profile = kind === 'jobs'
    ? { ...ctx.profile, experience: [entry as Experience] }
    : { ...ctx.profile, education: [entry as Education] };
  const overrides = entryOverrides(kind, entry);
  const sub = await fillPage({ ...ctx, resume: null, profile }, {
    ats: 'Oracle Recruiting',
    root: form,
    incremental: true,
    overrides,
    skip: skipInForm(kind, overrides),
  });
  const name = nameOf(kind, entry);
  report.fields.push(...sub.fields.map((f) => ({ ...f, label: `${name}: ${f.label}` })));
}

/** Click the form's save button; true once the form has closed. */
async function save(block: Element, name: string, report: FillReport): Promise<boolean> {
  const button = block.querySelector<HTMLElement>(SELECTORS.save);
  if (!button) return false;
  realClick(button);
  const closed = await waitForElement(() => (openForm(block) ? null : document.body), 5000);
  if (!closed) report.notes.push(`Oracle didn't save the entry for ${name}; finish its highlighted fields and save it.`);
  return !!closed;
}

/** The entry an open form is for: the one it already names, else the first one not on the page yet. */
function entryForOpenForm(kind: Kind, block: Element, form: HTMLElement, entries: Entry[]): Entry | null {
  const key = form.querySelector<HTMLInputElement>(kind === 'jobs' ? SELECTORS.job.company : SELECTORS.school.school)?.value ?? '';
  if (key.trim()) return entries.find((e) => mentions(kind, key, e, key)) ?? null;
  const others = [...block.querySelectorAll(SELECTORS.tile)].filter((t) => !t.matches(SELECTORS.activeTile));
  return entries.find((e) => !others.some((tile) => tileMentions(kind, tile, e))) ?? null;
}

async function fillEntries(ctx: FillContext, report: FillReport): Promise<void> {
  for (const block of document.querySelectorAll(SELECTORS.block)) {
    if (!isVisible(block)) continue;
    const kind = kindOf(block);
    if (!kind) continue;
    const entries = wanted(kind, ctx.profile);
    if (!entries.length) continue;

    // A form that's already open (one you opened, or an entry Oracle wants fixed).
    const open = openForm(block);
    if (open) {
      const entry = entryForOpenForm(kind, block, open, entries);
      if (!entry) {
        report.notes.push(`An open ${kind === 'jobs' ? 'experience' : 'education'} form doesn't match your profile; it was left alone.`);
        continue;
      }
      await fillForm(ctx, kind, entry, open, report);
      // Watching for new fields only fills what you opened; saving stays your call.
      if (ctx.incremental || !(await save(block, nameOf(kind, entry), report))) continue;
    }
    if (ctx.incremental) continue;

    // Entries on the page that Oracle marked incomplete.
    for (const tile of block.querySelectorAll<HTMLElement>(SELECTORS.invalidTile)) {
      const entry = entries.find((e) => tileMentions(kind, tile, e));
      const edit = tile.querySelector<HTMLElement>(SELECTORS.tileEdit);
      if (!entry || !edit) continue;
      realClick(edit);
      const form = await waitForElement(() => openForm(block));
      if (!form) continue;
      await sleep(300);
      await fillForm(ctx, kind, entry, form, report);
      if (!(await save(block, nameOf(kind, entry), report))) break;
    }
    if (openForm(block)) continue;

    // Entries that aren't on the page yet.
    for (const entry of entries) {
      if ([...block.querySelectorAll(SELECTORS.tile)].some((t) => tileMentions(kind, t, entry))) continue;
      const add = block.querySelector<HTMLButtonElement>(SELECTORS.add);
      if (!add || add.disabled) {
        report.notes.push(`Couldn't add ${nameOf(kind, entry)}: Oracle's Add button is unavailable.`);
        break;
      }
      realClick(add);
      const form = await waitForElement(() => openForm(block));
      if (!form) {
        report.notes.push(`Clicked Add but no form opened for ${nameOf(kind, entry)}.`);
        break;
      }
      await sleep(300);
      await fillForm(ctx, kind, entry, form, report);
      if (!(await save(block, nameOf(kind, entry), report))) break;
    }
  }
}

export const oracle: Adapter = {
  id: 'oracle',
  name: 'Oracle Recruiting',
  detect(url, doc) {
    return (url.hostname.endsWith('.oraclecloud.com') && /\/CandidateExperience\//i.test(url.pathname)) || !!doc.querySelector('apply-flow-block');
  },
  async fill(ctx) {
    const report = await fillPage(ctx, {
      ats: this.name,
      incremental: ctx.incremental,
      // Entry forms are filled below, one profile entry each.
      skip: (field) => !!field.el.closest(SELECTORS.form),
    });
    await fillEntries(ctx, report);
    report.filled = report.fields.filter((f) => f.status === 'filled').length;
    report.needsReview = report.fields.filter((f) => f.status === 'review').length;
    return report;
  },
};
