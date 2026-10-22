// Workday (*.myworkdayjobs.com): a multi-step wizard. Each step is filled when
// it loads; My Experience gets one panel per job and per school. Built from
// Workday's data-automation-id / id conventions (old "legalNameSection_firstName"
// and new "name--legalName--firstName" styles), with Autofill-Jobs (MIT) as a
// reference. Applications sit behind a Workday account, so this hasn't been run
// against a live tenant here — use "Capture this form" on any step it misses.
import { fillCheckbox, fillCombobox, fillMultiCombobox, fillText } from '../lib/engine/controls';
import { todayISO } from '../lib/clock';
import { blur, isVisible, queryAllDeep, realClick, sleep, typeInto, waitForElement, waitForStable } from '../lib/engine/dom';
import { resolveAnswer } from '../lib/engine/answers';
import { fillPage, type Override } from '../lib/engine/fill';
import { degreeTiers, majorPreferenceTiers, normalize, schoolVariants } from '../lib/engine/text';
import type { Education, Experience, FieldResult, FillReport } from '../lib/types';
import type { Adapter, FillContext } from './types';

// Every Workday selector and id fragment. Update here when Workday changes.
const SELECTORS = {
  activeStep: '[data-automation-id="progressBarActiveStep"]',
  resume: 'input[data-automation-id="file-upload-input-ref"], input[type=file]',
  next: 'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="pageFooterNextButton"]',
  addButton: 'button[data-automation-id="add-button"], button[data-automation-id="Add"], button[data-automation-id*="addButton" i]',
  skills: '[data-automation-id="formField-skills"]',
  source: '[data-automation-id*="formField-source" i] input, input[id^="source--" i]',
  linkedin: '[id*="linkedin" i], [data-automation-id*="linkedin" i]',
  multiselect: '[data-automation-id="multiselectInputContainer"]',
} as const;

/**
 * One panel per job / school / website ("Work Experience 1", "Education 1",
 * "Websites 1"). Companies rename sections ("Professional Experience",
 * "Portfolio"), so a panel is recognized by the fields in it, not its heading.
 * Fields are looked up inside their panel (verified against live Workday captures).
 */
const PANEL = {
  any: '[role="group"][aria-labelledby$="-panel"]',
  job: {
    title: 'input[name="jobTitle"], [data-automation-id="formField-jobTitle"] input',
    company: 'input[name="companyName"], [data-automation-id="formField-companyName"] input',
    location: 'input[name="location"], [data-automation-id="formField-location"] input',
    current: 'input[name="currentlyWorkHere"], [data-automation-id="formField-currentlyWorkHere"] input[type=checkbox]',
    description: 'textarea[name="roleDescription"], [data-automation-id="formField-roleDescription"] textarea',
    start: '[data-automation-id="formField-startDate"]',
    end: '[data-automation-id="formField-endDate"]',
  },
  school: {
    // Some tenants call it "school" (id "education-49--school") instead of "schoolName".
    school: 'input[name="schoolName"], [data-automation-id="formField-schoolName"] input, [data-automation-id="formField-school"] input',
    degree: 'button[name="degree"], [data-automation-id="formField-degree"] button[aria-haspopup="listbox"]',
    field: '[data-automation-id="formField-fieldOfStudy"] input[data-automation-id="searchBox"], [data-automation-id="formField-fieldOfStudy"] input',
    gpa: 'input[name="gradeAverage"], [data-automation-id="formField-gradeAverage"] input',
    start: '[data-automation-id="formField-firstYearAttended"]',
    end: '[data-automation-id="formField-lastYearAttended"]',
  },
  url: 'input[name="url"], [data-automation-id="formField-url"] input',
  dateWrapper: '[data-automation-id="dateInputWrapper"]',
  day: 'input[data-automation-id="dateSectionDay-input"]',
  month: 'input[data-automation-id="dateSectionMonth-input"]',
  year: 'input[data-automation-id="dateSectionYear-input"]',
} as const;

