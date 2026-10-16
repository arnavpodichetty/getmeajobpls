import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProfile, normalizeProfile } from '../src/lib/defaults';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings, testProfile } from './helpers/fixture';

const question = 'Do you have the availability to work 40 hours per week for 12 weeks during the summer at our San Francisco office?';
beforeEach(fastTimings);

describe('work schedule availability', () => {
  it.each([
    question,
    'Can you work 20 hours per week for 8 weeks in New York?',
    'Are you available to work 35 hrs a week for six months in London?',
    'Are you able to commit to a 10-week internship in Boston?',
    'Are you willing to work full-time for the duration of this program?',
    'Can you commit to this part-time role for three months remotely?',
    'Are you available for the required working hours at our Chicago office?',
    'Can you work the required shifts for this position?',
  ])('answers across roles: %s', (label) => {
    const profile = testProfile();
    profile.answers.officeLocationWorks = 'No';
    const ask = () => resolveAnswer(label, '', null, { profile, skills: [] }, true);
    expect(ask().matchedKey).toBe('workScheduleAvailable');
    expect(ask().answer?.value).toBe('Yes');
    profile.answers.workScheduleAvailable = 'No';
    expect(ask().answer?.value).toBe('No');
    profile.answers.workScheduleAvailable = '';
    expect(ask().answer).toBeNull();
  });

  it('defaults to Yes and preserves explicit overrides in existing profiles', () => {
    expect(emptyProfile().answers.workScheduleAvailable).toBe('Yes');
    expect(normalizeProfile({ answers: {} }).answers.workScheduleAvailable).toBe('Yes');
    expect(normalizeProfile({ answers: { workScheduleAvailable: 'No' } }).answers.workScheduleAvailable).toBe('No');
    expect(normalizeProfile({ answers: { workScheduleAvailable: '' } }).answers.workScheduleAvailable).toBe('');
  });

  it.each([
    'How many hours per week are you available to work?',
    'Which weeks are you available for this internship?',
    'What is your earliest available start date?',
    'Have you worked 40 hours per week before?',
    'Are you unable to work 40 hours per week?',
    'Are you legally authorized to work 40 hours per week?',
    'Will you need visa sponsorship for this 12-week internship?',
    'Are you willing to travel for work 3 weeks per month?',
    'Are you willing to relocate for this 12-week internship?',
  ])('keeps other questions separate: %s', (label) => {
    expect(resolveAnswer(label, '', null, { profile: testProfile(), skills: [] }, true).matchedKey).not.toBe('workScheduleAvailable');
  });

  it.each(['select', 'radio', 'checkbox', 'combobox'])('fills Yes in a %s control', async (kind) => {
    document.body.innerHTML = kind === 'select'
      ? `<label for="schedule">${question}</label><select id="schedule" required><option value="">Select...</option><option>Yes</option><option>No</option></select>`
      : kind === 'combobox'
        ? `<label for="schedule">${question}</label><button id="schedule" aria-haspopup="listbox">Select...</button>`
        : `<fieldset><legend>${question}</legend><label><input type="${kind}" name="schedule" value="Yes">Yes</label><label><input type="${kind}" name="schedule" value="No">No</label></fieldset>`;
    document.querySelector('button')?.addEventListener('click', () => {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = 'Yes';
      option.addEventListener('click', () => { document.querySelector('button')!.textContent = 'Yes'; option.remove(); });
      document.body.append(option);
    });
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
    if (kind === 'select') expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('Yes');
    else if (kind === 'combobox') expect(document.querySelector('button')!.textContent).toBe('Yes');
    else expect([...document.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value)).toEqual(['Yes']);
  });
});
