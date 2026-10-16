// The label matcher: which profile field a question maps to.
import { describe, expect, it } from 'vitest';
import { majorTiers, matchKey, resolveAnswer, savedAnswerFor } from '../src/lib/engine/answers';
import { bestOptionTiered, cleanLabel, DECLINE, degreeVariants, optionScore, questionSimilarity, schoolVariants } from '../src/lib/engine/text';
import { testProfile } from './helpers/fixture';

describe('matchKey', () => {
  const cases: [string, string | null][] = [
    ['First Name *', 'firstName'],
    ['Given name', 'firstName'],
    ['Surname', 'lastName'],
    ['Family name', 'lastName'],
    ['Preferred First Name', 'preferredName'],
    ['Full name✱', 'fullName'],
    ['Legal Name', 'fullName'],
    ['Name', 'fullName'],
    ['E-mail address', 'email'],
    ['Mobile phone', 'phone'],
    ['Country code', 'phoneCountryCode'],
    ['Location (City)', 'city'],
    ['ZIP / Postal Code', 'zip'],
    ['State / Province', 'state'],
    ['LinkedIn Profile', 'linkedin'],
    ['GitHub URL', 'github'],
    ['Personal website', 'website'],
    ['Current company', 'currentCompany'],
    ['School', 'school'],
    ['Field of study', 'major'],
    ['Cumulative GPA', 'gpa'],
    ['Expected graduation date', 'graduationDate'],
    ['Start date month', 'eduStartMonth'],
    ['Are you legally authorized to work in the United States?', 'workAuthorized'],
    ['Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?', 'needsSponsorship'],
    ['Are you willing to relocate?', 'willingToRelocate'],
    ['Are you at least 18 years of age?', 'over18'],
    ['Have you ever been previously employed by Acme?', 'previouslyEmployed'],
    ['Are you currently located in the US?', 'locatedInUS'],
    ['Are you Hispanic/Latino?', 'hispanicLatino'],
    ['Race and Ethnicity', 'raceEthnicity'],
    ['Gender identity', 'gender'],
    ['Veteran Status', 'veteranStatus'],
    ['Disability Status', 'disability'],
    ['I consider myself a member of the LGBTQ+ community.', 'sexualOrientation'],
    ['How did you hear about this job?', 'referralSource'],
    ['Pronouns', 'pronouns'],
    ['Desired salary', 'salaryExpectation'],
    ['Expected annual compensation', 'salaryExpectation'],
    ['When can you start?', 'earliestStartDate'],
    ['Languages you speak', 'languages'],
    ['Technical skills', 'skills'],
    // Things that must NOT match a profile field.
    ['How do you pronounce your name?', null],
    ['Why do you want to work at Acme?', 'whyInterested'],
  ];
  it.each(cases)('%s → %s', (label, key) => {
    expect(matchKey(label)).toBe(key);
  });

  it('ignores keywords mentioned in passing in long questions', () => {
    const c = { profile: testProfile(), skills: [] };
    const long = 'Share 2–3 of your open-source contributions with links (GitHub PRs, issues, or projects you maintain)';
    expect(resolveAnswer(long, '', null, c, false).answer).toBeNull();
  });

  it('answers a blank EEO question with "decline" only for choice fields', () => {
    const c = { profile: testProfile(), skills: [] };
    expect(resolveAnswer('Gender', '', null, c, true).answer?.value).toBe(DECLINE);
    expect(resolveAnswer('Gender', '', null, c, false).answer).toBeNull();
  });

  it('uses autocomplete hints when the label is unhelpful', () => {
    const c = { profile: testProfile(), skills: [] };
    expect(resolveAnswer('', '', 'given-name', c, false).answer?.value).toBe('Ada');
  });

  it('compares other-country citizenship questions against your citizenship', () => {
    const c = { profile: testProfile(), skills: [] };
    expect(resolveAnswer('Are you a Singapore citizen?', '', null, c, true).answer?.value).toBe('No');
    expect(resolveAnswer('Are you a citizen of the United States?', '', null, c, true).answer?.value).toBe('Yes');
  });
});

describe('cleanLabel', () => {
  it('drops required markers and suffixes', () => {
    expect(cleanLabel('First name *')).toBe('First name');
    expect(cleanLabel('Phone ✱')).toBe('Phone');
    expect(cleanLabel('First nameRequired')).toBe('First name');
    expect(cleanLabel('Summary (Optional)')).toBe('Summary');
  });
});

