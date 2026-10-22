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

  it('answers a bank application questionnaire', () => {
    const cases: [string, string, string | null][] = [
      ['Minimum Pay Desired*', 'salaryExpectation', '$40/hr'],
      ['Are you subject to any restrictions in the scope of your contemplated employment activities as a result of your current or prior employment, such as agreements to protect confidential or proprietary information, or agreements not to compete or not to solicit former customers or employees?*', 'nonCompete', 'No'],
      ['Select yes if you: (1) are under investigation by your current employer for alleged violation of (a) any company policies, or (b) any laws, rules or regulations applicable to the financial services industry, (2) have previously resigned your employment while under such investigation, or (3) have ever been involuntarily discharged from any former employment.*', 'disciplinaryHistory', 'No'],
      ['APPLICATION ACKNOWLEDGEMENT: I certify that the answers given are true. FOR RHODE ISLAND APPLICANTS: IF YOU PROVIDE FALSE INFORMATION ABOUT YOUR ABILITY TO PERFORM THE ESSENTIAL FUNCTIONS OF THE JOB, YOU MAY BE BARRED FROM FILING A CLAIM. By selecting "I acknowledge" from the drop-down field below, you are acknowledging, certifying, agreeing, and authorizing as described above.*', 'agreeToTerms', 'Yes'],
      ['Are you a California resident?*', 'stateResidency', 'Yes'],
      ['Are you a Texas resident?*', 'stateResidency', 'No'],
      ['If you are not selected for this position, Example Bank may wish to consider your application for additional opportunities. You may elect to opt out of this search by selecting "Opt Out" below.', 'otherRolesConsent', 'Yes'],
    ];
    for (const [label, key, value] of cases) {
      const r = answer(label, (p) => { p.answers.hourlyRate = '40'; p.personal.state = 'California'; });
      expect([label.slice(0, 40), r.matchedKey, r.answer?.value ?? null]).toEqual([label.slice(0, 40), key, value]);
    }
    // Percentage options get your percentage; a Yes/No dropdown falls back to Yes (No for none).
    expect(answer('Are you willing to travel?*').answer?.tiers).toEqual([['25-50%'], ['Yes']]);
    expect(answer('Are you willing to travel?', (p) => { p.answers.travelPercentage = '0%'; }).answer?.tiers).toEqual([['0%'], ['No']]);
    expect(pick(['Opt In', 'Opt Out'], 'Opt in')).toBe('Opt In');
  });

  it('answers the essential-functions question Yes', () => {
    const r = answer('To your knowledge, are you capable of performing the essential functions of the job for which you are applying, with or without reasonable accommodations?*');
    expect([r.matchedKey, r.answer?.value]).toEqual(['essentialFunctions', 'Yes']);
    expect(pick(['Yes', 'No'], 'Yes')).toBe('Yes');
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
