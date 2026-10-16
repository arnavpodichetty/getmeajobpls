import { fillPage, type Override } from '../lib/engine/fill';
import { fullName } from '../lib/engine/answers';
import type { Adapter } from './types';

const NAME_INPUT = 'input:is([type="text"], :not([type]))';

// Every selector for jobs.ashbyhq.com. Update here when the site changes.
const SELECTORS = {
  // The real resume field; the "Autofill from resume" drop zone at the top is a different input.
  resume: 'input#_systemfield_resume[type=file]',
  // The disability survey has a separate applicant-name field. Its technical
  // name can include "disability" or "EEOC", but it still takes the full name.
  fullName: [
    '#_systemfield_name',
    `${NAME_INPUT}[name*="disability" i][name$="name" i]`,
    `${NAME_INPUT}[id*="disability" i][id$="name" i]`,
    `${NAME_INPUT}[name*="eeoc" i][name$="name" i]`,
    `${NAME_INPUT}[id*="eeoc" i][id$="name" i]`,
  ].join(', '),
  email: '#_systemfield_email',
  location: 'input[role="combobox"][placeholder^="Start typing"]',
} as const;

const OVERRIDES: Override[] = [
  { selector: SELECTORS.fullName, key: 'fullName', value: (c) => fullName(c.profile) },
  { selector: SELECTORS.email, key: 'email', value: (c) => c.profile.personal.email },
  { selector: SELECTORS.location, key: 'location', value: (c) => [c.profile.personal.city, c.profile.personal.state].filter(Boolean).join(', ') },
];

export const ashby: Adapter = {
  id: 'ashby',
  name: 'Ashby',
  detect(url) {
    return url.hostname === 'jobs.ashbyhq.com';
  },
  async fill(ctx) {
    return fillPage(ctx, {
      ats: this.name,
      overrides: OVERRIDES,
      incremental: ctx.incremental,
      resumeTarget: () => document.querySelector<HTMLElement>(SELECTORS.resume),
    });
  },
};
