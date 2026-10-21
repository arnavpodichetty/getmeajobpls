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
