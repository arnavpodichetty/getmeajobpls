// Many wordings of the questions applications ask, each with the answer the fictional
// test profile must get. The point is coverage of phrasing, not of one site: when a new
// wording goes wrong, add it here next to its siblings.
//
// The profile: authorized to work in the US, no sponsorship, US citizen, current
// undergraduate (Bachelor's, graduating 2028-06), one current internship, never worked
// for the employer, no clearance, not a veteran, no disability.
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { bestOption, bestOptionTiered, CONFIDENT_OPTION_SCORE, DECLINE } from '../src/lib/engine/text';
import { context } from './helpers/fixture';

function profile() {
  const { profile: p } = context();
  Object.assign(p.eeo, {
    gender: 'Female', raceEthnicity: 'East Asian', hispanicLatino: 'No',
    veteranStatus: 'I am not a protected veteran', disability: 'No, I do not have a disability',
  });
  return p;
}

function answerFor(label: string, isChoice = true) {
  const r = resolveAnswer(label, '', null, { profile: profile(), skills: [] }, isChoice);
  return r.answer ? r.answer.value : null;
}

/** [question, expected answer]; null = must be left for you. */
const BANK: Record<string, [string, string | null][]> = {
  'work authorization': [
    ['Are you legally authorized to work in the United States?', 'Yes'],
    ['Are you authorized to work in the US?', 'Yes'],
    ['Are you eligible to work in the United States?', 'Yes'],
    ['Do you have the legal right to work in the United States?', 'Yes'],
    ['Are you legally permitted to work in the U.S.?', 'Yes'],
    ['Are you legally eligible for employment in the United States? (Proof of identity and employment eligibility will be required within 3 days of hire).', 'Yes'],
    ['Are you authorized to work lawfully in the United States for any employer?', 'Yes'],
    ['Legally authorized to work in the US', 'Yes'],
    ['Work Authorization: Are you currently authorized to work in the country where this role is located?', 'Yes'],
  ],
  'work authorization (documentation)': [
    ['Do you have a legal right and necessary documentation to work in the United States? (Identity and employment eligibility of all new hires will be verified as required by the Immigration Reform and Control Act of 1986.)', 'Yes'],
  ],
  'employment and regulatory history': [
    ['Have you ever been discharged by any company, separated by mutual agreement, or resigned after being offered the option to do so?', 'No'],
    ['Have you ever been terminated or asked to resign from any position?', 'No'],
    ['Have you ever been terminated from employment?', 'No'],
    ['Are you the subject of any pending action or investigation by any civil regulatory authority, including but not limited to a licensing board or agency of any state, a federal agency, the IRS, the AICPA or state society, the SEC, or the PCAOB, or have you completed a stipulation and consent decree, or entered into a settlement with any such regulatory authority?', 'No'],
    ['Have you had a professional license or its equivalent investigated, revoked, suspended, or cancelled, or been otherwise disciplined, reprimanded, admonished, or removed from membership by any civil regulatory authority, including but not limited to a licensing board or agency of any state, a federal agency, the IRS, the AICPA or state society, the SEC, or the PCAOB?', 'No'],
    ['Have you surrendered a professional license of any type to resolve a disciplinary investigation or proceeding with any civil regulatory authority, including but not limited to a licensing board or agency of any state, a federal agency, the IRS, the AICPA or state society, the SEC, or the PCAOB?', 'No'],
  ],
  'fiduciary roles': [
    ['Do you currently hold a position, or have you been named to serve as a board member, trustee, trust protector, executor, or personal representative?', 'No'],
  ],
  'current employer a client': [
    ['Is your current employer an Example Firm client?', 'No'],
  ],
  'sponsorship needed': [
    ['Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?', 'No'],
    ['Do you require visa sponsorship?', 'No'],
    ['Will you now, or in the future, require the company to sponsor an immigration case for employment?', 'No'],
    ['Would you need sponsorship to work in the US?', 'No'],
    ['Do you now or will you in the future need immigration sponsorship?', 'No'],
    ['Will you require employer sponsorship now or in the future in order to remain authorized to work in the United States?', 'No'],
    ['Sponsorship required?', 'No'],
    ['Will you require sponsorship? (If you can work without sponsorship, select No)', 'No'],
    ['Will you need H-1B sponsorship?', 'No'],
    ['Will you require employer support to obtain or maintain authorization to work in that country? e.g. (work permit)*', 'No'],
    ['Will you need company assistance to obtain a work permit or visa?', 'No'],
  ],
  'authorized without sponsorship': [
    ['Are you authorized (or eligible) to work lawfully in the country where this position is based, without requiring sponsorship or other immigration-related legal support from your employer, now and in the future?', 'Yes'],
    ['Are you authorized to work in the U.S. without the need for employer sponsorship now or in the future?', 'Yes'],
    ['Are you legally authorized to work in the United States without requiring visa sponsorship, now or in the future?', 'Yes'],
    ['Can you work in the US without sponsorship?', 'Yes'],
    ['Are you able to work in the United States without visa sponsorship?', 'Yes'],
    ['Are you eligible for employment in the US with no need for sponsorship?', 'Yes'],
  ],
  citizenship: [
    ['Are you a U.S. citizen?', 'Yes'],
    ['Are you a US citizen or permanent resident?', 'Yes'],
    ['US Citizen', 'Yes'],
    ['This specific position requires U.S. citizenship status, do you meet this qualification?', 'Yes'],
    ['This role requires U.S. citizenship. Are you a U.S. citizen?', 'Yes'],
    ['Due to government contract requirements, candidates must be U.S. citizens. Do you meet this requirement?', 'Yes'],
    ['Are you a citizen of any country other than the United States?', 'No'],
    ['Do you hold dual citizenship?', 'No'],
    ['Are you a Canadian citizen?', 'No'],
  ],
  'security clearance': [
    ['Do you have an active security clearance?', 'No'],
    ['Do you currently hold a security clearance?', 'No'],
    ['Do you hold an active U.S. Government Security Clearance?', 'No'],
    ['6. Do you hold an active U.S. Government Security Clearance?', 'No'],
    ['Have you ever held a U.S. government security clearance?', 'No'],
    ['What is your current security clearance level?', 'None'],
    ['Are you able to obtain a U.S. security clearance?', 'Yes'],
    ['Can you obtain and maintain a security clearance?', 'Yes'],
    ['Are you eligible to obtain a U.S. Government security clearance?', 'Yes'],
    ['Are you willing to undergo a security clearance investigation?', 'Yes'],
  ],
  'government and military service': [
    ['Are you a current or former government official?', 'No'],
    ['Have you ever been employed by the U.S. federal government?', 'No'],
    ['Have you ever worked for a state or local government?', 'No'],
    ['Do you now, or did you at any time in the past 24 months, serve as an official or employee of the DoD?', 'No'],
    ['Section 847 of the National Defense Authorization Act requires certain current and former Department of Defense (DoD) officials or employees, as well as the military departments, to obtain a written ethics opinion. Do you now, or did you at any time in the past 24 months, serve as an official or employee of the DoD?', 'No'],
    ['Are you currently or have you previously been a "non-US government official"?', 'No'],
    ['Are you a politically exposed person?', 'No'],
    ['Are you a current or former military spouse?', 'No'],
    ['Have you ever been debarred or suspended from government contracting?', 'No'],
    ['Have you or do you currently work for a public agency or institution?', 'No'],
  ],
  'past employment with the employer': [
    ['Have you ever worked for Acme?', 'No'],
    ['Have you previously been employed by Acme?', 'No'],
    ['Are you a current or former employee of Acme?', 'No'],
    ['Have you worked with us before?', 'No'],
    ['Have you ever been employed by us?', 'No'],
    ['Are you currently employed by Acme or any of its subsidiaries?', 'No'],
    ['Have you ever worked at Acme as an employee, intern or contractor?', 'No'],
    ['Have you previously been employed by Example State University or the Example Research Institute, or were you previously associated with the University as a student? If you are currently employed with the University, please submit your application in Workday by clicking on the Careers Icon located on your Workday Home page and then the CMU Careers page.', 'No'],
    ['Have you previously worked for Acme?', 'No'],
    ['Have you ever worked for this company?', 'No'],
    ['Have you previously been employed by Acme or any of its affiliates?', 'No'],
    ['Have you ever been employed by Acme (including as an intern or contractor)?', 'No'],
    ['Have you worked at Acme before?', 'No'],
    ['Previous Employment: Have you previously worked for Acme?', 'No'],
    ['Former employee?', 'No'],
    ['Are you a former Acme employee, intern or student worker?', 'No'],
    // Your own school asking whether you studied there is a Yes.
    ['Have you previously been employed by the University of California, Los Angeles, or were you previously associated with the University as a student?', 'Yes'],
  ],
  'current employment status': [
    ['Are you currently employed?', 'Yes'],
    ['Currently employed', 'Yes'],
  ],
  'applied before': [
    ['Have you previously applied to Acme?', 'No'],
    ['Have you applied for a position with us in the past 12 months?', 'No'],
  ],
  relatives: [
    ['Do you have any relatives working at Acme?', 'No'],
    ['Are you related to anyone currently employed by Acme?', 'No'],
    ['Do you have a family member who works here?', 'No'],
    ['Are you an immediate family member of, or do you hold a "close personal relationship" with, a "non-US government official"?', 'No'],
  ],
  education: [
    ['Are you currently enrolled in a degree program?', 'Yes'],
    ['Are you a current student?', 'Yes'],
    ["Are you currently pursuing a bachelor's degree?", 'Yes'],
    ['Are you currently working towards a Bachelors or Master’s Degree?', 'Yes'],
    ["Are you currently pursuing a Master's or PhD?", 'No'],
    ['What is the highest level of education you have completed?', 'High School Diploma'],
    ["If hired, we will verify your most recent graduation date and the highest degree or diploma received. What is the highest level of education you've received?", 'High School Diploma'],
    ['Highest degree obtained', 'High School Diploma'],
    ['What is your expected graduation date?', '2028-06'],
    ['When do you expect to graduate?', '2028-06'],
    ['What semester and year is your expected graduation date?', '2028-06'],
  ],
  'schedule and program availability': [
    ['Are you available for full-time employment for 10 to 12 (ten to twelve) weeks during the summer?', 'Yes'],
    ['Are you available to work full-time for 12 weeks this summer?', 'Yes'],
    ['Are you able to commit to a 10-week summer internship?', 'Yes'],
    ['Can you work 40 hours per week for the duration of the program?', 'Yes'],
    ['Are you available for full-time summer employment from June through August?', 'Yes'],
  ],
  'returning to school after the internship': [
    ['Do you plan to return to school upon completion of your internship?', 'Yes'],
    ['Will you be returning to school after the internship?', 'Yes'],
    ['Are you returning to an academic program after the summer internship?', 'Yes'],
    ['Do you intend to continue your studies after this internship?', 'Yes'],
    ['Will you be enrolled as a student following the completion of the internship?', 'Yes'],
  ],
  'location and relocation': [
    ['Are you willing to relocate?', 'Yes'],
    ['Would you be open to relocating for this role?', 'Yes'],
    ['Are you willing to relocate if required by the position?', 'Yes'],
    ['Are you currently located in the United States?', 'Yes'],
    ['Do you currently reside in California?', 'Yes'],
    ['Do you currently reside in Texas?', 'No'],
  ],
  age: [
    ['Are you at least 18 years of age?', 'Yes'],
    ['Are you 18 years or older?', 'Yes'],
    ['Are you over the age of 18?', 'Yes'],
  ],
  consent: [
    ['Do you consent to being contacted by email about this or other opportunities?', 'Yes'],
    ['May we contact you by email about future opportunities?', 'Yes'],
    ['Do you consent to receive SMS messages regarding your application?', 'No'],
    ['Do you consent to being contacted by text/SMS about this or other opportunities?', 'No'],
    ['Are you willing to undergo a background check?', 'Yes'],
    ['Do you consent to a pre-employment drug screen?', 'Yes'],
    ['Can you provide verification of your identify upon hire?*', 'Yes'],
    ['Can you provide verification of your identity upon hire?', 'Yes'],
    ['Are you able to submit proof of identity if hired?', 'Yes'],
    ['Will you be able to verify your identity at the time of hire?', 'Yes'],
    ['We may use automated tools such as AI to support review of your application for this role, and if applicable, match you with relevant existing and future open roles. If you prefer not to have your application processed by these tools, you can opt-out. Opting out will not impact your eligibility for this role or to apply for relevant open roles.*', 'Yes'],
    ['Do you consent to the use of artificial intelligence tools in reviewing your application?', 'Yes'],
    ['Are you able to perform the essential functions of this job with or without reasonable accommodation?', 'Yes'],
  ],
  'agreements and conflicts': [
    ['Are you subject to a non-compete agreement?', 'No'],
    ['Are you bound by any non-solicitation or restrictive covenant?', 'No'],
    ['Do you have any outside business activities that could present a conflict of interest?', 'No'],
    ['Would you be subject to any restrictions from a former employer upon joining Example Group?', 'No'],
    ['Within the past 2 years have you supervised, approved, evaluated or awarded Example Group work?', 'No'],
    ['Are you currently or have you been involved in a selection committee process awarding work to Example Group?', 'No'],
    // Keeping your current internship is another job, so this one is yours to answer.
    ['If you join Example Group, will you also be involved in any other jobs, business investments, board memberships, municipal bodies or political positions?', null],
  ],
  'voluntary self-identification': [
    ['What is your gender?', 'Female'],
    ['Are you Hispanic or Latino?', 'No'],
    ['Please indicate your veteran status:', 'I am not a protected veteran'],
    ['Are you a protected veteran?', 'I am not a protected veteran'],
    ['Do you have a disability?', 'No, I do not have a disability'],
    // Service details are blank for a non-veteran, not filled with the status.
    ['Newly Separated Veteran Discharge Date', '__leave_empty__'],
    ['Newly Separated Veteran Discharge Date Month', '__leave_empty__'],
  ],
  'how you heard': [
    ['How did you hear about this position?', 'LinkedIn'],
    ['How Did You Hear About Us?', 'LinkedIn'],
    ['Where did you first learn about this job?', 'LinkedIn'],
    ['How did you find out about us?', 'LinkedIn'],
    ['Source', 'LinkedIn'],
    ['Did an Example Group employee refer you to this job posting?', 'No'],
  ],
  'other names': [
    ['Have you ever been employed under any other name?', 'No'],
    ['Have you even been employed under any other name?', 'No'],
    ['Have you ever worked under a different name?', 'No'],
    ['Have you ever been known by any other name?', 'No'],
  ],
  'professional license': [
    ['Do you have a valid Insurance License?', 'No'],
    ['Do you currently hold an active real estate license?', 'No'],
    ['Are you currently licensed to sell insurance in your state?', 'No'],
    ['Do you have a valid driver\'s license?', 'Yes'],
    ['Are you willing to obtain an insurance license within 90 days of hire?', null],
  ],
  'high school or GED': [
    ['Do you have a high school degree or GED?', 'Yes'],
    ['Do you have a high school diploma or equivalent?', 'Yes'],
    ['Have you graduated from high school or obtained a GED?', 'Yes'],
  ],
  'applied before / documentation / essential functions': [
    ['Have you ever applied with Example Group previously?', 'No'],
    ['If hired, will you be able to provide documentation required under applicable laws showing that you are legally able to work in the US?', 'Yes'],
    ['Are you able, with or without reasonable workplace accommodations, to perform the essential functions of the job for which you are applying?', 'Yes'],
    ['To your knowledge, are you capable of performing the essential functions of the job for which you are applying, with or without reasonable accommodations?*', 'Yes'],
    ['Are you capable of carrying out the essential duties of this position?', 'Yes'],
  ],
  'other citizenships': [
    ['Are you a dual citizen?', 'No'],
    ['If you are a dual citizen, what other country are you a citizen of?', 'N/A'],
    ['Do you currently hold permanent residence or citizenship in another country?*', 'No'],
  ],
  'export-control country lists': [
    ['In line with U.S. export control laws, Acme Group may gather nationality details for specific roles to determine licensing or technology control needs. Please review the countries below and answer the subsequent questions accordingly. Afghanistan Armenia Belarus China, or other Chinese territory Cuba Iran North Korea Russia Syria Venezuela Do you now, or have you held citizenship in any of the countries listed above?*', 'No'],
    ['Are you a citizen or national of any of the following countries: Cuba, Iran, North Korea, Syria?', 'No'],
    ['If yes, please specify which country.*', 'N/A'],
    ['If so, which country?', 'N/A'],
  ],
  'non-compete': [
    ['Do you have a non-compete?*', 'No'],
    ['Are you bound by a non-compete or non-solicitation agreement?', 'No'],
  ],
  'international student': [
    ['Are you an international student?', 'No'],
    ['Are you currently an international student?', 'No'],
    ['Are you currently on an F-1 student visa?', 'No'],
  ],
  'school dates and "undergraduate"': [
    // "undergraduate" contains "graduat" but is not a graduation question.
    ['What month and year did you begin your undergraduate studies?', '2024-09'],
    ['When did you start your degree program?', '2024-09'],
    ['What is your expected graduation date?', '2028-06'],
    ['What undergraduate university do you attend?', 'University of California, Los Angeles'],
  ],
  'Oracle Recruiting': [
    ['Are you at least 18 years of age?', 'Yes'],
    ['For the position you are applying to, are you legally authorized to work in this country? Note: If hired, based upon the work location, you may be required to provide government issued documentation proving your work authorization, on or before your first day of employment.', 'Yes'],
    ['Will you now or in the future require sponsorship for an employment-based visa status?', 'No'],
    ['Do you meet the minimum years of experience required for this role?', 'Yes'],
  ],
  'left for you (no guessing)': [
    // A "Title" choice lists honorifics (Mr. / Ms. / Dr.), not your job title.
    ['Title', null],
    ['Have you ever been convicted of a felony?', null],
    ['Why do you want to work here?', null],
    ['Do you have experience with Kubernetes?', null],
    ['Describe a time you led a team through a difficult project.', null],
  ],
};

