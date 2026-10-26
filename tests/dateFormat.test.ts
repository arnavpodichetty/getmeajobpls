import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/lib/engine/controls';

const input = (placeholder = '') => {
  const el = document.createElement('input');
  if (placeholder) el.placeholder = placeholder;
  return el;
};

describe('date formats', () => {
  it.each([
    ['Please enter your expected month and year of your graduation. The formatting must be entered as "MM/YYYY" format for example, 10/2023.', '', '05/2028'],
    ['Expected graduation (month and year)', '', 'May 2028'],
    ['Graduation date (Month/Year)', '', 'May 2028'],
    ['Graduation date', 'MM/YYYY', '05/2028'],
    ['Graduation date', 'YYYY-MM', '2028-05'],
    ['Graduation date', '', '05/2028'],
  ])('%s [%s] → %s', (label, placeholder, expected) => {
    expect(formatDate('2028-05', input(placeholder), label)).toBe(expected);
  });
});

describe('job dates with an exact day', () => {
  it('uses the day where the form asks for it, and only month and year elsewhere', () => {
    const date = document.createElement('input');
    date.type = 'date';
    expect(formatDate('2026-09-15', date)).toBe('2026-09-15');
    expect(formatDate('2026-09-15', input('MM/DD/YYYY'), 'Start date')).toBe('09/15/2026');
    expect(formatDate('2026-09-15', input('MM/YYYY'), 'Start date')).toBe('09/2026');
    expect(formatDate('2026-09-15', input(), 'Start date (month and year)')).toBe('September 2026');
    const month = document.createElement('input');
    month.type = 'month';
    expect(formatDate('2026-09-15', month)).toBe('2026-09');
  });
});
