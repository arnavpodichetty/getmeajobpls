import { bestOption, MIN_OPTION_SCORE } from '../lib/engine/text';
import { todayISO } from '../lib/clock';
import { blur, isVisible, realClick, sleep, typeInto, waitForElement } from '../lib/engine/dom';
import { fillCheckbox, TIMING } from '../lib/engine/controls';
import { pronounTiers } from '../lib/engine/answers';
import { normalize } from '../lib/engine/text';
import { fillPage, type Override } from '../lib/engine/fill';
import type { FieldResult } from '../lib/types';
import type { Adapter, FillContext } from './types';

// Every selector for jobs.lever.co. Update here when the site changes.
const SELECTORS = {
  resume: '#resume-upload-input',
  fullName: 'input[name="name"]',
  email: 'input[name="email"]',
  phone: 'input[name="phone"]',
  company: 'input[name="org"]',
  linkedin: 'input[name="urls[LinkedIn]"]',
  github: 'input[name="urls[GitHub]"]',
  twitter: 'input[name="urls[Twitter]"], input[name="urls[X]"]',
  portfolio: 'input[name="urls[Portfolio]"]',
  otherUrl: 'input[name="urls[Other]"]',
  // Location is a search box whose result must be picked from a dropdown.
  location: '#location-input',
  locationResult: '.dropdown-results .dropdown-location, .dropdown-results > div',
  pronouns: 'input[name="pronouns"], #customPronounsOption, #customPronounsTextField',
  pronounOption: 'input[type="checkbox"][name="pronouns"]',
  disabilitySignature: 'input[name="eeo[disabilitySignature]"]',
  disabilityDate: 'input[name="eeo[disabilitySignatureDate]"]',
} as const;

const fullName = (c: { profile: FillContext['profile'] }) =>
  [c.profile.personal.firstName, c.profile.personal.lastName].filter(Boolean).join(' ');

const OVERRIDES: Override[] = [
  { selector: SELECTORS.fullName, key: 'fullName', value: fullName },
  { selector: SELECTORS.email, key: 'email', value: (c) => c.profile.personal.email },
  { selector: SELECTORS.phone, key: 'phone', value: (c) => c.profile.personal.phone },
  { selector: SELECTORS.company, key: 'currentCompany', value: (c) => (c.profile.experience.find((e) => e.current) ?? c.profile.experience[0])?.company },
  { selector: SELECTORS.linkedin, key: 'linkedin', value: (c) => c.profile.links.linkedin },
  { selector: SELECTORS.github, key: 'github', value: (c) => c.profile.links.github },
  { selector: SELECTORS.twitter, key: 'twitter', value: (c) => c.profile.links.twitter },
  { selector: SELECTORS.portfolio, key: 'portfolio', value: (c) => c.profile.links.portfolio || c.profile.links.website },
  { selector: SELECTORS.otherUrl, key: 'otherUrl', value: (c) => c.profile.links.other || c.profile.links.website },
  { selector: SELECTORS.disabilitySignature, key: 'fullName', value: fullName },
  { selector: SELECTORS.disabilityDate, key: 'todayDate', value: () => { const [y, m, d] = todayISO().split('-'); return `${Number(m)}/${Number(d)}/${y}`; } },
];

async function fillLocation(ctx: FillContext): Promise<FieldResult | null> {
  const input = document.querySelector<HTMLInputElement>(SELECTORS.location);
  const { city, state } = ctx.profile.personal;
  if (!input || !city || (input.value && !ctx.settings.overwriteExisting)) return null;
  typeInto(input, [city, state].filter(Boolean).join(', '));
  const first = await waitForElement(() => [...document.querySelectorAll<HTMLElement>(SELECTORS.locationResult)].find(isVisible), TIMING.search + 1000);
  if (!first) {
    blur(input);
    return { label: 'Current location', status: 'review', reason: 'Pick your city from the location dropdown.' };
  }
  const results = [...document.querySelectorAll<HTMLElement>(SELECTORS.locationResult)].filter(isVisible);
  const pick = bestOption(results, (r) => r.textContent ?? '', `${city}, ${state}`);
  realClick(pick && pick.score >= MIN_OPTION_SCORE ? pick.option : first);
  await sleep(200);
  if (ctx.settings.highlightFields) {
    input.setAttribute('data-getmeajobpls', 'filled');
    input.style.setProperty('outline', '2px solid #1f9d63', 'important');
    input.style.setProperty('outline-offset', '2px', 'important');
  }
  return { label: 'Current location', status: 'filled' };
}

/**
 * Lever's pronoun checkboxes carry no value, only their text. Tick the one whose
 * text is your pronouns ("he/him" → "He/him"); anything else is left to you.
 */
function fillPronouns(ctx: FillContext): FieldResult | null {
  const boxes = [...document.querySelectorAll<HTMLInputElement>(SELECTORS.pronounOption)];
  const pronouns = ctx.profile.personal.pronouns.trim();
  if (!boxes.length || !pronouns) return null;
  if (boxes.some((b) => b.checked) && !ctx.settings.overwriteExisting) return null;
  const wanted = new Set([pronouns, ...pronounTiers(pronouns).flat()].map(normalize));
  const text = (b: HTMLInputElement) => normalize(b.closest('label')?.textContent ?? '');
  const match = boxes.find((b) => wanted.has(text(b)));
  if (!match) return { label: 'Pronouns', status: 'review', reason: `No pronoun option matched "${pronouns}".` };
  for (const b of boxes) if (b !== match && b.checked) fillCheckbox(b, 'No');
  fillCheckbox(match, 'Yes');
  if (!match.checked) return { label: 'Pronouns', status: 'review', reason: 'Tick your pronouns.' };
  if (ctx.settings.highlightFields) {
    const list = (match.closest('#candidatePronounsCheckboxes') as HTMLElement | null) ?? match;
    list.setAttribute('data-getmeajobpls', 'filled');
    list.style.setProperty('outline', '2px solid #1f9d63', 'important');
    list.style.setProperty('outline-offset', '2px', 'important');
  }
  return { label: 'Pronouns', status: 'filled' };
}

export const lever: Adapter = {
  id: 'lever',
  name: 'Lever',
  detect(url) {
    return url.hostname === 'jobs.lever.co' || url.hostname === 'jobs.eu.lever.co';
  },
  async fill(ctx) {
    const report = await fillPage(ctx, {
      ats: this.name,
      overrides: OVERRIDES,
      incremental: ctx.incremental,
      resumeTarget: () => document.querySelector<HTMLElement>(SELECTORS.resume),
      // Location needs its dropdown pick; pronouns are matched by their text below.
      skip: (f) => f.members.some((m) => m.matches(`${SELECTORS.location}, ${SELECTORS.pronouns}`)),
    });
    for (const result of [await fillLocation(ctx), fillPronouns(ctx)]) {
      if (!result) continue;
      report.fields.push(result);
      if (result.status === 'filled') report.filled++;
      else report.needsReview++;
    }
    return report;
  },
};
