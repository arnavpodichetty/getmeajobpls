// Capture E: Greenhouse's Employment blocks (company, title, month/year dates, "Current role").
import { beforeEach, describe, expect, it } from 'vitest';
import { greenhouse } from '../src/adapters/greenhouse';
import { grewPast } from '../src/lib/engine/fill';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => { fastTimings(); loadFixture('greenhouse-e'); });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** react-select month pickers that open a month list and show the pick. */
function simulateMonthMenus() {
  for (const input of document.querySelectorAll<HTMLInputElement>('.employment--container input[role="combobox"]')) {
    input.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      for (const text of MONTHS) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        option.addEventListener('click', () => {
          const control = input.closest('[class*="control"]')!;
          control.querySelector('.select__single-value')?.remove();
          const shown = document.createElement('div');
          shown.className = 'select__single-value';
          shown.textContent = text;
          control.append(shown);
          menu.remove();
        });
        menu.append(option);
      }
      document.body.append(menu);
    });
  }
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const month = (id: string) => document.getElementById(id)!.closest('[class*="control"]')!.querySelector('.select__single-value')?.textContent ?? '';

describe('Greenhouse employment blocks (capture E)', () => {
  it('puts each job in its own block with its own dates', async () => {
    simulateMonthMenus();
    const ctx = context();
    ctx.profile.experience = [
      { id: 'x1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: '', start: '2026-09', end: '', current: true, description: '' },
      { id: 'x2', company: 'Difference Works', title: 'Research Assistant', type: 'Part-time', location: '', start: '2025-01', end: '2025-08', current: false, description: '' },
    ];
    const report = await greenhouse.fill(ctx);

    expect(val('company-name-0')).toBe('Analytical Engines');
    expect(val('title-0')).toBe('Software Engineering Intern');
    expect(month('start-date-month-0')).toBe('September');
    expect(val('start-date-year-0')).toBe('2026');
    // Current job: no end date, "Current role" ticked.
    expect(month('end-date-month-0')).toBe('');
    expect(val('end-date-year-0')).toBe('');
    expect((document.getElementById('current-role-0_1') as HTMLInputElement).checked).toBe(true);

    expect(val('company-name-1')).toBe('Difference Works');
    expect(val('title-1')).toBe('Research Assistant');
    expect(month('start-date-month-1')).toBe('January');
    expect(val('start-date-year-1')).toBe('2025');
    expect(month('end-date-month-1')).toBe('August');
    expect(val('end-date-year-1')).toBe('2025');
    expect((document.getElementById('current-role-1_1') as HTMLInputElement).checked).toBe(false);

    const employment = report.fields.filter((f) => /company name|title|date (?:month|year)|current role/i.test(f.label));
    expect(employment.filter((f) => f.status === 'review')).toEqual([]);
  });

  it('leaves a block alone when the profile has fewer jobs', async () => {
    simulateMonthMenus();
    const ctx = context(); // one job
    await greenhouse.fill(ctx);
    expect(val('company-name-0')).toBe('Analytical Engines');
    expect(val('company-name-1')).toBe('');
    expect(val('start-date-year-1')).toBe('');
  });

  it('never types into the emailed verification code boxes', async () => {
    const report = await greenhouse.fill(context());
    expect(scanFields().filter((f) => f.el.id.startsWith('security-input-')).every((f) => !(f.el as HTMLInputElement).value)).toBe(true);
    expect(report.fields.some((f) => /security code/i.test(f.label))).toBe(false);
  });
});

describe('a box that shows more than was typed', () => {
  it('is caught', () => {
    expect(grewPast('Software Engineering Intern', 'Software Engineering Interna')).toBe(true);
    expect(grewPast('Software Engineering Intern', 'Software Engineering Intern')).toBe(false);
    expect(grewPast('4155550100', '(415) 555-0100')).toBe(false);
  });
});
