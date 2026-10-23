import { fillPage, type Override } from '../lib/engine/fill';
import type { Profile } from '../lib/types';
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
} as const;

/**
 * A lone Greenhouse phone box gets "1-415-555-0100": country code, then the 10-digit
 * number in groups. Other lengths are left as saved.
 */
export function greenhousePhone(p: Profile): string {
  const digits = p.personal.phone.replace(/\D/g, '');
  const cc = p.personal.phoneCountryCode.replace(/\D/g, '');
  if (digits.length !== 10) return p.personal.phone;
  const local = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return cc ? `${cc}-${local}` : local;
}

const OVERRIDES: Override[] = [
  { selector: SELECTORS.firstName, key: 'firstName', value: (c) => c.profile.personal.firstName },
  { selector: SELECTORS.lastName, key: 'lastName', value: (c) => c.profile.personal.lastName },
  { selector: SELECTORS.preferredName, key: 'preferredName', value: (c) => c.profile.personal.preferredName },
  { selector: SELECTORS.email, key: 'email', value: (c) => c.profile.personal.email },
  { selector: SELECTORS.phoneWithCountry, key: 'phone', value: (c) => c.profile.personal.phone },
  { selector: SELECTORS.phone, key: 'phone', value: (c) => greenhousePhone(c.profile) },
  { selector: SELECTORS.country, key: 'country', value: (c) => c.profile.personal.country },
  { selector: SELECTORS.location, key: 'location', value: (c) => c.profile.personal.city },
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
      skip: (f) => f.el.matches(SELECTORS.manualEntry),
    });
  },
};
