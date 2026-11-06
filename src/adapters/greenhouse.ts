import { LEAVE_EMPTY, type AnswerContext } from '../lib/engine/answers';
import { fillPage, type Override } from '../lib/engine/fill';
import { dashedPhone } from '../lib/phone';
import { normalize, US_STATES } from '../lib/engine/text';
import type { Experience, Profile } from '../lib/types';
import type { Adapter } from './types';

// Every selector for Greenhouse's job-boards UI. Update here when the site changes.
const SELECTORS = {
  resume: 'input#resume[type=file]',
  firstName: '#first_name',
  lastName: '#last_name',
  preferredName: '#preferred_name',
  email: '#email',
  phone: '#phone',
  // A phone box with its own country-code picker (the site adds the +1 and formats the number).
  phoneWithCountry: '.phone-input #phone, .iti #phone',
  country: '#country',
  location: '#candidate-location',
  // The "Enter manually" text areas next to the resume/cover-letter uploads.
  manualEntry: '#resume_text, #cover_letter_text',
  // The emailed code you type before submitting; never ours to fill.
  verificationCode: '#email-verification input, [id^="security-input-"]',
} as const;

/**
 * Your city with its state ("Springfield, Illinois" / "Springfield, IL"). The location search
 * lists every town with that name, and the city alone can't tell them apart.
 */
export function cityWithState(p: Profile): string[] {
  const { city, state } = p.personal;
  const n = normalize(state);
  if (!city.trim() || !n) return [];
  const full = US_STATES[n] ?? n;
  const abbreviation = Object.keys(US_STATES).find((key) => US_STATES[key] === full);
  if (!abbreviation) return [`${city.trim()}, ${state.trim()}`];
  const title = full.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/ Of /g, ' of ');
  return [`${city.trim()}, ${title}`, `${city.trim()}, ${abbreviation.toUpperCase()}`];
}

/** A lone Greenhouse phone box gets "1-415-555-0100". */
export const greenhousePhone = dashedPhone;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (iso: string) => MONTHS[Number(iso.split('-')[1]) - 1] ?? '';

/**
 * The Employment blocks (company-name-0, title-0, start-date-month-0, …, current-role-0): block N
 * gets job N from your profile, not your latest job in every block or your school dates. A
 * current job leaves the end date empty and ticks "Current role". Blocks beyond your jobs stay as they are.
 */
const EMPLOYMENT_BLOCKS = 10;
function employmentOverrides(): Override[] {
  const out: Override[] = [];
  for (let i = 0; i < EMPLOYMENT_BLOCKS; i++) {
    const job = (c: AnswerContext) => c.profile.experience[i];
    const part = (selector: string, key: string, get: (j: Experience) => string) =>
      out.push({ selector, key, value: (c) => { const j = job(c); return j ? get(j) || LEAVE_EMPTY : LEAVE_EMPTY; } });
    part(`#company-name-${i}`, 'employmentCompany', (j) => j.company);
    part(`#title-${i}`, 'employmentTitle', (j) => j.title);
    part(`#start-date-month-${i}`, 'employmentStartMonth', (j) => (j.start ? monthName(j.start) : ''));
    part(`#start-date-year-${i}`, 'employmentStartYear', (j) => j.start.slice(0, 4));
    part(`#end-date-month-${i}`, 'employmentEndMonth', (j) => (j.current || !j.end ? '' : monthName(j.end)));
    part(`#end-date-year-${i}`, 'employmentEndYear', (j) => (j.current ? '' : j.end.slice(0, 4)));
    part(`#current-role-${i}_1, input[name="current-role-${i}"]`, 'employmentCurrent', (j) => (j.current ? 'Yes' : 'No'));
  }
  return out;
}

const OVERRIDES: Override[] = [
  ...employmentOverrides(),
  { selector: SELECTORS.firstName, key: 'firstName', value: (c) => c.profile.personal.firstName },
  { selector: SELECTORS.lastName, key: 'lastName', value: (c) => c.profile.personal.lastName },
  { selector: SELECTORS.preferredName, key: 'preferredName', value: (c) => c.profile.personal.preferredName },
  { selector: SELECTORS.email, key: 'email', value: (c) => c.profile.personal.email },
  { selector: SELECTORS.phoneWithCountry, key: 'phone', value: (c) => c.profile.personal.phone },
  { selector: SELECTORS.phone, key: 'phone', value: (c) => greenhousePhone(c.profile) },
  { selector: SELECTORS.country, key: 'country', value: (c) => c.profile.personal.country },
  { selector: SELECTORS.location, key: 'location', value: (c) => c.profile.personal.city, tiers: (c) => [cityWithState(c.profile)] },
];

export const greenhouse: Adapter = {
  id: 'greenhouse',
  name: 'Greenhouse',
  detect(url) {
    const host = url.hostname;
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') return true;
    // Embedded board iframe served from a Greenhouse host, e.g. /embed/job_app?for=acme
    return host.endsWith('.greenhouse.io') && url.pathname.includes('/embed/');
  },
  async fill(ctx) {
    return fillPage(ctx, {
      ats: this.name,
      overrides: OVERRIDES,
      incremental: ctx.incremental,
      resumeTarget: () => document.querySelector<HTMLElement>(SELECTORS.resume),
      skip: (f) => f.el.matches(SELECTORS.manualEntry) || f.el.matches(SELECTORS.verificationCode),
    });
  },
};