describe('optionScore', () => {
  it('matches yes/no phrasings', () => {
    expect(optionScore('Yes', 'Yes')).toBe(1);
    expect(optionScore('Yes, I am authorized to work in the US', 'Yes')).toBeGreaterThan(0.9);
    expect(optionScore('No, I will not require sponsorship', 'No')).toBeGreaterThan(0.9);
    expect(optionScore('No', 'Yes')).toBe(0);
    expect(optionScore('I am not a veteran', 'Yes')).toBe(0);
  });

  it('maps stored statements onto Yes/No options', () => {
    expect(optionScore('No', 'I am not a protected veteran')).toBeGreaterThan(0.85);
    expect(optionScore('Yes', 'No, I do not have a disability')).toBe(0);
  });

  it('finds decline options in all their wordings', () => {
    for (const text of ["I don't wish to answer", 'Decline To Self Identify', 'Prefer not to say', 'I choose not to disclose']) {
      expect(optionScore(text, DECLINE)).toBe(1);
    }
    expect(optionScore('Male', DECLINE)).toBe(0);
  });

  it('never picks a decline option for a real answer', () => {
    expect(optionScore('Decline to self identify', 'Male')).toBe(0);
  });

  it('handles synonyms, states and places', () => {
    expect(optionScore('United States of America', 'United States')).toBe(1);
    expect(optionScore('USA', 'United States')).toBe(1);
    expect(optionScore('California', 'CA')).toBe(1);
    expect(optionScore('Los Angeles, California, United States', 'Los Angeles, CA')).toBeGreaterThanOrEqual(0.85);
    expect(optionScore('Asian (Not Hispanic or Latino)', 'Asian')).toBeGreaterThanOrEqual(0.85);
    expect(optionScore("Bachelor's Degree", 'Bachelor of Arts')).toBeGreaterThanOrEqual(0.85);
    expect(optionScore('Woman', 'Female')).toBe(1);
  });
});

describe('saved answers', () => {
  it('matches reworded questions and flags weak matches', () => {
    const p = testProfile();
    p.savedAnswers = [{ id: '1', question: 'Why do you want to work here?', answer: 'Because…' }];
    expect(savedAnswerFor('Why do you want to work here?', p)?.confidence).toBe('high');
    expect(savedAnswerFor('Why do you want to work at Acme?', p)).not.toBeNull();
    expect(savedAnswerFor('What is your favorite color?', p)).toBeNull();
  });

  it('scores identical questions as 1', () => {
    expect(questionSimilarity('Are you over 18?', 'are you over 18')).toBe(1);
  });
});

describe('previously employed', () => {
  it('answers Yes when the question names a past employer', () => {
    const p = testProfile(); // worked at "Analytical Engines"
    const c = { profile: p, skills: [] };
    expect(resolveAnswer('Have you ever been employed by Analytical Engines?', '', null, c, true).answer?.value).toBe('Yes');
    expect(resolveAnswer('Have you ever been previously employed by Acme?', '', null, c, true).answer?.value).toBe('No');
  });
});

describe('EEO option wordings', () => {
  const pick = (opts: string[], v: string) => opts.map((o) => [o, optionScore(o, v)] as const).sort((a, b) => b[1] - a[1])[0];
  it('maps stored answers onto each site’s wording', () => {
    expect(pick(['Man', 'Woman', 'Non-binary', "I don't wish to answer"], 'Male')[0]).toBe('Man');
    expect(pick(['Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Asian (Not Hispanic or Latino)', 'Decline'], 'Asian')[0]).toBe('Asian (Not Hispanic or Latino)');
    expect(pick(['I identify as a protected veteran', 'I am not a protected veteran', "I don't wish to answer"], 'I am not a protected veteran')[0]).toBe('I am not a protected veteran');
    expect(pick(['Yes, I have a disability (or previously had one)', "No, I don't have a disability", "I don't wish to answer"], 'No, I do not have a disability')[0]).toBe("No, I don't have a disability");
    expect(pick(['Straight', 'Gay or Lesbian', 'Bisexual', 'Prefer not to say'], 'Heterosexual')[0]).toBe('Straight');
    expect(pick(['Yes', 'No', 'Decline To Self Identify'], 'No')[0]).toBe('No');
  });
});