const OVERRIDES: Override[] = [
  { selector: '[id*="firstName" i], [data-automation-id*="firstName" i]', key: 'firstName', value: (c) => c.profile.personal.firstName },
  { selector: '[id*="middleName" i], [data-automation-id*="middleName" i]', key: 'middleName', value: (c) => c.profile.personal.middleName },
  { selector: '[id*="lastName" i], [data-automation-id*="lastName" i]', key: 'lastName', value: (c) => c.profile.personal.lastName },
  { selector: '[id*="addressLine1" i], [data-automation-id*="addressLine1" i]', key: 'street', value: (c) => c.profile.personal.street },
  { selector: '[id*="addressLine2" i], [data-automation-id*="addressLine2" i]', key: 'addressLine2', value: (c) => c.profile.personal.addressLine2 },
  { selector: '[id*="--city" i], [data-automation-id*="_city" i], [data-automation-id="city"]', key: 'city', value: (c) => c.profile.personal.city },
  { selector: '[id*="postalCode" i], [data-automation-id*="postal" i]', key: 'zip', value: (c) => c.profile.personal.zip },
  { selector: '[id*="countryRegion" i], [data-automation-id*="countryRegion" i]', key: 'state', value: (c) => c.profile.personal.state },
  { selector: '[id*="phoneType" i], [data-automation-id*="phone-device-type" i]', key: 'phoneType', value: () => 'Mobile' },
  { selector: '[id*="--phoneNumber" i], [data-automation-id="phone-number"]', key: 'phone', value: (c) => c.profile.personal.phone.replace(/^\+?1[\s-]?/, '') },
  { selector: '[id*="countryPhoneCode" i], [data-automation-id*="country-phone-code" i]', key: 'phoneCountryCode', value: (c) => (c.profile.personal.country ? `${c.profile.personal.country} (${c.profile.personal.phoneCountryCode})` : null) },
  { selector: '[id*="--email" i], [data-automation-id="email"]', key: 'email', value: (c) => c.profile.personal.email },
  { selector: SELECTORS.linkedin, key: 'linkedin', value: (c) => c.profile.links.linkedin },
  { selector: '[id*="dateSectionMonth" i]:not([id*="startDate" i]):not([id*="endDate" i]):not([id*="Year" i])', key: 'todayMonth', value: () => todayISO().slice(5, 7) },
  { selector: '[id*="dateSectionDay" i]', key: 'todayDay', value: () => todayISO().slice(8, 10) },
  { selector: '[id*="dateSectionYear" i]:not([id*="startDate" i]):not([id*="endDate" i]):not([id*="YearAttended" i])', key: 'todayYear', value: () => todayISO().slice(0, 4) },
];

// ---------------------------------------------------------------------------

function currentStep(): string {
  const active = document.querySelector(SELECTORS.activeStep);
  const text = active?.textContent ?? document.querySelector('h2, [data-automation-id="pageHeader"]')?.textContent ?? '';
  return normalize(text);
}

/** "Add" / "Add Another" button belonging to a section: the one holding this kind of panel, else by its heading. */
function addButtonFor(kind: Kind | RegExp): HTMLElement | null {
  const { field, section } = kind instanceof RegExp ? { field: null, section: kind } : KINDS[kind];
  const buttons = queryAllDeep<HTMLElement>(`${SELECTORS.addButton}, button`).filter(
    (b) => isVisible(b) && (/^add( another)?$/i.test((b.textContent ?? '').trim()) || b.matches(SELECTORS.addButton)),
  );
  for (const b of buttons) {
    const aria = b.getAttribute('aria-label') ?? '';
    const group = b.closest('[role="group"]:not([aria-labelledby$="-panel"]), section, [data-automation-id*="Section" i]');
    const heading = group?.querySelector('h2, h3, h4, legend')?.textContent ?? '';
    if (field && group?.querySelector(field)) return b;
    if (section.test(`${aria} ${heading} ${group?.getAttribute('aria-labelledby') ?? ''}`)) return b;
  }
  return null;
}