describe.each(Object.entries(BANK))('%s', (_group, cases) => {
  it.each(cases)('%s → %s', (question, expected) => {
    expect(answerFor(question)).toBe(expected);
  });
});

// --- Choosing from the options a site shows -------------------------------------

function choose(options: string[], question: string) {
  const r = resolveAnswer(question, '', null, { profile: profile(), skills: [] }, true);
  const a = r.answer!;
  const value = Array.isArray(a.value) ? a.value[0] : a.value;
  const pick = a.tiers ? bestOptionTiered(options, (o) => o, a.tiers) : bestOption(options, (o) => o, value);
  return pick && pick.score >= 0.6 ? { option: pick.option, sure: pick.score >= CONFIDENT_OPTION_SCORE } : null;
}

/** [question, options, expected option (or null = leave it), confident?] */
const CHOICES: [string, string[], string | null, boolean][] = [
  ['Are you legally authorized to work in the United States?', ['Yes', 'No'], 'Yes', true],
  ['Are you legally authorized to work in the United States?', ['Yes, I am authorized to work in the US', 'No, I am not authorized to work in the US'], 'Yes, I am authorized to work in the US', true],
  ['Do you require visa sponsorship?', ['Yes, I will require sponsorship', 'No, I will not require sponsorship'], 'No, I will not require sponsorship', true],
  // A hedged "Yes, but…" is never the sure choice; the unqualified Yes is.
  ['Are you authorized to work in the US?', ['Yes, but I will need sponsorship in the future', 'Yes, and I will not need sponsorship', 'No'], 'Yes, and I will not need sponsorship', true],
  ['Are you authorized to work in the US?', ['Yes, but I will need sponsorship in the future', 'No'], 'Yes, but I will need sponsorship in the future', false],
  ['Please indicate your veteran status:', ['I am a protected veteran, as I identify as one or more of the listed classifications above of protected veterans', 'I am a veteran, but not a protected veteran, based on the listed classifications.', 'I am not a veteran.', 'I do not wish to provide this information.'], 'I am not a veteran.', true],
  ['Please indicate your veteran status:', ['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', 'I prefer not to answer'], 'I am not a protected veteran', true],
  ['Have you served in the U.S. military?', ['Yes', 'No'], 'No', true],
  ['Do you have a disability?', ['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer'], 'No, I do not have a disability and have not had one in the past', true],
  ['What is your gender?', ['Male', 'Female', 'Non-binary', 'Decline to self-identify'], 'Female', true],
  // A June graduation is the spring term, never the fall of the same year.
  ['What semester and year is your expected graduation date?', ['Fall 2027', 'Fall 2028', 'Spring 2028', 'Summer 2028'], 'Spring 2028', true],
  ['What semester and year is your expected graduation date?', ['Fall 2027', 'Fall 2028', 'Spring 2029'], null, false],
  ['What is your expected graduation date for your current degree program?', ['Spring 2027', 'Winter 2027', 'Spring 2028', 'Winter 2028', 'Spring 2029', 'Winter 2029 or later'], 'Spring 2028', true],
  ['What is your gender?', ['Man', 'Woman', 'Prefer not to say'], 'Woman', true],
  ['Are you Hispanic or Latino?', ['Yes', 'No', 'Decline to answer'], 'No', true],
  ['Are you Hispanic or Latino?', ['Hispanic or Latino', 'Not Hispanic or Latino', 'Decline to self identify'], 'Not Hispanic or Latino', true],
  ['Please select your race', ['White', 'Black or African American', 'Asian', 'Hispanic or Latino', 'Two or more races'], 'Asian', true],
  ['What is the highest level of education you have completed?', ['High School Diploma/GED', "Associate's Degree", "Bachelor's Degree", "Master's Degree"], 'High School Diploma/GED', true],
  ['Do you hold an active U.S. Government Security Clearance?', ['Yes', 'No'], 'No', true],
  ['Do you hold an active U.S. Government Security Clearance?', ['Yes - Secret', 'Yes - Top Secret', 'No, I do not hold an active U.S. Government Security Clearance.'], 'No, I do not hold an active U.S. Government Security Clearance.', true],
  ['Security clearance', ['None', 'Secret', 'Top Secret', 'TS/SCI'], 'None', true],
  ['Security clearance', ['Yes', 'No'], 'No', true],
  ['Do you currently possess an active security clearance?*', ['Yes, I possess an active security clearance.', 'No, I do not possess an active security clearance.'], 'No, I do not possess an active security clearance.', true],
  // "Sponsored" here is the clearance's agency, not visa sponsorship.
  ['If you currently possess an active security clearance, which agency sponsored the clearance?*', ['Department of Defense', 'Department of Energy', 'Other', 'I do not possess an active security clearance.'], 'I do not possess an active security clearance.', true],
  ['Which agency granted your security clearance?', ['Department of Defense', 'Department of State', 'Not applicable'], 'Not applicable', true],
  ['Are you currently enrolled in a four-year accredited college or university?', ['Full-time', 'Part-time', 'Not attending'], 'Full-time', true],
  ['Are you currently enrolled in a four-year accredited college or university?', ['Yes', 'No'], 'Yes', true],
  ['Are you currently enrolled full-time?', ['Yes', 'No'], 'Yes', true],
  ['Are you an international student?', ['Yes', 'No'], 'No', true],
  ['Are you currently pursuing a Master\'s degree?', ['Yes', 'No'], 'No', true],
  ['Various federal laws restrict the post-government employment activities of former military personnel and federal government employees. The Post-Government Employment Certification is designed to assess which restrictions, if any, apply to you.', ['I have never been employed by the U.S. government or the U.S. Armed Forces.', 'I am a current or former U.S. government employee or member of the Armed Forces.'], 'I have never been employed by the U.S. government or the U.S. Armed Forces.', true],
  ['How Did You Hear About Us?', ['Agency', 'Career Site', 'Recruiter', 'Referred by Employee'], 'Career Site', true],
  ['We may use automated tools such as AI to support review of your application for this role, and if applicable, match you with relevant existing and future open roles. If you prefer not to have your application processed by these tools, you can opt-out. Opting out will not impact your eligibility for this role or to apply for relevant open roles.*', ['I consent to automated review', 'I opt out of automated review'], 'I consent to automated review', true],
  ['We may use automated tools such as AI to support review of your application for this role, and if applicable, match you with relevant existing and future open roles. If you prefer not to have your application processed by these tools, you can opt-out. Opting out will not impact your eligibility for this role or to apply for relevant open roles.*', ['Yes', 'No'], 'Yes', true],
  ['How did you hear about this position?', ['LinkedIn', 'Indeed', 'Glassdoor', 'Other'], 'LinkedIn', true],
  ['How did you hear about this position?', ['Job Fair', 'Indeed Website', 'Employee Referral', 'Acme Careers Website'], 'Acme Careers Website', true],
  ['This specific position requires U.S. citizenship status, do you meet this qualification?', ['Yes', 'No'], 'Yes', true],
  ['Are you a U.S. person as defined by ITAR?', ['Yes', 'No'], 'Yes', true],
  ['Do you consent to receive SMS messages regarding your application?', ['Yes, I consent', 'No I do not consent'], 'No I do not consent', true],
  ['Do you currently reside in California?', ['Yes', 'No'], 'Yes', true],
  ['What is the type of degree program are you currently enrolled in?', ['High School Diploma', 'Associate Degree', 'Bachelor’s Degree', 'Master’s Degree (non-MBA)', 'Master of Business Administration (MBA – 2-Year Program)', 'Doctorate (PhD, EdD, etc.)', 'Professional Degree (MD, JD, etc.)', 'None'], 'Bachelor’s Degree', true],
];

