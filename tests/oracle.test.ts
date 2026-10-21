// Oracle Recruiting (Candidate Experience) renders dropdowns as cx-select:
// an <input role="combobox" aria-haspopup="grid"> whose popup lists each
// choice as a [role="gridcell"][aria-selected], and yes/no questions as
// role="radio" pill buttons. These stand-ins mimic that markup and behaviour.
import { beforeEach, describe, expect, it } from 'vitest';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cxSelect(id: string, label: string, options: string[], opts: { required?: boolean; ignoreClicks?: boolean } = {}): string {
  return `<div class="input-row input-row--has-picker">
    <label class="input-row__label" for="${id}"><span class="input-row__label-text">${label}${opts.required ? ' <span aria-hidden="true">*</span>' : ''}</span></label>
    <div class="input-row__control-container"><div class="cx-select-container">
      <input id="${id}" name="${id}" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-controls="${id}-listbox" aria-expanded="false"
        ${opts.required ? 'aria-required="true"' : ''} data-options="${options.join('|')}" ${opts.ignoreClicks ? 'data-ignore="1"' : ''} class="cx-select-input">
    </div></div></div>`;
}

/** Opens a grid of matching options under the input; a click on a cell writes it into the input. */
function wireCxSelects(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[aria-haspopup="grid"]')) {
    const all = input.dataset.options!.split('|');
    const render = () => {
      document.getElementById(`${input.id}-listbox`)?.remove();
      const query = input.value.toLowerCase();
      const grid = document.createElement('div');
      grid.id = `${input.id}-listbox`;
      grid.className = 'cx-select__list';
      grid.setAttribute('role', 'grid');
      all.filter((o) => o.toLowerCase().includes(query)).forEach((o, i) => {
        const row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.innerHTML = `<div tabindex="-1" role="gridcell" id="${input.id}-listitem-${i}" aria-selected="false" class="cx-select__list-item"><div class="cx-select__list-item-container">${o}</div></div>`;
        row.firstElementChild!.addEventListener('click', () => {
          if (!input.dataset.ignore) input.value = o;
          grid.remove();
        });
        grid.append(row);
      });
      input.parentElement!.append(grid);
    };
    input.addEventListener('click', render);
    input.addEventListener('input', render);
  }
}

function pills(label: string, options: string[], required = false): string {
  return `<div class="input-row input-row--has-picker">
    <label class="input-row__label"><span class="input-row__linebreak">${label}</span>${required ? '<span class="input-row__label--required-star" aria-hidden="true"></span>' : ''}</label>
    <div class="input-row__control-container"><div><ul role="radiogroup" aria-label="${label}" class="cx-select-pills-container">
      ${options.map((o) => `<li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> ${o}</span></button></li>`).join('')}
    </ul></div></div></div>`;
}

function wirePills(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.cx-select-pill-section')) {
    button.addEventListener('click', () => {
      button.closest('ul')!.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
    });
  }
}

const chosen = (label: string) => [...document.querySelectorAll('[role="radiogroup"]')]
  .find((g) => g.getAttribute('aria-label') === label)
  ?.querySelector('[aria-checked="true"]')?.textContent?.trim() ?? null;

describe('Oracle Recruiting', () => {
  it('fills cx-select dropdowns and pill questions', async () => {
    document.body.innerHTML = `<form>
      ${pills('Title', ['Doctor', 'Miss', 'Mr.', 'Mrs.', 'Ms.'])}
      ${cxSelect('country-20', 'Country', ['Canada', 'United Kingdom', 'United States'], { required: true })}
      ${cxSelect('city-69', 'City', ['Los Alamos, Los Alamos, NM', 'Los Angeles, Los Angeles, CA', 'Seattle, King, WA'], { required: true })}
      ${cxSelect('region2-72', 'State', ['Arizona', 'California', 'Washington'], { required: true })}
      ${cxSelect('postalCode-73', 'Postal Code', ['90024', '90025', '98101'], { required: true })}
      ${pills('Are you at least 18 years of age?', ['Yes', 'No'], true)}
      ${pills('Will you now or in the future require sponsorship for an employment-based visa status?', ['Yes', 'No'], true)}
      ${cxSelect('grad-month', 'Please select your expected graduation month of your current studies, or if you have already graduated select the month you graduated from your most recent studies.', MONTHS)}
      ${cxSelect('grad-year', 'Please select your expected graduation year of your current studies, or if you have already graduated select the year you graduated from your most recent studies.', ['2026', '2027', '2028', '2029'])}
      ${pills('What is the type of degree program are you currently enrolled in?', ['High School Diploma', 'Associate Degree', 'Bachelor’s Degree', 'Master’s Degree (non-MBA)', 'Doctorate (PhD, EdD, etc.)', 'None'], true)}
    </form>`;
    wireCxSelects();
    wirePills();
    resetLayoutCache();

    const report = await fillPage(context({ resume: null }), { ats: 'Oracle Recruiting' });
    const value = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value;
    expect(value('country-20')).toBe('United States');
    expect(value('city-69')).toBe('Los Angeles, Los Angeles, CA');
    expect(value('region2-72')).toBe('California');
    expect(value('postalCode-73')).toBe('90024');
    expect(value('grad-month')).toBe('June');
    expect(value('grad-year')).toBe('2028');
    expect(chosen('Are you at least 18 years of age?')).toBe('Yes');
    expect(chosen('Will you now or in the future require sponsorship for an employment-based visa status?')).toBe('No');
    expect(chosen('What is the type of degree program are you currently enrolled in?')).toBe('Bachelor’s Degree');
    // "Title" here is an honorific, not your job title: leave it alone.
    expect(chosen('Title')).toBeNull();
    expect(report.fields.find((f) => f.label === 'Title')).toBeUndefined();
    expect(report.needsReview).toBe(0);
  });

  it('flags a dropdown that ignores the click instead of marking it filled', async () => {
    document.body.innerHTML = cxSelect('country-20', 'Country', ['Canada', 'United States'], { required: true, ignoreClicks: true });
    wireCxSelects();
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Oracle Recruiting' });
    expect(report.fields).toEqual([expect.objectContaining({ label: 'Country', status: 'review' })]);
  });
});