describe('languages', () => {
  const c = { profile: testProfile(), skills: [] }; // English, Fluent
  const ask = (q: string, choice = true) => resolveAnswer(q, '', null, c, choice).answer?.value;
  it('answers Workday-style proficiency questions', () => {
    for (const q of ['Reading', 'Writing', 'Speaking', 'Comprehension', 'Overall', 'Reading Proficiency', 'Overall Proficiency Level', 'Read', 'Speak', 'Write', 'Listen', 'Understand', 'Verbal', 'Written', 'Oral Proficiency']) {
      expect(ask(q)).toBe('Fluent');
    }
    expect(ask('I am fluent in this language')).toBe('Yes');
    expect(ask('Language')).toEqual(['English']);
    expect(ask('How do you assess your writing and speaking English skills?')).toBe('Fluent');
  });
  it('respects the configured proficiency independently of the fluent checkbox', () => {
    for (const language of [
      { proficiency: '', fluent: true },
      { proficiency: 'Advanced', fluent: true },
      { proficiency: 'Native or bilingual', fluent: false },
    ]) {
      const profile = testProfile();
      Object.assign(profile.languages[0], language);
      expect(resolveAnswer('Write', '', null, { profile, skills: [] }, true).answer?.value).toBe(language.proficiency || undefined);
    }
    const profile = testProfile();
    Object.assign(profile.languages[0], { proficiency: 'Elementary', fluent: false });
    expect(resolveAnswer('Write', '', null, { profile, skills: [] }, true).answer?.value).toBe('Elementary');
  });
  it('matches Fluent exactly, including numbered levels, without substituting other levels', () => {
    expect(optionScore('Fluent', 'Fluent')).toBe(1);
    expect(optionScore('5 - Fluent', 'Fluent')).toBe(1);
    for (const option of ['Expert', 'Advanced', 'Not fluent', 'Non-fluent']) {
      expect(optionScore(option, 'Fluent')).toBe(0);
    }
  });
  it('matches "Native" only to native options', () => {
    expect(optionScore('Native or bilingual proficiency', 'Native')).toBe(1);
    expect(optionScore('Native speaker', 'Native')).toBe(1);
    for (const other of ['Fluent', 'Advanced', 'Expert', 'Bilingual', 'Mother tongue', 'Non-native']) expect(optionScore(other, 'Native')).toBe(0);
  });
});

describe('referrals', () => {
  it('answers "were you referred" No when the source is not a referral', () => {
    const c = { profile: testProfile(), skills: [] };
    expect(resolveAnswer('Were you referred by a current employee?', '', null, c, true).answer?.value).toBe('No');
    expect(resolveAnswer('How did you hear about this job?', '', null, c, true).answer?.value).toBe('LinkedIn');
  });
});

describe('degrees', () => {
  const pick = (opts: string[], v: string) => opts.map((o) => [o, optionScore(o, v)] as const).sort((a, b) => b[1] - a[1])[0];
  it('keeps arts and science degrees apart', () => {
    expect(pick(['B.S.B.A.', 'B.S.', 'B.A.', 'M.B.A.'], 'Bachelor of Arts')[0]).toBe('B.A.');
    expect(pick(['B.S.B.A.', 'B.S.', 'M.B.A.'], 'Bachelor of Arts')[1]).toBeLessThan(0.6);
    expect(pick(['Associate', "Bachelor's Degree", "Master's Degree"], 'Bachelor of Arts')[0]).toBe("Bachelor's Degree");
    expect(pick(['Bachelor of Science (BS)', 'Bachelor of Arts (BA)'], 'Bachelor of Arts')[0]).toBe('Bachelor of Arts (BA)');
  });
});