/** What identifies each kind of panel, and the section names its Add button may sit under. */
const KINDS = {
  jobs: { field: `${PANEL.job.title}, ${PANEL.job.company}`, section: /work experience|professional experience|employment|work history/i },
  schools: { field: PANEL.school.school, section: /education/i },
  websites: { field: PANEL.url, section: /websites?|portfolio|links/i },
} as const;
type Kind = keyof typeof KINDS;

const panels = (kind: Kind) => queryAllDeep<HTMLElement>(PANEL.any).filter((p) => isVisible(p) && !!p.querySelector(KINDS[kind].field));

/** The job/school/website panel an element sits in, if any. */
const panelOf = (el: Element, ...kinds: Kind[]) => {
  const panel = el.closest(PANEL.any);
  return !!panel && kinds.some((k) => !!panel.querySelector(KINDS[k].field));
};

/** Click the section's Add button until there are `count` panels. */
async function ensurePanels(kind: Kind, count: number): Promise<HTMLElement[]> {
  for (let guard = 0; panels(kind).length < count && guard < count + 2; guard++) {
    const add = addButtonFor(kind);
    if (!add) break;
    const before = panels(kind).length;
    realClick(add);
    // No new panel of this kind: clicking again would only stack up empty entries.
    if (!(await waitForElement(() => (panels(kind).length > before ? document.body : null), 3000))) break;
    await sleep(300);
  }
  return panels(kind);
}

const ym = (iso: string) => ({ month: iso ? iso.split('-')[1] ?? '' : '', year: iso ? iso.split('-')[0] : '' });

function record(results: FieldResult[], label: string, ok: boolean, reason?: string) {
  results.push({ label, status: ok ? 'filled' : 'review', reason: ok ? undefined : reason });
}

async function setText(root: ParentNode, selector: string, value: string, results: FieldResult[], label: string): Promise<void> {
  const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el || !value) return;
  if (el.value.trim()) return; // Workday's resume parsing may already have filled it
  realClick(el);
  const outcome = fillText(el, value);
  record(results, label, outcome.ok && !outcome.review, outcome.review);
  await sleep(120);
}

/**
 * Workday dates are spin-button inputs whose value shows in a sibling
 * "-display" element. Try the gentlest method first and verify after each.
 */
async function setDatePart(input: HTMLInputElement, value: string): Promise<boolean> {
  if (!value) return true;
  const display = document.getElementById(input.id.replace(/-input$/, '-display'));
  const shown = () => (display?.textContent ?? input.getAttribute('aria-valuenow') ?? input.value ?? '').trim();
  const ok = () => {
    const s = shown();
    return s === value || (/^\d+$/.test(s) && Number(s) === Number(value));
  };
  if (ok()) return true;
  const section = input.parentElement as HTMLElement | null;
  const attempts: (() => void)[] = [
    () => typeInto(input, value),
    () => {
      input.select?.();
      if (typeof document.execCommand === 'function') document.execCommand('insertText', false, value);
    },
    () => {
      for (const ch of value) {
        const init = { key: ch, code: `Digit${ch}`, keyCode: 48 + Number(ch), which: 48 + Number(ch), bubbles: true, cancelable: true, composed: true };
        input.dispatchEvent(new KeyboardEvent('keydown', init));
        input.dispatchEvent(new KeyboardEvent('keypress', init));
        input.dispatchEvent(new KeyboardEvent('keyup', init));
      }
    },
  ];
  for (const attempt of attempts) {
    if (section) realClick(section);
    input.focus();
    attempt();
    await sleep(200);
    if (ok()) return true;
  }
  return false;
}

/** Fill a month/year (or year-only) date field inside a panel. */
async function setDate(field: Element | null, iso: string, results: FieldResult[], label: string): Promise<void> {
  if (!field || !iso) return;
  const { month, year } = ym(iso);
  const day = iso.split('-')[2] ?? '';
  const monthInput = field.querySelector<HTMLInputElement>(PANEL.month);
  const dayInput = field.querySelector<HTMLInputElement>(PANEL.day);
  const yearInput = field.querySelector<HTMLInputElement>(PANEL.year);
  let ok = true;
  if (monthInput) ok = (await setDatePart(monthInput, month)) && ok;
  if (dayInput) ok = (await setDatePart(dayInput, day || '01')) && ok;
  if (yearInput) ok = (await setDatePart(yearInput, year)) && ok;
  if (yearInput || monthInput) blur(yearInput ?? monthInput!);
  record(results, label, ok, `Enter ${monthInput ? `${month}/` : ''}${year} yourself.`);
}

