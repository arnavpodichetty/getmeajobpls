import { describe, expect, it } from 'vitest';
import { bestAvailabilityOption, startDateForPosting } from '../src/lib/engine/availability';
import { context } from './helpers/fixture';

describe('start-date availability', () => {
  const now = new Date('2026-10-15T12:00:00');
  const options = ['Immediately', 'At the end of the Fall 2024 semester', 'At the end of the Spring 2025 semester', 'Within the next 3 months from my application date', 'Within the next 6 months from my application date'];
  it('chooses six months as the nearest offered window to June 7', () => {
    expect(bestAvailabilityOption(options, (s) => s, '2027-06-07', now)?.option).toBe(options[4]);
  });
  it('chooses a different window for a winter start', () => {
    expect(bestAvailabilityOption(options, (s) => s, '2027-01-01', now)?.option).toBe(options[3]);
  });
  it('prefers an exact offered date and never selects a past semester', () => {
    expect(bestAvailabilityOption([...options, 'June 7, 2027'], (s) => s, '2027-06-07', now)?.option).toBe('June 7, 2027');
    expect(bestAvailabilityOption(options.slice(1, 3), (s) => s, '2027-06-07', now)).toBeNull();
  });
  it('uses posting seasons, advertised dates and configurable overrides', () => {
    const { profile } = context();
    profile.answers.earliestStartDate = '2027-06-07';
    expect(startDateForPosting(profile, 'Operations Intern')).toBe('2027-06-07');
    expect(startDateForPosting(profile, 'Summer 2027 Internship')).toBe('2027-06-07');
    expect(startDateForPosting(profile, 'Winter 2027 Internship')).toBe('2027-01-01');
    expect(startDateForPosting(profile, 'Winter 2027 Internship', 'The program starts January 12, 2027.')).toBe('2027-01-12');
    profile.answers.winterStartDate = '2027-01-25';
    expect(startDateForPosting(profile, 'Winter 2027 Internship', 'The program starts January 12, 2027.')).toBe('2027-01-25');
    expect(startDateForPosting(profile, 'Fall 2027 Internship')).toBe('2027-09-01');
  });
});
