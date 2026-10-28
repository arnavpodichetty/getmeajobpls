import { describe, expect, it } from 'vitest';
import { matchKey, resolveAnswer } from '../src/lib/engine/answers';
import { context } from './helpers/fixture';
import { RACE_SUBGROUPS } from '../src/lib/engine/text';

const resolve = (label: string, isChoice = false, edit?: (a: ReturnType<typeof context>['profile']['answers']) => void) => {
  const { profile } = context();
  edit?.(profile.answers);
  return resolveAnswer(label, '', null, { profile, skills: [] }, isChoice);
};

describe('standard answers that replace saved answers', () => {
  it('answers referrer questions with N/A unless a name is set', () => {
    expect(resolve('Who referred you? (name of referrer)').answer?.value).toBe('N/A');
    expect(resolve('Referrer name', false, (a) => { a.referrerName = 'Jane Doe'; }).answer?.value).toBe('Jane Doe');
    expect(matchKey('Were you referred by a current employee?')).toBe('referredByEmployee');
  });

  it('answers publications from the profile', () => {
    const edit = (a: ReturnType<typeof context>['profile']['answers']) => { a.publications = 'Paper A (Journal of Examples, 2026)'; };
    expect(resolve('Publications', false, edit).answer?.value).toBe('Paper A (Journal of Examples, 2026)');
    expect(resolve('Do you have any publications?', true, edit).answer?.value).toBe('Yes');
  });

  it('prefers ownership and data-driven statements on self-assessment dropdowns', () => {
    const r = resolve('Which statement best describes your approach to learning new processes and taking initiative?', true);
    expect(r.matchedKey).toBe('selfAssessment');
    expect(r.answer?.tiers?.[0]).toEqual(['take ownership']);
    expect(matchKey('Which of the following best describes your gender?')).not.toBe('selfAssessment');
  });

  it('leaves "why are you interested" for you, even with a similar saved answer', () => {
    const { profile } = context();
    profile.savedAnswers = [{ id: '1', question: 'Please tell us why you are interested in this role!', answer: 'Old answer' }];
    const r = resolveAnswer('Please tell us a little about why you are interested in this role!', '', null, { profile, skills: [] }, false);
    expect(r.matchedKey).toBe('whyInterested');
    expect(r.answer).toBeNull();
  });

  it('still covers portfolio and expected graduation', () => {
    expect(matchKey('Portfolio or personal website')).toBe('portfolio');
    expect(matchKey('Expected graduation')).toBe('graduationDate');
  });
});

describe('language proficiency', () => {
  it('tries Native, Fluent, then the top of a scale without Fluent', async () => {
    const { bestOptionTiered } = await import('../src/lib/engine/text');
    const { profile } = context();
    const tiers = resolveAnswer('Speaking', '', null, { profile, skills: [] }, true).answer!.tiers!;
    const pick = (options: string[]) => bestOptionTiered(options, (o) => o, tiers)?.option;
    expect(pick(['Beginner', 'Intermediate', 'Fluent', 'Native'])).toBe('Native');
    expect(pick(['Elementary proficiency', 'Full professional proficiency', 'Native or bilingual proficiency'])).toBe('Native or bilingual proficiency');
    expect(pick(['Beginner', 'Intermediate', 'Fluent'])).toBe('Fluent');
    expect(tiers).toEqual([['Native', 'Native speaker'], ['Fluent'], ['Expert'], ['Advanced']]);
    // No Fluent level: the top of the scale.
    expect(pick(['Beginner', 'Intermediate', 'Advanced', 'Expert'])).toBe('Expert');
    expect(pick(['1 - Beginner', '2 - Intermediate', '3 - Advanced'])).toBe('3 - Advanced');
    // Nothing else stands in: Intermediate is never picked.
    expect(pick(['Beginner', 'Intermediate'])).toBeUndefined();
  });
});