async function fillJobs(jobs: Experience[], results: FieldResult[]): Promise<void> {
  if (!jobs.length) return;
  const found = await ensurePanels('jobs', jobs.length);
  // Panels Workday pre-filled from your resume keep their job; empty panels take the rest in order.
  const order = assignJobs(found, jobs);
  for (let i = 0; i < order.length; i++) {
    const panel = panels('jobs')[i] ?? found[i]; // re-query: panels re-render as they're filled
    const job = order[i];
    if (!job) continue;
    const tag = `Job ${i + 1} (${job.company})`;
    await setText(panel, PANEL.job.title, job.title, results, `${tag}: title`);
    await setText(panel, PANEL.job.company, job.company, results, `${tag}: company`);
    await setText(panel, PANEL.job.location, job.location, results, `${tag}: location`);
    const current = panel.querySelector<HTMLInputElement>(PANEL.job.current);
    if (current && job.current && !current.checked) {
      fillCheckbox(current, 'Yes');
      await sleep(250); // the end-date field disappears
    }
    await setDate(panel.querySelector(PANEL.job.start), job.start, results, `${tag}: from`);
    if (!job.current) await setDate(panel.querySelector(PANEL.job.end), job.end, results, `${tag}: to`);
    await setText(panel, PANEL.job.description, job.description, results, `${tag}: description`);
  }
  if (found.length < jobs.length) results.push({ label: 'Work experience', status: 'review', reason: `Added ${found.length} of ${jobs.length} jobs — add the rest yourself.` });
}

function assignJobs(found: HTMLElement[], jobs: Experience[]): (Experience | undefined)[] {
  const remaining = [...jobs];
  const order: (Experience | undefined)[] = found.map((panel) => {
    const company = normalize(panel.querySelector<HTMLInputElement>(PANEL.job.company)?.value ?? '');
    if (!company) return undefined;
    const idx = remaining.findIndex((j) => {
      const c = normalize(j.company);
      return c && (c.includes(company) || company.includes(c));
    });
    return idx >= 0 ? remaining.splice(idx, 1)[0] : undefined;
  });
  return order.map((job, i) => job ?? (normalize(found[i].querySelector<HTMLInputElement>(PANEL.job.company)?.value ?? '') ? undefined : remaining.shift()));
}

/** One Websites panel per link (portfolio/website, then GitHub), each with a different URL. */
async function fillWebsites(links: string[], results: FieldResult[]): Promise<void> {
  if (!links.length || !addButtonFor('websites') && !panels('websites').length) return;
  const found = await ensurePanels('websites', links.length);
  for (let i = 0; i < Math.min(found.length, links.length); i++) {
    const panel = panels('websites')[i] ?? found[i];
    await setText(panel, PANEL.url, links[i], results, `Website ${i + 1}`);
  }
}

/** Dates outside job/school panels (e.g. the self-identify signature date), answered by their label. */
async function fillStandaloneDates(ctx: FillContext, results: FieldResult[]): Promise<void> {
  const answers = { profile: ctx.profile, skills: ctx.profile.skills };
  for (const wrapper of queryAllDeep<HTMLElement>(PANEL.dateWrapper).filter(isVisible)) {
    if (panelOf(wrapper, 'jobs', 'schools')) continue;
    const field = wrapper.closest('[data-automation-id^="formField"]') ?? wrapper.parentElement;
    const label = (field?.querySelector('legend, label')?.textContent ?? '').replace(/\*/g, '').trim();
    const answer = resolveAnswer(label || 'Date', '', null, answers, false).answer;
    if (!answer?.isDate || typeof answer.value !== 'string') continue;
    await setDate(wrapper, answer.value, results, label || 'Date');
  }
}

