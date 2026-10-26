import { describe, expect, it } from 'vitest';
import { monthDayField } from '../src/entrypoints/options/fields';

function setup(value: string) {
  const job = { start: value };
  const el = monthDayField('Start', job, 'start', () => {});
  document.body.replaceChildren(el);
  const month = el.querySelector<HTMLInputElement>('input[type=month]')!;
  const day = el.querySelector<HTMLSelectElement>('select')!;
  return { job, month, day };
}

describe('work experience month + optional day', () => {
  it('shows a saved month, with no day', () => {
    const { month, day } = setup('2026-09');
    expect(month.value).toBe('2026-09');
    expect(day.value).toBe('');
  });

  it('shows a saved exact date', () => {
    const { month, day } = setup('2026-09-15');
    expect(month.value).toBe('2026-09');
    expect(day.value).toBe('15');
  });

  it('saves the day when picked, and only the month without one', () => {
    const { job, month, day } = setup('2026-09');
    day.value = '07';
    day.dispatchEvent(new Event('change'));
    expect(job.start).toBe('2026-09-07');
    day.value = '';
    day.dispatchEvent(new Event('change'));
    expect(job.start).toBe('2026-09');
    month.value = '';
    month.dispatchEvent(new Event('input'));
    expect(job.start).toBe('');
  });

  it('keeps the day inside the month (Feb 31 → Feb 28)', () => {
    const { job, month, day } = setup('2027-01-31');
    month.value = '2027-02';
    month.dispatchEvent(new Event('input'));
    expect(job.start).toBe('2027-02-28');
    expect(day.value).toBe('28');
  });
});