describe('spelling variants and fallbacks', () => {
  const tiered = (opts: string[], tiers: string[][]) => bestOptionTiered(opts, (o) => o, tiers)?.option;
  it('finds a school however the list spells it', () => {
    const davis = [schoolVariants('University of California, Davis')];
    expect(tiered(['UC San Diego', 'UC Davis', 'UCLA'], davis)).toBe('UC Davis');
    expect(tiered(['University of California-San Diego', 'University of California-Davis'], davis)).toBe('University of California-Davis');
    expect(tiered(['University of California at Davis', 'Davis College'], davis)).toBe('University of California at Davis');
    expect(tiered(['Davis College', 'Stanford University'], davis)).toBeUndefined();
  });

  it('spells multi-campus systems the way Workday lists them', () => {
    for (const name of ['University of California, Berkeley', 'UC Berkeley', 'University of California-Berkeley', 'University of California at Berkeley']) {
      expect(schoolVariants(name)).toContain('University of California-Berkeley');
      expect(tiered(['University of California-Davis', 'University of California-Berkeley'], [schoolVariants(name)])).toBe('University of California-Berkeley');
    }
    expect(schoolVariants('University of Texas at Austin')).toContain('University of Texas-Austin');
    expect(schoolVariants('University of Wisconsin, Madison')).toContain('University of Wisconsin-Madison');
    expect(schoolVariants('University of Michigan')).toEqual(['University of Michigan', 'Michigan University']);
  });

  it('finds a degree however the list spells it', () => {
    const ba = [degreeVariants('Bachelor of Arts')];
    expect(tiered(['B.S.', 'B.A.', 'M.S.'], ba)).toBe('B.A.');
    expect(tiered(['BS - Bachelor of Science', 'BA - Bachelor of Arts'], ba)).toBe('BA - Bachelor of Arts');
    expect(tiered(['Associate', "Bachelor's", 'Master'], ba)).toBe("Bachelor's");
    expect(tiered(['B.S.B.A.', 'B.S.'], ba)).toBeUndefined();
  });

  it('uses the major fallback only when the major has no option', () => {
    const tiers = [['Computer Science'], ['Software Engineering']];
    expect(tiered(['Software Engineering', 'Computer Science', 'Economics'], tiers)).toBe('Computer Science');
    expect(tiered(['Software Engineering', 'Economics'], tiers)).toBe('Software Engineering');
  });

  it('orders Computer Science variations, then Software Engineering', () => {
    const profile = testProfile();
    // The profile configures this order explicitly.
    const tiers = majorTiers(profile);
    const pick = (options: string[]) => tiered(options, tiers);
    expect(pick(['Software Engineering', 'Computer Sciences', 'Computer Science and Engineering', 'Computer Science'])).toBe('Computer Science');
    expect(pick(['Software Engineering', 'Software and Systems Engineering', 'Applied Computer Science'])).toBe('Applied Computer Science');
    expect(pick(['Software and Systems Engineering', 'Computer Sciences'])).toBe('Computer Sciences');
    expect(pick(['Software Engineering', 'Software and Systems Engineering'])).toBe('Software Engineering');
    expect(pick(['Software and Systems Engineering', 'Economics'])).toBeUndefined();
    expect(pick(['Software Engineering', 'Information Science', 'Information Systems'])).toBe('Software Engineering');
    expect(pick(['Information Systems', 'Information Science', 'Science'])).toBeUndefined();
    expect(pick(['Computer Science and Mathematics', 'Applied Computer Science'])).toBe('Applied Computer Science');
    expect(resolveAnswer('Field of Study', '', null, { profile, skills: [] }, true).answer?.tiers).toEqual(tiers);
  });

  it('preserves the saved fallback order for other majors', () => {
    const profile = testProfile();
    Object.assign(profile.education[0], { major: 'Statistics', majorFallbacks: ['Mathematics', 'Economics'] });
    expect(majorTiers(profile)).toEqual([['Statistics'], ['Mathematics'], ['Economics']]);
  });

  it('treats month names and numbers, and phone types, as the same', () => {
    expect(optionScore('05', 'May')).toBe(1);
    expect(optionScore('May', '5')).toBe(1);
    expect(optionScore('Sept', 'September')).toBe(1);
    expect(optionScore('Cell', 'Mobile')).toBe(1);
  });
});

describe('standard disclosure questions', () => {
  const c = { profile: testProfile(), skills: [] };
  const ask = (q: string) => resolveAnswer(q, '', null, c, true).answer?.value;
  it('answers No from the profile', () => {
    expect(ask('Are you related to, or in a close personal relationship with, any current employee of Initech or one of its subsidiary operating companies?')).toBe('No');
    expect(ask('Are you currently or have you been a public official or is anyone in your immediate family a public official or employed by a Government entity?')).toBe('No');
    expect(ask('Do you have any relatives currently working at Acme?')).toBe('No');
    expect(ask('Do you have any potential conflicts of interest?')).toBe('No');
    expect(ask('Have you ever been employed by Initech or a subsidiary of Initech?')).toBe('No');
  });
});