/** Workday prompt: add the first spelling that has a match, tier by tier. */
async function firstMatch(input: HTMLElement, tiers: string[][]): Promise<boolean> {
  for (const tier of tiers) {
    for (const spelling of tier) {
      const { added } = await fillMultiCombobox(input, [spelling], { enterToSearch: true });
      if (added.length) return true;
    }
  }
  return false;
}

/** Workday's school list spells campuses "University of California-Irvine": search that first. */
function workdaySchoolOrder(variants: string[]): string[] {
  return [...variants.filter((v) => /\S-\S/.test(v)), ...variants.filter((v) => !/\S-\S/.test(v))];
}

async function fillSchools(schools: Education[], results: FieldResult[]): Promise<void> {
  if (!schools.length) return;
  const found = await ensurePanels('schools', schools.length);
  for (let i = 0; i < Math.min(found.length, schools.length); i++) {
    const panel = panels('schools')[i] ?? found[i];
    const ed = schools[i];
    const tag = `School ${i + 1}`;
    const schoolEl = panel.querySelector<HTMLElement>(PANEL.school.school);
    const picked = !!schoolEl?.closest('[data-automation-id^="formField-"]')?.querySelector('[data-automation-id="selectedItem"]');
    if (schoolEl && ed.school && !(schoolEl as HTMLInputElement).value && !picked) {
      const outcome =
        schoolEl.getAttribute('role') === 'combobox' || schoolEl.closest(SELECTORS.multiselect)
          ? await firstMatch(schoolEl, [workdaySchoolOrder(schoolVariants(ed.school))]).then((ok) => ({ ok, review: ok ? undefined : 'Pick your school from the list.' }))
          : fillText(schoolEl as HTMLInputElement, ed.school);
      record(results, `${tag}: school`, outcome.ok && !outcome.review, outcome.review);
    }
    const degree = panel.querySelector<HTMLElement>(PANEL.school.degree);
    if (degree && ed.degree) {
      // Replace a wrong pick (e.g. one made by resume parsing) only if it doesn't already match.
      const outcome = await fillCombobox(degree, ed.degree, { tiers: degreeTiers(ed.degree) });
      record(results, `${tag}: degree`, outcome.ok && !outcome.review, outcome.review);
    }
    const field = panel.querySelector<HTMLElement>(PANEL.school.field);
    if (field && ed.major) {
      const tiers = majorPreferenceTiers(ed.major, ed.majorFallbacks);
      const ok = await firstMatch(field, tiers);
      record(results, `${tag}: field of study`, ok, 'Pick your major from the list.');
    }
    await setText(panel, PANEL.school.gpa, ed.gpa, results, `${tag}: GPA`);
    await setDate(panel.querySelector(PANEL.school.start), ed.start, results, `${tag}: from`);
    await setDate(panel.querySelector(PANEL.school.end), ed.end, results, `${tag}: to`);
  }
}

/** Add one Languages panel per language, then let the label-based engine fill its dropdowns. */
async function addLanguagePanels(count: number): Promise<number> {
  let added = 0;
  for (let i = 0; i < count; i++) {
    const add = addButtonFor(/languages?/i);
    if (!add) break;
    const before = queryAllDeep('button[aria-haspopup="listbox"], [role="combobox"]').length;
    realClick(add);
    await waitForElement(() => (queryAllDeep('button[aria-haspopup="listbox"], [role="combobox"]').length > before ? document.body : null), 3000);
    await sleep(300);
    added++;
  }
  return added;
}

async function fillSkills(skills: string[], results: FieldResult[]): Promise<void> {
  const container = document.querySelector<HTMLElement>(SELECTORS.skills);
  const input = container?.querySelector<HTMLElement>(`${SELECTORS.multiselect} input, input`);
  if (!input || !skills.length) return;
  const { added, skipped } = await fillMultiCombobox(input, skills, { enterToSearch: true });
  results.push({
    label: 'Skills',
    status: added.length ? 'filled' : 'review',
    reason: skipped.length ? `No match for: ${skipped.slice(0, 8).join(', ')}` : undefined,
  });
}

