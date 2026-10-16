import { describe, expect, it } from 'vitest';
import { fillPage } from '../src/lib/engine/fill';
import { resolveAnswer } from '../src/lib/engine/answers';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { optionScore } from '../src/lib/engine/text';
import { context, fastTimings, testProfile } from './helpers/fixture';

const affirmations = ['I understand', 'Understand', 'Understood', 'I acknowledge', 'Acknowledged', 'I accept', 'I agree', 'Yes'];

describe('statement acknowledgments', () => {
  it.each(affirmations)('recognizes %s as an affirmative option', (option) => {
    expect(optionScore(option, 'Yes')).toBeGreaterThanOrEqual(0.85);
  });

  it.each(['I do not understand', 'Do not agree', 'I disagree', 'Yes, I do not accept'])('does not accept a negative acknowledgment: %s', (option) => {
    expect(optionScore(option, 'Yes')).toBe(0);
  });

  it.each(['select', 'combobox'])('selects the sole affirmative choice in statement %s fields', async (kind) => {
    fastTimings();
    document.body.innerHTML = affirmations.map((option, i) => `
      <div data-automation-id="formField-statement${i}">
        <label for="statement${i}">Applicant statement ${i}*</label>
        ${kind === 'select'
          ? `<select id="statement${i}" required><option value="">Select One</option><option>${option}</option></select>`
          : `<button id="statement${i}" aria-haspopup="listbox">Select One</button>`}
      </div>`).join('');
    document.querySelectorAll('button').forEach((button, i) => {
      button.addEventListener('click', () => {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = affirmations[i];
        option.addEventListener('click', () => { button.textContent = affirmations[i]; option.remove(); });
        document.body.append(option);
      });
    });
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
    expect(report.filled).toBe(affirmations.length);
    expect(report.needsReview).toBe(0);
    affirmations.forEach((option, i) => {
      const field = document.getElementById(`statement${i}`)!;
      expect(field instanceof HTMLSelectElement ? field.value : field.textContent).toBe(option);
    });
  });

  it('uses the editable agreement preference without overriding text consent or other disclosures', () => {
    const profile = testProfile();
    const ask = (label: string) => resolveAnswer(label, '', null, { profile, skills: [] }, true).answer?.value;
    for (const label of ['Applicant Statement', 'Acknowledgment', 'Acknowledgement', 'Application declaration']) expect(ask(label)).toBe('Yes');
    expect(ask('Privacy statement: I consent to receive telephone calls and text messages')).toBe('No');
    expect(resolveAnswer('Personal statement', '', null, { profile, skills: [] }, false).answer).toBeNull();
    profile.answers.agreeToTerms = 'No';
    expect(ask('Applicant Statement')).toBe('No');
    profile.answers.agreeToTerms = '';
    expect(ask('Applicant Statement')).toBeUndefined();
  });

  it('does not select an unrelated sole option or override a No agreement preference', async () => {
    document.body.innerHTML = `<label for="statement">Applicant statement*</label>
      <select id="statement" required><option value="">Select One</option><option>I understand</option></select>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.answers.agreeToTerms = 'No';
    const report = await fillPage(ctx, { ats: 'Greenhouse' });
    expect(document.querySelector<HTMLSelectElement>('#statement')?.value).toBe('');
    expect(report.needsReview).toBe(1);
    expect(optionScore('Expert', 'Yes')).toBe(0);
  });
});
