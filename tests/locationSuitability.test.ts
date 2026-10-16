import { describe, expect, it } from 'vitest';
import { ashby } from '../src/adapters/ashby';
import { emptyProfile, normalizeProfile } from '../src/lib/defaults';
import { resolveAnswer } from '../src/lib/engine/answers';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, testProfile } from './helpers/fixture';

const question = 'Do the office location and RTO requirements work for you?';

describe('office and location suitability', () => {
  it.each([
    question, 'Does this location work for you?', 'Is this job location acceptable to you?',
    'Does our hybrid schedule work for you?', 'Are you comfortable with the office location?',
    'Are you willing to work onsite?', 'Can you meet our return-to-office requirements?',
    'Are you able to commute to our office?', 'Is this location okay for you?',
  ])('answers Yes to %s', (label) => {
    expect(resolveAnswer(label, '', null, { profile: testProfile(), skills: [] }, true).answer?.value).toBe('Yes');
  });

  it('defaults to Yes and preserves No or unset when explicitly configured', () => {
    expect(emptyProfile().answers.officeLocationWorks).toBe('Yes');
    expect(normalizeProfile({ answers: {} }).answers.officeLocationWorks).toBe('Yes');
    for (const value of ['No', ''] as const) {
      const profile = normalizeProfile({ answers: { officeLocationWorks: value } });
      expect(resolveAnswer(question, '', null, { profile, skills: [] }, true).answer?.value).toBe(value || undefined);
    }
  });

  it('keeps actual address, residency, relocation, and work authorization questions separate', () => {
    const profile = testProfile();
    profile.answers.willingToRelocate = 'No';
    profile.answers.workAuthorized = 'No';
    const ask = (label: string) => resolveAnswer(label, '', null, { profile, skills: [] }, true).answer?.value;
    expect(ask('Location')).toBe('Los Angeles, CA');
    expect(ask('Are you a resident of Maryland?')).toBe('No');
    expect(ask('Are you willing to relocate to our office location?')).toBe('No');
    expect(ask('Are you legally authorized to work at this office location?')).toBe('No');
    expect(ask(question)).toBe('Yes');
  });

  it('selects Yes in the Ashby button group from the screenshot', async () => {
    document.body.innerHTML = `<fieldset><legend>${question}*</legend><div>
      <button data-option="yes" aria-pressed="false">Yes</button>
      <button data-option="no" aria-pressed="false">No</button>
    </div></fieldset>`;
    document.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true')));
    resetLayoutCache();
    const report = await ashby.fill(context({ resume: null }));
    expect(document.querySelector('[data-option="yes"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-option="no"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });
});