// Steps already handled on this page, so watching for new steps doesn't add panels twice.
const doneSteps = new Set<string>();

export const workday: Adapter = {
  id: 'workday',
  name: 'Workday',
  detect(url) {
    const host = url.hostname;
    if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) return true;
    return /^wd\d+\.myworkday\.com$/.test(host);
  },
  async fill(ctx: FillContext): Promise<FillReport> {
    const step = currentStep();
    const stepKey = `${location.pathname}|${step}`;
    const extra: FieldResult[] = [];

    if (!ctx.incremental) doneSteps.clear();
    const firstVisit = !doneSteps.has(stepKey);
    doneSteps.add(stepKey);

    // The generic pass handles the resume (first), names, address, questions, EEO, self-identify.
    const report = await fillPage(ctx, {
      ats: this.name,
      overrides: OVERRIDES,
      incremental: ctx.incremental,
      resumeTarget: () => queryAllDeep<HTMLElement>(SELECTORS.resume)[0] ?? null,
      // Panel fields are filled below, one panel per entry.
      skip: (f) =>
        f.el.matches(SELECTORS.source) ||
        panelOf(f.el, 'jobs', 'schools', 'websites') ||
        /workexperience|education-\d|\beducation\b|skills/i.test(`${f.el.id} ${f.el.getAttribute('data-automation-id') ?? ''}`),
    });

    const source = document.querySelector<HTMLElement>(SELECTORS.source);
    if (firstVisit && source && isVisible(source) && ctx.profile.answers.referralSource) {
      const { added } = await fillMultiCombobox(source, [ctx.profile.answers.referralSource], { enterToSearch: true });
      extra.push({ label: 'How did you hear about us?', status: added.length ? 'filled' : 'review', reason: added.length ? undefined : 'Pick a source from the list.' });
    }

    if (firstVisit) await fillStandaloneDates(ctx, extra);

    if (firstVisit && /experience/.test(step)) {
      await waitForStable(document.body, 800, 8000);
      const jobs = ctx.profile.experience.filter((e) => e.type !== 'Volunteer');
      await fillJobs(jobs, extra);
      await fillSchools(ctx.profile.education, extra);
      const { website, portfolio, linkedin, github } = ctx.profile.links;
      // No LinkedIn box on the form: list LinkedIn under Websites too.
      const hasLinkedinField = queryAllDeep(SELECTORS.linkedin).some((el) => isVisible(el as HTMLElement));
      await fillWebsites([...new Set([portfolio || website, hasLinkedinField ? '' : linkedin, github].filter(Boolean))], extra);
      await fillSkills(ctx.skills?.length ? ctx.skills : ctx.profile.skills, extra);
      const languages = ctx.profile.languages.filter((l) => l.language);
      if (languages.length && (await addLanguagePanels(languages.length))) {
        // Language, "I am fluent", and the reading/writing/speaking/comprehension/overall levels.
        const more = await fillPage({ ...ctx, incremental: true }, { ats: this.name, overrides: OVERRIDES });
        extra.push(...more.fields);
      }
    }

    report.fields.push(...extra);
    report.filled += extra.filter((r) => r.status === 'filled').length;
    report.needsReview = report.fields.filter((r) => r.status === 'review').length;
    report.notes.push(step ? `Workday step: ${step}.` : 'Workday step not recognized.');

    // Opt-in, and only when nothing on this step needs a person.
    if (ctx.settings.workdayAutoAdvance && report.needsReview === 0) {
      const next = queryAllDeep<HTMLButtonElement>(SELECTORS.next).find((b) => isVisible(b) && !b.disabled);
      if (next && !/submit/i.test(next.textContent ?? '')) {
        realClick(next);
        report.notes.push('Moved to the next Workday step. Review it before submitting.');
      }
    }
    return report;
  },
};
