// Workday application questions from a Workday capture (tests/fixtures/workday-c.html):
// government / DoD employment, education level, clearance, consent and citizenship
// questions, plus the option wording those dropdowns use.
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { scanFields } from '../src/lib/engine/scan';
import { optionScore, bestOption } from '../src/lib/engine/text';
import { setTimeZone, todayISO } from '../src/lib/clock';
import { context, loadFixture } from './helpers/fixture';

const answer = (label: string, edit?: (p: ReturnType<typeof context>['profile']) => void) => {
  const { profile } = context();
  edit?.(profile);
  return resolveAnswer(label, '', null, { profile, skills: [] }, true);
};
const pick = (options: string[], wanted: string) => bestOption(options, (o) => o, wanted)?.option;

describe('Workday application questions (capture C)', () => {
  it('answers every question on the captured page', () => {
    loadFixture('workday-c');
    const { profile } = context();
    const got = scanFields(document).filter((f) => f.label).map((f) => {
      const r = resolveAnswer(f.label, f.hints, null, { profile, skills: [] }, true);
      return [r.matchedKey, r.answer?.value];
    });
    expect(got).toEqual([
      ['governmentOfficial', 'No'],
      ['governmentOfficial', 'No'],
      ['workAuthorized', 'Yes'],
      ['highestCompletedEducation', 'High School Diploma'],
      ['currentStudent', 'Yes'],
      ['securityClearance', 'No'],
      ['governmentOfficial', 'No'],
      ['relatedToEmployee', 'No'],
      ['willingToRelocate', 'Yes'],
      ['emailContactConsent', 'Yes'],
      ['phoneTextConsent', 'No'],
      ['militarySpouse', 'No'],
    ]);
  });

  it('takes "I have never been employed by the U.S. government" as No', () => {
    const options = ['I have never been employed by the U.S. government or the U.S. Armed Forces.', 'I am a current or former U.S. government employee.'];
    expect(pick(options, 'No')).toBe(options[0]);
    expect(pick(['Yes, I hold an active clearance', 'No, I do not hold an active U.S. Government Security Clearance.'], 'No')).toMatch(/^No, I do not/);
  });

  it('answers degree-in-progress questions by your degree level', () => {
    expect(answer('Are you currently working towards a Bachelors or Master’s Degree?').answer?.value).toBe('Yes');
    expect(answer("Are you currently pursuing a Master's or PhD degree?").answer?.value).toBe('No');
    expect(answer('Are you currently working towards a degree?', (p) => { p.education[0].end = '2020-05'; }).answer?.value).toBe('No');
  });

  it('answers citizenship-required questions Yes/No', () => {
    const r = answer('This specific position requires U.S. citizenship status, do you meet this qualification?');
    expect([r.matchedKey, r.answer?.value]).toEqual(['usCitizenshipRequired', 'Yes']);
    expect(answer('This position requires U.S. citizenship. Are you a U.S. citizen?', (p) => { p.answers.citizenship = 'Canada'; }).answer?.value).toBe('No');
    expect(pick(['Yes', 'No'], 'Yes')).toBe('Yes');
  });

  it('answers combined authorization-without-sponsorship questions Yes', () => {
    const label = 'Are you authorized (or eligible) to work lawfully in the country where this position is based, without requiring sponsorship or other immigration-related legal support from your employer, now and in the future?';
    expect(answer(label).answer?.value).toBe('Yes');
    expect(answer(label, (p) => { p.answers.needsSponsorship = 'Yes'; }).answer?.value).toBe('No');
    expect(answer('Will you now or in the future require sponsorship for employment visa status?').answer?.value).toBe('No');
  });

  it('answers "Have you worked with us before?"', () => {
    const r = answer('Have you worked with us before?');
    expect([r.matchedKey, r.answer?.value]).toEqual(['previouslyEmployed', 'No']);
  });
});

describe('veteran status options', () => {
  const options = [
    'I am a protected veteran, as I identify as one or more of the listed classifications above of protected veterans',
    'I am a veteran, but not a protected veteran, based on the listed classifications.',
    'I am not a veteran.',
    'I do not wish to provide this information.',
  ];
  it('never picks a veteran option for "I am not a protected veteran"', () => {
    expect(pick(options, 'I am not a protected veteran')).toBe('I am not a veteran.');
    expect(optionScore(options[1], 'I am not a protected veteran')).toBe(0);
  });
  it('still matches the standard three-option list and the veteran-but-not-protected choice', () => {
    const standard = ['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', 'I prefer not to answer'];
    expect(pick(standard, 'I am not a protected veteran')).toBe('I am not a protected veteran');
    expect(pick(options, 'I am a veteran, but not a protected veteran')).toBe(options[1]);
    expect(pick(options, 'I identify as one or more of the classifications of protected veteran')).toBe(options[0]);
  });
});

describe('careers site referral sources', () => {
  it.each(['Career Site', 'Careers Website', 'Initech Careers Site', 'Corporate website', 'Company website', 'Initech.com', 'Initech Website', 'Careers'])('treats %s as the careers website', (option) => {
    expect(optionScore(option, 'Company careers website')).toBe(1);
  });
  it.each(['Agency', 'Recruiter', 'Referred by Employee', 'LinkedIn', 'Indeed Website', 'Career Fair', 'Initech website, article, podcast or other Initech content'])('does not treat %s as the careers website', (option) => {
    expect(optionScore(option, 'Company careers website')).toBe(0);
  });
  it('tries LinkedIn first, then the careers site', () => {
    const r = answer('How Did You Hear About Us?');
    expect(r.answer?.tiers).toEqual([['LinkedIn'], ['Company careers website']]);
  });
});

describe("today's date", () => {
  it('uses Pacific time, not UTC', () => {
    const lateEvening = new Date('2026-10-16T05:30:00Z'); // 10:30pm Oct 15 in Los Angeles
    setTimeZone(undefined);
    expect(todayISO(lateEvening)).toBe('2026-10-15');
    setTimeZone('America/New_York');
    expect(todayISO(lateEvening)).toBe('2026-10-16');
    setTimeZone(undefined);
  });
});

describe('numbered questions', () => {
  it('reads "6. Do you…" like "Do you…"', () => {
    expect(answer('6. Do you hold an active U.S. Government Security Clearance?').answer?.value).toBe('No');
    expect(answer('3. Do you have any publications?').answer?.value).toBe('No');
  });
});
