// Shared helpers for running the fill engine against captured ATS pages.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FillContext } from '../../src/adapters/types';
import { emptyProfile, defaultSettings } from '../../src/lib/defaults';
import { TIMING } from '../../src/lib/engine/controls';
import { resetLayoutCache } from '../../src/lib/engine/dom';

/** A complete, fictional profile (no real personal data in tests). */
export function testProfile() {
  const p = emptyProfile();
  Object.assign(p.personal, {
    firstName: 'Ada', middleName: 'K', lastName: 'Lovelace', preferredName: 'Ada', pronouns: 'she/her',
    email: 'ada@example.com', phone: '(415) 555-0100', street: '1 Analytical Way', city: 'Los Angeles', state: 'CA',
    universityEmail: 'ada@university.edu',
    zip: '90024', country: 'United States',
  });
  Object.assign(p.links, { linkedin: 'https://linkedin.com/in/ada', github: 'https://github.com/ada', website: 'https://ada.dev', portfolio: 'https://ada.dev/work' });
  p.education = [{ id: 'e1', school: 'University of California, Los Angeles', degree: "Bachelor's Degree", major: 'Computer Science', majorFallbacks: ['Software Engineering'], secondMajor: '', minor: 'Music', gpa: '3.9', coursework: '', start: '2024-09', end: '2028-06' }];
  p.experience = [{ id: 'x1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: 'Seattle, WA', start: '2026-09', end: '', current: true, description: 'Built things.' }];
  p.skills = ['Python', 'SQL', 'Java'];
  p.languages = [{ id: 'l1', language: 'English', proficiency: 'Fluent', fluent: true }];
  Object.assign(p.answers, {
    workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes', over18: 'Yes', previouslyEmployed: 'No',
    travelPercentage: '25-50%', phoneTextConsent: 'No', governmentDebarment: 'No', disciplinaryHistory: 'No', fiduciaryRoles: 'No', currentEmployerClient: 'No', governmentConsulting: 'No', optStatus: 'N/A', stemOptEligible: 'N/A',
    highSchoolGraduationYear: '2024', standardizedTestType: 'Not taken', satScore: 'Not taken', actScore: 'Not taken', furtherEducation: 'No', currentOffers: 'No',
    nonCompete: 'No', relatedToEmployee: 'No', governmentOfficial: 'No', conflictOfInterest: 'No', meetsRequirements: 'Yes', appliedBefore: 'No', agreeToTerms: 'Yes', securityClearance: 'None', citizenship: 'United States', referralSource: 'LinkedIn', earliestStartDate: '2027-05-26',
    locationPreferences: ['California'],
  });
  return p;
}

export function context(overrides: Partial<FillContext> = {}): FillContext {
  const file = new File(['%PDF-1.4 test'], 'ada-resume.pdf', { type: 'application/pdf' });
  return {
    profile: testProfile(),
    resume: { meta: { id: 'r1', name: 'General', tags: [], skills: [], fileName: 'ada-resume.pdf', mimeType: 'application/pdf', size: 13, uploadedAt: 0, isDefault: true }, file },
    settings: defaultSettings(),
    ...overrides,
  };
}

/** Load a captured page into the test DOM (declarative shadow roots included). */
export function loadFixture(name: string): void {
  const html = readFileSync(resolve(__dirname, '../fixtures', `${name}.html`), 'utf8');
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  document.body.innerHTML = body;
  attachDeclarativeShadowRoots(document.body);
  resetLayoutCache();
}

/** happy-dom doesn't process <template shadowrootmode>; attach them like Chrome does. */
function attachDeclarativeShadowRoots(root: ParentNode): void {
  for (const template of [...root.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')]) {
    const host = template.parentElement;
    if (!host || host.shadowRoot) continue;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(template.content.cloneNode(true));
    template.remove();
    attachDeclarativeShadowRoots(shadow);
  }
}

/** Dropdowns can't open in a static fixture; don't wait long for them. */
export function fastTimings(): void {
  TIMING.open = 20;
  TIMING.search = 20;
  TIMING.multi = 20;
}

// happy-dom leaves <option>.label undefined; Chrome returns the text.
if (typeof HTMLOptionElement !== 'undefined' && !Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'label')?.get?.call(document.createElement('option'))) {
  Object.defineProperty(HTMLOptionElement.prototype, 'label', {
    configurable: true,
    get() {
      return this.getAttribute('label') ?? this.textContent ?? '';
    },
  });
}
