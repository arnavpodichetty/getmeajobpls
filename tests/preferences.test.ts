import { describe, expect, it } from 'vitest';
import { emptyProfile, normalizeProfile } from '../src/lib/defaults';
import { majorTiers, resolveAnswer } from '../src/lib/engine/answers';
import { bestOptionTiered } from '../src/lib/engine/text';
import { testProfile } from './helpers/fixture';
import type { Profile } from '../src/lib/types';

const questions = {
  travelPercentage: 'Are you willing to travel?',
  phoneTextConsent: 'I consent to receive telephone calls and text messages',
  governmentDebarment: 'Have you ever been debarred from government contracting?',
  governmentConsulting: 'Have you been retained by the U.S. Government as a consultant?',
  optStatus: 'Are you currently on OPT?',
  stemOptEligible: 'Do you hold a degree that would allow you to apply for a 24-month OPT extension?',
} as const;

const answer = (profile: Profile, question: string) => resolveAnswer(question, '', null, { profile, skills: [] }, true).answer;

describe('editable application preferences', () => {
  it('defaults current offers to No while preserving an explicitly saved answer', () => {
    expect(emptyProfile().answers.currentOffers).toBe('No');
    expect(normalizeProfile({ answers: {} }).answers.currentOffers).toBe('No');
    expect(normalizeProfile({ answers: { currentOffers: 'Yes' } }).answers.currentOffers).toBe('Yes');
    expect(normalizeProfile({ answers: { currentOffers: '' } }).answers.currentOffers).toBe('');
  });
  it('starts new and older profiles with the standard answers, but no personal pay or dates', () => {
    const defaults = { travelPercentage: '25-50%', phoneTextConsent: 'No', governmentDebarment: 'No', governmentConsulting: 'No', optStatus: 'N/A', stemOptEligible: 'N/A' };
    for (const profile of [emptyProfile(), normalizeProfile({ personal: { firstName: 'Someone' }, answers: { workAuthorized: 'Yes' } })]) {
      Object.entries(questions).forEach(([key, question]) => {
        const value = defaults[key as keyof typeof questions];
        expect(profile.answers[key as keyof typeof questions]).toBe(value);
        expect(answer(profile, question)?.value).toBe(value);
      });
      for (const key of ['hourlyRate', 'earliestStartDate', 'winterStartDate', 'springStartDate', 'fallStartDate', 'graduationDate', 'highSchoolGraduationYear', 'academicYear', 'publications'] as const) {
        expect(profile.answers[key]).toBe('');
      }
      expect(profile.personal.firstName === 'Someone' || profile.personal.firstName === '').toBe(true);
    }
  });

  it('uses independently configured answers and preserves them through normalization', () => {
    const profile = testProfile();
    Object.assign(profile.answers, {
      travelPercentage: '50-75%', phoneTextConsent: 'Yes', governmentDebarment: 'Yes',
      governmentConsulting: 'Yes', optStatus: 'Yes', stemOptEligible: 'No',
    });
    const restored = normalizeProfile(JSON.parse(JSON.stringify(profile)));
    Object.entries(questions).forEach(([key, question]) => {
      expect(answer(restored, question)?.value).toBe(profile.answers[key as keyof typeof questions]);
    });
    expect(answer(restored, 'Are you currently on STEM OPT?')?.value).toBe('Yes');
    expect(answer(restored, 'Are you eligible for an OPT extension?')?.value).toBe('No');
    expect(bestOptionTiered(['Yes', 'No', 'N/A'], (option) => option, answer(restored, questions.optStatus)!.tiers!)?.option).toBe('Yes');
  });

  it('compares residency against the configured state, including abbreviations', () => {
    const profile = testProfile();
    profile.personal.state = 'Maryland';
    expect(answer(profile, 'Are you a resident of MD?')?.value).toBe('Yes');
    expect(answer(profile, 'Are you a resident of California?')?.value).toBe('No');
    profile.personal.state = 'MD';
    expect(answer(profile, 'Are you a resident of the state of Maryland?')?.value).toBe('Yes');
    profile.personal.state = '';
    expect(answer(profile, 'Are you a resident of Maryland?')).toBeNull();
  });

  it('uses the full-name override for name and signature fields', () => {
    const profile = testProfile();
    profile.personal.fullName = 'Ada Katherine Lovelace';
    expect(answer(profile, 'Name')?.value).toBe('Ada Katherine Lovelace');
    expect(answer(profile, 'By typing your name below, I certify my answers are accurate')?.value).toBe('Ada Katherine Lovelace');
    expect(answer(profile, 'First Name')?.value).toBe('Ada');
    profile.personal.fullName = '';
    expect(answer(profile, 'Name')?.value).toBe('Ada Lovelace');
  });

  it('does not insert a major fallback that the profile did not configure', () => {
    const profile = testProfile();
    profile.education[0].majorFallbacks = ['Statistics', 'Software Engineering'];
    const tiers = majorTiers(profile);
    expect(tiers).toEqual([['Computer Science'], ['Statistics'], ['Software Engineering']]);
    expect(bestOptionTiered(['Software and Systems Engineering', 'Statistics'], (option) => option, tiers)?.option).toBe('Statistics');
    profile.education[0].majorFallbacks = [];
    expect(bestOptionTiered(['Software Engineering'], (option) => option, majorTiers(profile))).toBeNull();
  });
});