describe('choosing options', () => {
  it.each(CHOICES)('%s %j → %s', (question, options, expected, sure) => {
    const got = choose(options, question);
    if (expected === null) {
      expect(got?.sure ?? false).toBe(false);
      return;
    }
    expect(got?.option).toBe(expected);
    expect(got?.sure).toBe(sure);
  });

  it('never picks an option that means the opposite', () => {
    const opposite: [string, string][] = [
      ['I am a protected veteran', 'I am not a protected veteran'],
      ['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability'],
      ['Not Hispanic or Latino', 'Hispanic or Latino'],
      ['Female', 'Male'],
      ['I do not agree', 'Yes'],
    ];
    for (const [option, wanted] of opposite) {
      expect(bestOption([option], (o) => o, wanted)?.score ?? 0, `${option} <= ${wanted}`).toBeLessThan(0.6);
    }
  });

  // Your answer "I am not a protected veteran" against the many ways forms list veteran status.
  const NOT_A_VETERAN: [string[], string][] = [
    [['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE', 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN', 'I AM NOT A VETERAN', 'I DO NOT WISH TO SELF-IDENTIFY'], 'I AM NOT A VETERAN'],
    [['I am a protected veteran', 'I am a veteran, but not a protected veteran', 'I am not a veteran', 'I prefer not to answer'], 'I am not a veteran'],
    [['Protected Veteran', 'Non-Protected Veteran', 'Not a Veteran', 'Decline to Self-Identify'], 'Not a Veteran'],
    [['Veteran - Protected', 'Veteran - Not Protected', 'Non-Veteran', 'I choose not to disclose'], 'Non-Veteran'],
    [['Yes, I am a veteran but not a protected veteran', 'Yes, I am a protected veteran', 'No, I have not served in the military', 'Decline'], 'No, I have not served in the military'],
    [['I am a veteran', 'I am not a veteran', 'I do not wish to answer'], 'I am not a veteran'],
    [['I have served in the military but am not a protected veteran', 'I have never served in the military', 'I identify as a protected veteran'], 'I have never served in the military'],
    [['One or more of the classifications of protected veteran', 'I am not a protected veteran', 'I do not wish to self-identify'], 'I am not a protected veteran'],
    [['Disabled veteran', 'Recently separated veteran', 'Active duty wartime or campaign badge veteran', 'Armed forces service medal veteran', 'I am not a protected veteran'], 'I am not a protected veteran'],
  ];
  it.each(NOT_A_VETERAN)('"I am not a protected veteran" in %j → %s', (options, expected) => {
    const got = choose(options, 'Veteran Status');
    expect(got?.option).toBe(expected);
    expect(got?.sure).toBe(true);
  });

  it('never answers "not a protected veteran" with an option saying you are a veteran', () => {
    for (const option of ['I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN', 'I am a veteran, but not a protected veteran', 'Non-Protected Veteran', 'Veteran - Not Protected', 'I am a veteran', 'Yes, I am a veteran but not a protected veteran', 'I have served in the military but am not a protected veteran']) {
      expect(bestOption([option], (o) => o, 'I am not a protected veteran')?.score ?? 0, option).toBeLessThan(0.6);
    }
  });

  it('declines only on decline options', () => {
    expect(bestOption(['Male', 'Female', 'I prefer not to say'], (o) => o, DECLINE)?.option).toBe('I prefer not to say');
  });
});

describe('enrollment status', () => {
  it('part-time students pick Part-time and answer No to "enrolled full-time?"', () => {
    const p = profile();
    p.answers.enrollmentStatus = 'Part-time';
    const ctx = { profile: p, skills: [] };
    const tiered = resolveAnswer('Are you currently enrolled in a four-year accredited college or university?', '', null, ctx, true).answer!;
    expect(bestOptionTiered(['Full-time', 'Part-time', 'Not attending'], (o) => o, tiered.tiers!)?.option).toBe('Part-time');
    expect(resolveAnswer('Are you currently enrolled full-time?', '', null, ctx, true).answer?.value).toBe('No');
  });
});

describe('"must be pursuing a degree" with degree levels as the choices', () => {
  const label = 'You must be currently pursuing a degree to be eligible for an internship with Acme Group.';
  const levels = ['Bachelors', 'Doctorate', 'Juris Doctor', 'Masters'];
  const pick = (p: ReturnType<typeof profile>, question = label, options = levels) => {
    const answer = resolveAnswer(question, '', null, { profile: p, skills: [] }, true).answer!;
    return bestOptionTiered(options, (o) => o, answer.tiers!)?.option;
  };

  it('picks Bachelors by default', () => {
    expect(pick(profile())).toBe('Bachelors');
    expect(pick(profile(), label, ["Bachelor's Degree", "Master's Degree", 'Doctoral Degree'])).toBe("Bachelor's Degree");
  });

  it('follows the setting', () => {
    const p = profile();
    p.answers.pursuingDegree = "Master's";
    expect(pick(p)).toBe('Masters');
    p.answers.pursuingDegree = 'Doctorate';
    expect(pick(p)).toBe('Doctorate');
  });

  it('still answers Yes when the choices are Yes / No', () => {
    expect(pick(profile(), label, ['Yes', 'No'])).toBe('Yes');
  });

  it('leaves the list for you when the setting is blank', () => {
    const p = profile();
    p.answers.pursuingDegree = '';
    expect(pick(p)).toBeUndefined();
  });
});

describe('professional license set to Yes', () => {
  it('is left for you, since the license type is unknown', () => {
    const p = profile();
    p.answers.professionalLicense = 'Yes';
    expect(resolveAnswer('Do you have a valid Insurance License?', '', null, { profile: p, skills: [] }, true).answer).toBeNull();
  });
});

describe('history questions answered blank in Options', () => {
  it('are left for you', () => {
    const p = profile();
    Object.assign(p.answers, { disciplinaryHistory: '', fiduciaryRoles: '', currentEmployerClient: '' });
    for (const q of ['Have you ever been terminated from employment?', 'Is your current employer an Example Firm client?', 'Do you currently hold a position, or have you been named to serve as a board member, trustee, trust protector, executor, or personal representative?']) {
      expect(resolveAnswer(q, '', null, { profile: p, skills: [] }, true).answer).toBeNull();
    }
  });
});

describe('work at a public university', () => {
  it('is left for you on "public agency or institution" questions', () => {
    const p = profile();
    p.experience.push({ id: 'x2', company: 'University of California, Los Angeles', title: 'Research Assistant', type: 'Part-time', location: 'Los Angeles, CA', start: '2025-01', end: '', current: true, description: '' });
    const r = resolveAnswer('Have you or do you currently work for a public agency or institution?', '', null, { profile: p, skills: [] }, true);
    expect(r.answer).toBeNull();
  });
});

describe('starting the job vs starting school', () => {
  it('never answers a job start question with when school started', () => {
    for (const q of ['When can you start the internship program?', 'When are you available to start working after your university term ends?']) {
      expect(resolveAnswer(q, '', null, { profile: profile(), skills: [] }, false).matchedKey, q).not.toBe('schoolStartDate');
    }
  });
});