describe('disclosure questions stay narrow', () => {
  it('does not answer unrelated "related to" questions', () => {
    const c = { profile: testProfile(), skills: [] };
    expect(resolveAnswer('Do you have experience related to SQL?', '', null, c, true).answer).toBeNull();
  });
});

describe('Workday voluntary disclosures (capture B wording)', () => {
  const p = testProfile();
  Object.assign(p.eeo, { gender: 'Male', raceEthnicity: 'Asian', hispanicLatino: 'No', veteranStatus: 'I am not a protected veteran', disability: 'No, I do not have a disability' });
  p.answers.agreeToTerms = 'Yes';
  const c = { profile: p, skills: [] };
  const pick = (label: string, opts: string[]) => {
    const a = resolveAnswer(label, '', null, c, true).answer!;
    return opts.map((o) => [o, optionScore(o, String(a.value))] as const).sort((x, y) => y[1] - x[1])[0][0];
  };
  it('picks each answer from that site’s options', () => {
    expect(pick('Hispanic or Latino?', ['Yes', 'No', 'I do not wish to answer'])).toBe('No');
    expect(pick('Race / Ethnicity', ['White (United States of America)', 'Asian (United States of America)', 'Black or African American (United States of America)', 'I do not wish to answer'])).toBe('Asian (United States of America)');
    expect(pick('Gender', ['Female', 'Male', 'I do not wish to answer'])).toBe('Male');
    expect(pick('Protected Veteran', ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN', 'I AM NOT A VETERAN', 'I DO NOT WISH TO SELF-IDENTIFY'])).toBe('I AM NOT A VETERAN');
  });
  it('ticks the required terms box but not marketing opt-ins', () => {
    expect(resolveAnswer('By submitting, you declare that you have read, understood, and accepted the terms in this policy', '', null, c, true).answer?.value).toBe('Yes');
    expect(resolveAnswer('I have reviewed and agree to the terms and conditions of the data privacy agreement', '', null, c, true).answer?.value).toBe('Yes');
    expect(resolveAnswer('I agree to receive marketing emails about future opportunities', '', null, c, true).answer).toBeNull();
  });
});

describe('phone fields', () => {
  const c = { profile: testProfile(), skills: [] };
  it('leaves phone extensions blank and fills only the number', () => {
    expect(resolveAnswer('Phone Extension', '', null, c, false).answer).toBeNull();
    expect(resolveAnswer('Ext.', '', null, c, false).answer).toBeNull();
    expect(resolveAnswer('Phone Number', '', null, c, false).answer?.value).toBe(c.profile.personal.phone);
    expect(resolveAnswer('Phone Device Type', '', null, c, true).answer?.value).toBe('Mobile');
    expect(resolveAnswer('Country Phone Code', '', null, c, true).answer?.key).toBe('phoneCountryCode');
  });
  it('does not use the hint "phoneNumber--extension" to fill the extension', () => {
    expect(resolveAnswer('', 'phone Number extension', null, c, false).answer).toBeNull();
  });
});

describe('minimum requirements', () => {
  const c = { profile: testProfile(), skills: [] };
  it.each([
    'Do you meet the minimum requirements for this position?',
    'Do you meet the minimum qualifications listed in the job description?',
    'Do you meet the basic qualifications for this role?',
    'Do you meet all of the required qualifications?',
    'Do you possess the minimum requirements outlined in the job posting?',
  ])('%s → Yes', (q) => {
    expect(resolveAnswer(q, '', null, c, true).answer?.value).toBe('Yes');
  });
});

describe('language level order', () => {
  const pick = (opts: string[]) => opts.map((o) => [o, optionScore(o, 'Native or bilingual')] as const).sort((a, b) => b[1] - a[1])[0];
  it('gives no in-between level (Expert, Advanced) a Native score', () => {
    expect(pick(['Advanced', 'Beginner', 'Expert', 'Intermediate'])[1]).toBe(0);
  });
});