describe('employment-relationship disclosures (any company)', () => {
  const cases: [string, string][] = [
    ['Are you currently or formerly employed by a Globex company? If yes, please select the most recent Globex company. If no, select "none."', 'previouslyEmployed'],
    ['Are you currently or previously employed by Initech or any of its subsidiaries?', 'previouslyEmployed'],
    ['Are you currently providing services to any Globex Information Technology entity as an independent contractor or contract labor associate?', 'previouslyEmployed'],
    ['Are you currently working at Wayne Enterprises as a contractor or consultant?', 'previouslyEmployed'],
    ['Do you have any relatives or individuals with whom you have a close personal relationship in the organization to which you would be assigned to include:Employed by a customer of Globex IT to include government, prime, and/or subcontractors AND/ OREmployed through contract labor (3rd party staffing agency firms) This includes, but not limited to: spouse, parent, child, sibling, grandparent, grandchild, in-law, aunt, uncle, niece, nephew, cousin, half and step-relations, and any individual with whom you have a close personal relationship such as dating, domestic partner, roommate, or fiance.', 'relatedToEmployee'],
    ['Do you have relatives who currently work for Vandelay Industries?', 'relatedToEmployee'],
    ['If you accept a position with Globex IT, will you also perform work (paid or unpaid) for any other company or entity? This includes roles such as part-time or full-time employment with another organization, serving on a board of directors, long-term volunteer work, or self-employment. This includes National Guard or Reserves.', 'conflictOfInterest'],
    ['Do you have any outside employment?', 'conflictOfInterest'],
  ];
  it.each(cases)('%s → No', (label, key) => {
    const { profile } = context();
    Object.assign(profile.answers, { previouslyEmployed: 'No', relatedToEmployee: 'No', conflictOfInterest: 'No' });
    const r = resolveAnswer(label, '', null, { profile, skills: [] }, true);
    expect(r.matchedKey).toBe(key);
    expect(r.answer?.value).toBe('No');
  });

  it('chooses "None" from a company list', async () => {
    const { bestOptionTiered } = await import('../src/lib/engine/text');
    const { profile } = context();
    profile.answers.previouslyEmployed = 'No';
    const tiers = resolveAnswer(cases[0][0], '', null, { profile, skills: [] }, true).answer!.tiers!;
    expect(bestOptionTiered(['Globex Marine', 'Globex IT', 'Globex Aerospace', 'None'], (o) => o, tiers)?.option).toBe('None');
    expect(bestOptionTiered(['Yes', 'No'], (o) => o, tiers)?.option).toBe('No');
  });
});

describe('driver license', () => {
  it.each([
    'Depending on the role, driving may be required. Do you hold a full and valid car driving license?*',
    "Do you have a valid driver's license?",
    'Are you a licensed driver?',
  ])('answers "%s" from the setting', (label) => {
    const r = resolve(label, true, (a) => { a.driversLicense = 'Yes'; });
    expect(r.matchedKey).toBe('driversLicense');
    expect(r.answer?.value).toBe('Yes');
  });
});

describe('free-text graduation date', () => {
  const fill = async (label: string, placeholder = '') => {
    const { fillPage } = await import('../src/lib/engine/fill');
    const { resetLayoutCache } = await import('../src/lib/engine/dom');
    document.body.innerHTML = `<label for="g">${label}</label><input id="g" type="text" placeholder="${placeholder}">`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.answers.graduationDate = '2028-06-15';
    await fillPage(ctx, { ats: 'Greenhouse' });
    return document.querySelector('input')!.value;
  };
  it('writes "June 2028" when the question asks for month and year', async () => {
    expect(await fill('When is your prospective Graduation Date? (Month/Year)*')).toBe('June 2028');
    expect(await fill('Expected graduation (month and year)')).toBe('June 2028');
  });
  it('follows numeric formats it is given', async () => {
    expect(await fill('Expected graduation date (MM/YYYY)')).toBe('06/2028');
    expect(await fill('Graduation date', 'MM/DD/YYYY')).toBe('06/15/2028');
  });
});

describe('plain current-employee questions', () => {
  it('answers a plain No without looking for None', () => {
    const r = resolve('Are you currently working for Hooli?', true, (a) => { a.previouslyEmployed = 'No'; });
    expect(r.matchedKey).toBe('previouslyEmployed');
    expect(r.answer?.value).toBe('No');
    expect(r.answer?.tiers).toBeUndefined();
  });
});

describe('current or former employee, any company', () => {
  it.each([
    'Are you currently working for Hooli?', 'Do you currently work for Stark Industries?', 'Are you currently employed by Dunder & Company?',
    'Are you a current employee of Cyberdyne?', 'Have you ever worked for Umbrella Corp?', 'Are you a current or former employee of Tyrell Corporation?',
    'Do you work at Wonka Motor Company?', 'Are you an existing employee of Soylent?', 'Were you ever employed by Oscorp?', 'Are you a former Pied Piper employee?',
  ])('%s → No', (label) => {
    const r = resolve(label, true, (a) => { a.previouslyEmployed = 'No'; });
    expect(r.matchedKey).toBe('previouslyEmployed');
    expect(r.answer?.value).toBe('No');
  });
});

