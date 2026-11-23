// Workday's required-field gate: "Save and Continue" is blocked while a * field is blank.
import { afterEach, describe, expect, it } from 'vitest';
import { emptyRequiredFields, installWorkdayGate } from '../src/lib/workdayGate';
import { loadFixture } from './helpers/fixture';

const field = (id: string, label: string, control: string) =>
  `<div data-automation-id="formField-${id}"><fieldset><legend><div><p>${label}</p></div></legend><div>${control}</div></fieldset></div>`;
const listbox = (text: string) => `<button aria-haspopup="listbox" type="button" aria-label=" ${text} Required">${text}</button><input type="text">`;
const STAR = '<abbr title="required" class="requiredAsterisk">*</abbr>';

function page(fields: string): void {
  document.body.innerHTML = `<div data-automation-id="applyFlowSecondaryQuestionsPage">${fields}</div>
    <button data-automation-id="pageFooterNextButton">Save and Continue</button>`;
}

describe('emptyRequiredFields', () => {
  it('finds blank required dropdowns and text boxes, ignoring optional and filled ones', () => {
    page([
      field('a', `Graduation Year${STAR}`, listbox('2028 Spring')),
      field('b', `Are you currently enrolled in school?${STAR}`, listbox('Select One')),
      field('c', `Link to your portfolio${STAR}`, '<textarea aria-required="true"></textarea>'),
      field('d', 'Anything else?', '<textarea></textarea>'),
      field('e', 'Pronouns*', '<input type="text" value="they/them">'),
    ].join(''));
    expect(emptyRequiredFields().map((m) => m.label)).toEqual(['Are you currently enrolled in school?', 'Link to your portfolio']);
  });

  it('checks radio groups and checkboxes', () => {
    page([
      field('r', `Are you 18 or older?${STAR}`, '<input type="radio" name="r"><input type="radio" name="r">'),
      field('t', `I agree to the terms${STAR}`, '<input type="checkbox" checked>'),
    ].join(''));
    expect(emptyRequiredFields().map((m) => m.label)).toEqual(['Are you 18 or older?']);
  });

  it('reads a captured questionnaire step', () => {
    loadFixture('workday-c');
    const missing = emptyRequiredFields();
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((m) => m.label.length > 0)).toBe(true);
  });
});

describe('installWorkdayGate', () => {
  let remove = () => {};
  afterEach(() => remove());

  it('blocks Save and Continue until required fields are filled, and only when enabled', () => {
    page(field('c', `Link to your portfolio${STAR}`, '<textarea aria-required="true"></textarea>'));
    let enabled = true;
    const blocked: string[][] = [];
    let advanced = 0;
    remove = installWorkdayGate({ enabled: () => enabled, onBlocked: (m) => blocked.push(m.map((x) => x.label)) });
    const next = document.querySelector<HTMLButtonElement>('[data-automation-id="pageFooterNextButton"]')!;
    next.addEventListener('click', () => advanced++);

    next.click();
    expect(advanced).toBe(0);
    expect(blocked).toEqual([['Link to your portfolio']]);

    document.querySelector('textarea')!.value = 'NA';
    next.click();
    expect(advanced).toBe(1);

    document.querySelector('textarea')!.value = '';
    enabled = false;
    next.click();
    expect(advanced).toBe(2);
  });
});
