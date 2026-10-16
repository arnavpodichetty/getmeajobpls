import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { bestOptionTiered } from '../src/lib/engine/text';
import { context, fastTimings, testProfile } from './helpers/fixture';

const questions = [
  'Are you currently in a period of Optional Practical Training (OPT)?',
  'Do you hold a degree in a Science, Technology, Engineering, or Mathematics (STEM) field from a U.S. accredited institution that would allow you to apply for a 24-month OPT extension?',
];

describe('OPT preferences', () => {
  const c = { profile: testProfile(), skills: [] };
  const answer = resolveAnswer(questions[0], '', null, c, true).answer!;

  it.each([...questions, 'What is your OPT status?'])('uses N/A for %s', (question) => {
    expect(resolveAnswer(question, '', null, c, true).answer?.value).toBe('N/A');
  });

  it.each(['N/A', 'Not applicable', 'NA', 'Does not apply', 'Not applicable (U.S. citizens)'])('prefers %s to No', (label) => {
    expect(bestOptionTiered(['Yes', 'No', label], (option) => option, answer.tiers!)?.option).toBe(label);
  });

  it('falls back to No and never picks Yes', () => {
    expect(bestOptionTiered(['Yes', 'No'], (option) => option, answer.tiers!)?.option).toBe('No');
    expect(bestOptionTiered(['Yes'], (option) => option, answer.tiers!)).toBeNull();
    expect(resolveAnswer('I consent to opt in to text messages', '', null, c, true).answer?.value).toBe('No');
    expect(resolveAnswer('Do you need visa sponsorship?', '', null, c, true).answer?.key).toBe('needsSponsorship');
    expect(resolveAnswer('Will you require sponsorship for STEM OPT?', '', null, c, true).answer?.value).toBe('No');
  });

  const cases = ['select', 'radio', 'checkboxes', 'buttons', 'combobox'].flatMap((kind) => [true, false].map((hasNA) => ({ kind, hasNA })));
  it.each(cases)('fills $kind fields with hasNA=$hasNA', async ({ kind, hasNA }) => {
    fastTimings();
    const choices = hasNA ? ['Yes', 'No', 'Not applicable'] : ['Yes', 'No'];
    const expected = hasNA ? 'Not applicable' : 'No';
    document.body.innerHTML = questions.map((question, i) => {
      let control: string;
      if (kind === 'select') {
        control = `<select id="q${i}"><option value="">Select One</option>${choices.map((choice) => `<option>${choice}</option>`).join('')}</select>`;
      } else if (kind === 'combobox') {
        control = `<button id="q${i}" aria-haspopup="listbox">Select One</button>`;
      } else if (kind === 'buttons') {
        control = `<div>${choices.map((choice) => `<button aria-pressed="false">${choice}</button>`).join('')}</div>`;
      } else {
        const type = kind === 'radio' ? 'radio' : 'checkbox';
        control = choices.map((choice) => `<label><input type="${type}" name="q${i}" value="${choice}" ${kind === 'checkboxes' && choice === 'Yes' ? 'checked' : ''} />${choice}</label>`).join('');
      }
      return `<fieldset id="group${i}"><legend>${question}*</legend>${control}</fieldset>`;
    }).join('');
    document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]').forEach((button) => {
      button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true'));
    });
    document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup]').forEach((button) => {
      button.addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'listbox');
        choices.forEach((choice) => {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = choice;
          option.addEventListener('click', () => { button.textContent = choice; menu.remove(); });
          menu.append(option);
        });
        document.body.append(menu);
      });
    });
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.settings.overwriteExisting = true;
    const report = await fillPage(ctx, { ats: 'Workday' });
    expect(report.filled).toBe(2);
    expect(report.needsReview).toBe(0);
    questions.forEach((_question, i) => {
      const group = document.getElementById(`group${i}`)!;
      if (kind === 'select') expect(group.querySelector('select')?.value).toBe(expected);
      else if (kind === 'combobox') expect(group.querySelector('button')?.textContent).toBe(expected);
      else if (kind === 'buttons') expect([...group.querySelectorAll('[aria-pressed="true"]')].map((button) => button.textContent)).toEqual([expected]);
      else expect([...group.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value)).toEqual([expected]);
    });
  });

  it('unticks a lone OPT checkbox and writes N/A in an OPT text field', async () => {
    document.body.innerHTML = `<label for="opt">I am currently on OPT</label><input id="opt" type="checkbox" checked />
      <label for="status">OPT status</label><input id="status" />`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.settings.overwriteExisting = true;
    const report = await fillPage(ctx, { ats: 'Workday' });
    expect(document.querySelector<HTMLInputElement>('#opt')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#status')?.value).toBe('N/A');
    expect(report.filled).toBe(2);
  });
});