describe('relative / family questions are always No', () => {
  const labels = [
    'Are you an immediate family member of someone holding such a position? An Immediate family member is a parent, sibling, spouse or domestic partner, child, or in-law.',
    'Do you have any relatives currently employed by Acme?',
    'Are you related to any current employee of the company?',
    'Is any member of your family employed by a government entity?',
    'Are you or a family member a public official?',
    'Does your spouse or domestic partner work for us?',
    'Do you have any family members that work at Massive Dynamic?',
    'Are you related to anyone on the board of directors?',
    'Related Employee: Yes/No',
  ];
  it.each(labels)('%s → No', (label) => {
    for (const isChoice of [true, false]) {
      const r = resolve(label, isChoice, (a) => { a.relatedToEmployee = 'Yes'; a.governmentOfficial = 'Yes'; });
      expect(r.matchedKey).toBe('relatedToEmployee');
      expect(r.answer?.value).toBe('No');
    }
  });

  it('leaves unrelated "family" questions alone', () => {
    expect(matchKey('Family name')).toBe('lastName');
    expect(matchKey('Are you a protected veteran or the spouse of a veteran?')).not.toBe('relatedToEmployee');
  });

  it('answers "if so, name them" follow-ups with N/A', () => {
    expect(resolve('If yes, please list the name and relationship of your relative.').answer?.value).toBe('N/A');
  });
});

describe('"were you referred? if so, name them" text boxes', () => {
  const label = 'Were you referred to this role by a current Initech employee? If so, please provide their name.';
  it('answers N/A without a referrer', () => {
    expect(resolve(label).answer?.value).toBe('N/A');
  });
  it('uses the referrer name when set', () => {
    expect(resolve(label, false, (a) => { a.referrerName = 'Jane Doe'; }).answer?.value).toBe('Jane Doe');
  });
});

describe('specific race options', () => {
  const pickRace = async (options: string[], race: string) => {
    const { bestOptionTiered } = await import('../src/lib/engine/text');
    const { profile } = context();
    profile.eeo.raceEthnicity = race;
    const res = resolveAnswer('Please select your race', '', null, { profile, skills: [] }, true);
    expect(res.matchedKey).toBe('raceEthnicity');
    return bestOptionTiered(options, (o) => o, res.answer!.tiers!)?.option;
  };
  const subgroups = Object.keys(RACE_SUBGROUPS).map((key) => key.replace(/\b\w/g, (c) => c.toUpperCase()));
  const otherSubgroups = (race: string) => subgroups.filter((s) => RACE_SUBGROUPS[s.toLowerCase()].match.source !== RACE_SUBGROUPS[race.toLowerCase()].match.source);

  it.each(subgroups)('picks %s when listed, never a neighboring subgroup', async (race) => {
    expect(await pickRace([...otherSubgroups(race), race, 'White'], race)).toBe(race);
  });

  it.each(subgroups)('falls back from %s to its category, never another subgroup or American Indian', async (race) => {
    expect(await pickRace(['American Indian or Alaska Native', 'Asian (Not Hispanic or Latino)', 'White'], race)).toBe('Asian (Not Hispanic or Latino)');
    expect(await pickRace([...otherSubgroups(race), 'Asian', 'Black'], race)).toBe('Asian');
  });

  it('keeps East Asian and a spaced "South East Asian" apart', async () => {
    expect(await pickRace(['South East Asian', 'East Asian'], 'East Asian')).toBe('East Asian');
    expect(await pickRace(['South East Asian', 'Asian'], 'East Asian')).toBe('Asian');
  });

  it('accepts another spelling of the same subgroup', async () => {
    const [race, alias] = Object.entries(RACE_SUBGROUPS).flatMap(([key, s]) => s.aliases.map((a) => [key, a]))[0];
    expect(await pickRace([alias, 'White'], race)).toBe(alias);
  });
});

describe('AI review consent', () => {
  const label = 'We may use automated tools such as AI to support review of your application. If you prefer not to have your application processed by these tools, you can opt-out.';
  it('follows the setting (Yes by default)', () => {
    expect(resolve(label, true).answer?.value).toBe('Yes');
    expect(resolve(label, true, (a) => { a.aiReviewConsent = 'No'; }).answer?.value).toBe('No');
  });
  it('leaves AI skill questions alone', () => {
    expect(resolve('Describe your experience with AI tools such as LLMs.', false).matchedKey).not.toBe('aiReviewConsent');
  });
});
