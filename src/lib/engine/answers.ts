// Maps a question to an answer from the profile. Ordered: the first definition
// whose pattern matches wins, so specific questions ("preferred first name",
// "require sponsorship") come before general ones ("first name", "country").
import type { Profile } from '../types';
import { todayISO } from '../clock';
import { startDateForPosting } from './availability';
import { locationPreferenceRank, type LocationPreference } from './locationPreferences';
import { DECLINE, degreeTiers, majorPreferenceTiers, normalize, questionSimilarity, RACE_SUBGROUPS, schoolVariants, US_STATES } from './text';

export interface AnswerContext {
  profile: Profile;
  /** Skills for the selected resume (falls back to profile skills). */
  skills: string[];
  jobTitle?: string;
  jobText?: string;
}

export type AnswerValue = string | string[];

export interface Answer {
  key: string;
  value: AnswerValue;
  /** 'low' answers are filled but flagged for review. */
  confidence: 'high' | 'low';
  /** Value is a date in YYYY-MM or YYYY-MM-DD form; format it for the field. */
  isDate?: boolean;
  /** Only use for choice-type fields (select/radio/combobox/buttons). */
  choiceOnly?: boolean;
  /** Spellings / fallbacks for choice fields, tried tier by tier. */
  tiers?: string[][];
  locationPreference?: LocationPreference;
  availabilityDate?: string;
}

interface Def {
  key: string;
  re: RegExp;
  not?: RegExp;
  value: (c: AnswerContext, label: string) => AnswerValue | null | undefined;
  confidence?: 'high' | 'low';
  isDate?: boolean;
  choiceOnly?: boolean;
  /** Only for typed answers; choice questions fall through to the next rule. */
  textOnly?: boolean;
  /**
   * Only match short labels. Long free-text questions often mention a keyword
   * in passing ("Share contributions with links (GitHub PRs…)"); those aren't
   * asking for your GitHub URL.
   */
  short?: boolean;
  tiers?: (c: AnswerContext, label: string) => string[][];
}

const SHORT_LABEL_WORDS = 9;

const latestJob = (p: Profile) => p.experience.find((e) => e.current) ?? p.experience[0];
const latestSchool = (p: Profile) => p.education[0];
const yesNo = (v: string) => v || null;

/** "Are you currently enrolled / a student / pursuing a degree?" */
function currentStudentAnswer(c: AnswerContext, label: string): string | null {
  const s = stillStudying(c.profile);
  if (s === null) return null;
  if (!s) return 'No';
  // "Are you enrolled full-time?" depends on your enrollment status.
  const load = label.match(/\b(full|part) time\b/)?.[1];
  if (load) {
    const status = normalize(c.profile.answers.enrollmentStatus);
    return status ? (status.startsWith(load) ? 'Yes' : 'No') : null;
  }
  // "Working towards a Master's or PhD?" is No for an undergraduate.
  const levels = label.match(/\b(?:bachelor|master|ph ?d|doctor|associate|mba)/g);
  if (!levels) return 'Yes';
  const degree = normalize(latestSchool(c.profile)?.degree ?? '');
  return levels.some((l) => degree.includes(l.replace(' ', '')) || (l === 'doctor' && /\bph ?d\b/.test(degree))) ? 'Yes' : 'No';
}

const declineIfBlank = (v: string) => v || DECLINE;
/** A race subgroup first (with its other spellings), then the broad category forms usually list. */
const raceTiers = (race: string): string[][] => {
  const subgroup = RACE_SUBGROUPS[normalize(race)];
  return subgroup ? [[race.trim(), ...subgroup.aliases], [subgroup.category]] : [];
};
const today = todayISO;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (iso?: string) => (iso ? MONTHS[Number(iso.split('-')[1]) - 1] ?? null : null);
/** Hourly pay from the profile; annual is 52 weeks × 40 hours × hourly. */
export function payExpectation(p: Profile): { hourly: number; annual: number } {
  const hourly = Number((p.answers.hourlyRate ?? '').replace(/[^\d.]/g, '')) || 0;
  return { hourly, annual: Math.round(hourly * 52 * 40) };
}
const asksAnnual = (label: string) => !/\b(?:hour|hourly|hr)\b/.test(label) && /\b(?:annual|annually|annualized|yearly|year|per annum)\b/.test(label);
const isUS = (country: string) => /^(united states|usa|us|u s|united states of america)$/.test(normalize(country));
const location = (p: Profile) => [p.personal.city, p.personal.state].filter(Boolean).join(', ');
export const fullName = (p: Profile) => p.personal.fullName.trim() || [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ');
const optTiers = (value: string): string[][] => value === 'N/A' ? [['N/A', 'Not applicable', 'Does not apply'], ['No']] : value ? [[value]] : [];

/** True when the question names a company from your experience ("…employed by Analytical Engines?"). */
/** True unless your veteran status says you aren't one (or is blank / declined). */
const isVeteran = (p: Profile) => {
  const status = normalize(p.eeo.veteranStatus);
  return !!status && !/\bnot\b|^no\b|decline|don t wish|prefer not|choose not/.test(status);
};

/** A job at a public university, school, or government body (it counts as "public agency or institution" work). */
const PUBLIC_EMPLOYER = /\buniversity\b|\bcollege\b|\bschool\b|\bgovernment\b|\bagency\b|\bdepartment of\b|\b(?:city|county|state) of\b|\bpublic\b|\bmunicipal|\bauthority\b|\bdistrict\b/;

function workedAt(p: Profile, label: string): boolean {
  return p.experience.some((x) => {
    const name = normalize(x.company).replace(/\b(inc|llc|ltd|co|corp|corporation|company|laboratories|labs)\b/g, '').trim();
    return name.length >= 3 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label);
  });
}

/** True when the question asks about having been a student at a school that is in your education. */
function studiedAt(p: Profile, label: string): boolean {
  if (!/\b(?:student|alumn\w*|attended|graduate of|studied)\b/.test(label)) return false;
  return p.education.some((e) => schoolVariants(e.school).some((v) => {
    const name = normalize(v);
    return name.split(' ').length >= 2 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label);
  }));
}

/** The language a single "Language" / proficiency question is about: English if listed, else the first. */
function primaryLanguage(p: Profile) {
  const langs = p.languages.filter((l) => l.language);
  return langs.find((l) => /english/i.test(l.language)) ?? langs[0];
}

/** Your major first; each fallback (e.g. Computer Science) only if the form has no option for it. */
export function majorTiers(p: Profile): string[][] {
  const ed = latestSchool(p);
  if (!ed?.major) return [];
  return majorPreferenceTiers(ed.major, ed.majorFallbacks);
}

function stillStudying(p: Profile): boolean | null {
  const end = latestSchool(p)?.end;
  if (!end) return null;
  return end >= today().slice(0, 7);
}

/** "Do you hold / have you held a clearance?" asks Yes/No (labels can be numbered: "6. Do you hold…"). */
const YES_NO_CLEARANCE = /^(?:\d+ )?(have|do|are|did|is|does|will|would|can)\b|\b(?:do|have|are|did) you (?:\w+ )?(?:hold|have|possess|held|had)\b/;

/** Order matters. Patterns run against normalize(label). */
const STATE_NAMES = [...Object.values(US_STATES), ...Object.keys(US_STATES)].join('|');
// "Are you a resident of California?" / "Do you live in CA?" / "Are you a California resident?"
const STATE_RESIDENCY = new RegExp(`\\b(?:resident (?:of|in)|(?:reside|residing|live|living) in) (?:the )?(?:state of )?(${STATE_NAMES})\\b|\\bare you an? (${STATE_NAMES}) resident\\b`);

/** Your profile says you hold no clearance. */
const hasNoClearance = (c: AnswerContext) => /^(none|no|n\/a|na|not applicable)$/i.test(c.profile.answers.securityClearance.trim());

/** A rule's answer for "leave this box empty" (don't fill it, don't flag it). */
export const LEAVE_EMPTY = '__leave_empty__';

/**
 * Language level for a fluent speaker: Native / Native speaker, then Fluent.
 * Scales without a Fluent level (Workday's "1 - Beginner ... 3 - Advanced")
 * fall back to their top level: Expert, then Advanced.
 */
export const LANGUAGE_LEVEL_TIERS = [['Native', 'Native speaker'], ['Fluent'], ['Expert'], ['Advanced']];

const DEFS: Def[] = [
  // "Which agency sponsored your clearance?" follows a clearance question; it's not visa sponsorship.
  {
    key: 'clearanceDetails',
    re: /\bclearances?\b.{0,80}\b(?:agency|agencies|sponsor\w*|issued|granted|adjudicat\w*)\b|\b(?:agency|agencies|sponsor\w*|issued|granted)\b.{0,80}\bclearances?\b/,
    value: (c) => (hasNoClearance(c) ? 'N/A' : null),
    tiers: (c) => (hasNoClearance(c)
      ? [['I do not possess an active security clearance', 'I do not have a security clearance', 'I do not have a clearance', 'No clearance', 'None', 'Not applicable', 'N/A'], ['No']]
      : []),
  },
  // "If yes, please specify which country" after a citizenship question you answered No.
  {
    key: 'otherCountryDetails',
    re: /^if (?:so|yes)\b.{0,60}\b(?:which|what|specify|list|name|indicate)\b.{0,40}\b(?:country|countries|citizenships?|nationalit(?:y|ies))\b/,
    value: (c) => (c.profile.answers.citizenship ? 'N/A' : null),
  },
  // Follow-ups that only apply after a "Yes": "If so, please provide the employee's name",
  // "If related, please provide name". With nothing to report they stay empty.
  {
    key: 'conditionalDetails',
    re: /^(?:.{0,200}\b)?(?:if (?:so|yes|related|applicable|you (?:answered|selected|checked|said) yes)|if you (?:were|are|have been) (?:referred|related|previously|formerly))\b/,
    // Only follow-ups about referrals, past employment here, or relatives; other
    // "if yes" boxes keep their own rules (e.g. offer details answer N/A).
    not: /^(?!.*(?:referr?|employ|worked|work(?:ing)? (?:for|at)|relat|family|relative))/,
    textOnly: true,
    value: (c, label) => {
      const a = c.profile.answers;
      if (/referr?/.test(label)) return a.referrerName.trim() || 'N/A';
      if (/relat|family|relative/.test(label)) return 'N/A';
      if (/employ|worked|work(?:ing)? (?:for|at)/.test(label)) return a.previouslyEmployed === 'Yes' ? null : LEAVE_EMPTY;
      return LEAVE_EMPTY;
    },
  },
  // Military spouse status is about your marriage, not your service or a relative working here.
  {
    key: 'militarySpouse',
    re: /military spouse|spouse of (?:a |an )?(?:\w+ ){0,2}(?:service ?member|military|veteran)|married to (?:a |an )?(?:member of (?:the )?)?(?:u s |us )?(?:military|armed forces|service ?member)/,
    choiceOnly: true,
    value: () => 'No',
  },
  // Any question about relatives, family, in-laws or a partner (working here, holding
  // a government post, "such a position", …) is always No, however it's worded.
  {
    key: 'relatedToEmployee',
    re: /\bfamily members?\b|\bimmediate family\b|\b(?:your|my|of|in) (?:immediate )?family\b|\brelatives?\b|\bin laws?\b|\bspouses?\b|\bdomestic partners?\b|\bsiblings?\b|\b(?:are|is) (?:you|any(?:one)?) (?:\w+ ){0,3}related\b|(?:related to|relationship (?:with|to)).{0,80}(?:employee|staff|director|officer|board member|manager|anyone|someone|member|person|individual|executive|official)|close personal relationship|know anyone (?:who )?(?:works|currently)|^related employees?\b/,
    not: /veteran|military|disabilit|emergency contact|family name|fmla|family (?:leave|medical)|parental|family friendly/,
    value: () => 'No',
  },
  // Details of your time at this company (SuccessFactors "Former Employee" block).
  {
    key: 'formerEmployeeDetails',
    re: /^(?:employment location|dates? of (?:prior |previous |former )?employment|name while employed|(?:former|previous|prior) (?:employee (?:id|number)|manager|supervisor|department|position|job title|work location))$/,
    textOnly: true,
    value: (c) => (c.profile.answers.previouslyEmployed === 'Yes' ? null : LEAVE_EMPTY),
  },
  { key: 'eventAttendance', re: /(?:able|available|willing|can you|could you|would you).{0,45}attend.{0,80}(?:event|hiring|both days)|(?:hiring event|recruiting event|recruitment event).{0,150}(?:able|available|willing).{0,20}attend/, choiceOnly: true, value: (c) => yesNo(c.profile.answers.eventAttendance) },
  { key: 'coursework', re: /\bcoursework\b|relevant courses|courses (?:taken|completed)/, not: /do you have|have you|any experience or/, value: (c) => latestSchool(c.profile)?.coursework || null },
  // Legal introductions can mention unrelated facts before the actual EEO prompt.
  { key: 'raceEthnicity', re: /please indicate your (?:race|ethnicity)|select your (?:race|ethnicity)/, value: (c) => declineIfBlank(c.profile.eeo.raceEthnicity), tiers: (c) => raceTiers(c.profile.eeo.raceEthnicity) },
  { key: 'veteranStatus', re: /protected veterans?/, value: (c) => declineIfBlank(c.profile.eeo.veteranStatus) },
  // Details of your service ("Newly Separated Veteran Discharge Date") only apply to
  // veterans: empty when you aren't one, left for you when you are.
  {
    key: 'veteranDetails',
    re: /\b(?:discharge|separation|release from (?:active )?duty) date\b|\bdate of (?:discharge|separation)\b|\bbranch of (?:service|the military)\b|\bdates? of (?:military )?service\b/,
    value: (c) => (isVeteran(c.profile) ? null : LEAVE_EMPTY),
  },
  { key: 'unlistedReferencesConsent', re: /(?:consent|authoriz|contact).{0,60}unlisted references|contact references.{0,60}not listed/, choiceOnly: true, value: (c) => yesNo(c.profile.answers.unlistedReferencesConsent) },
  {
    key: 'fullName',
    // Certification paragraphs can mention conflicts, government work or
    // agreements. A request to type a name takes priority over those topics.
    re: /\b(?:type|typing|enter|print|sign|provide|write) (?:in )?(?:your|my|the applicant s) (?:(?:full|legal) )*name\b|\b(?:typed|electronic|digital) signature\b/,
    not: /signature date|date (?:of|for) (?:your )?(?:electronic |digital )?signature/,
    value: (c) => fullName(c.profile),
  },
  {
    key: 'locationPreference',
    re: /(?:locations?|offices?|cities).{0,50}(?:prefer|interested)|prefer(?:red|ence)?.{0,40}(?:locations?|offices?|cities)|(?:first|second|third|\d+(?:st|nd|rd|th)?) choice.{0,20}(?:office|location)|where .{0,40}(?:prefer|like|want).{0,20}(?:work|be based)/,
    not: /work for you|acceptable|suitable|residen|address|statement|acknowledg|declaration/,
    value: (c) => c.profile.answers.locationPreferences.join(', ') || null,
  },
  {
    key: 'sponsorshipDetails',
    re: /(?:context|details|explain|describe|additional information).*(?:immigration|sponsor)|(?:immigration|sponsor).*(?:context|details|explain|describe|additional information)/,
    not: /describes your (?:current )?(?:citizenship|immigration|residency) status/,
    value: (c) => c.profile.answers.sponsorshipDetails || (c.profile.answers.needsSponsorship === 'No' ? 'N/A' : null),
  },
  // "Authorized to work … without requiring sponsorship?" asks both at once: Yes only
  // when you're authorized and don't need sponsorship.
  {
    key: 'workAuthorizedWithoutSponsorship',
    re: /^(?=.*\b(?:work|working|employment|employed|authori[sz]\w*|eligib\w*)\b)(?=.*\b(?:without|with no|not requiring|no need for)\b (?:\w+ ){0,4}(?:sponsor|visa|immigration))/,
    value: (c) => {
      const { workAuthorized, needsSponsorship } = c.profile.answers;
      if (workAuthorized === 'No' || needsSponsorship === 'Yes') return 'No';
      return workAuthorized === 'Yes' && needsSponsorship === 'No' ? 'Yes' : null;
    },
  },
  // "This position requires U.S. citizenship; do you meet this qualification?" is a Yes/No.
  {
    key: 'usCitizenshipRequired',
    re: /(?:requires?|required|must (?:be|have|hold)|requirement).{0,40}\b(?:u s|us|united states|american) citizen(?:ship)?\b|\b(?:u s|us|united states|american) citizen(?:ship)?\b.{0,40}\b(?:is )?(?:required|requirement|qualification)/,
    value: (c) => (c.profile.answers.citizenship ? (isUS(c.profile.answers.citizenship) ? 'Yes' : 'No') : null),
  },
  // Sponsorship examples may mention OPT; answer the sponsorship question itself.
  // "Will you require employer support to obtain … authorization to work?" is sponsorship too.
  { key: 'needsSponsorship', re: /sponsor|visa (status|support)|h ?1 ?b|immigration (case|support)|\b(?:require|need)\w*\b.{0,40}\b(?:support|assistance|help)\b.{0,60}\b(?:authori[sz]\w*|work permits?|visas?|immigration)\b/, value: (c) => yesNo(c.profile.answers.needsSponsorship) },
  {
    key: 'stemOptEligible',
    re: /\b(?:opt|optional practical training)\b.*(?:extension|extend|eligib|qualif)|(?:extension|extend|eligib|qualif|24 month|degree).*\b(?:opt|optional practical training)\b/,
    not: /\bopt (?:in|out)\b/,
    value: (c) => c.profile.answers.stemOptEligible || null,
    tiers: (c) => optTiers(c.profile.answers.stemOptEligible),
  },
  {
    key: 'internationalStudent',
    re: /\bare you (?:currently )?(?:an? )?international student\b|\binternational student status\b|\b(?:are you )?(?:currently )?(?:on|hold(?:ing)?) an? (?:(?:f 1|j 1)(?: student)?|student) visa\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.internationalStudent),
  },
  {
    key: 'optStatus',
    re: /\boptional practical training\b|\bopt\b/,
    not: /\bopt (?:in|out)\b/,
    value: (c) => c.profile.answers.optStatus || null,
    tiers: (c) => optTiers(c.profile.answers.optStatus),
  },
  {
    key: 'travelPercentage',
    re: /(?:willing|able|available|availability|how much|percentage|percent|amount).{0,60}\btravel\b|\btravel\b.{0,60}(?:percentage|percent|willing|availability)|^travel(?: required| preference)?$/,
    value: (c) => c.profile.answers.travelPercentage || null,
    // A Yes/No dropdown ("Are you willing to travel?") gets Yes, or No when you'd travel none.
    tiers: (c) => {
      const t = c.profile.answers.travelPercentage.trim();
      if (!t) return [];
      return [[t], [/^(?:0\s*%?|none|no travel|no)$/i.test(t) ? 'No' : 'Yes']];
    },
  },
  // Explicit application preferences come before general terms/phone/address rules.
  {
    key: 'phoneTextConsent',
    re: /(?:consent|agree|authoriz[es]|authorization|permission|opt in|allow).*(?:sms|text(?:ing| messages?)?|telephone calls?|phone calls?|calls and|calls or)|(?:sms|text(?:ing| messages?)?|telephone calls?|phone calls?).*(?:consent|opt in|permission)/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.phoneTextConsent),
  },
  // "We may use automated tools such as AI to review your application… you can opt out."
  {
    key: 'aiReviewConsent',
    re: /^(?=.*\b(?:ai|artificial intelligence|automated (?:tools?|systems?|decision making|processing|screening|technolog\w*))\b)(?=.*\b(?:opt ?out|opt ?in|consent|prefer not|permission|allow)\b)(?=.*\b(?:application|candidac\w*|review\w*|screen\w*|process\w*)\b)/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.aiReviewConsent),
    tiers: (c) => c.profile.answers.aiReviewConsent === 'No'
      ? [['No'], ['I opt out', 'Opt out', 'I would like to opt out', 'Decline']]
      : c.profile.answers.aiReviewConsent === 'Yes'
        ? [['Yes'], ['I consent', 'I agree', 'I accept', 'Consent', 'Agree', 'Accept', 'Allow', 'Opt in']]
        : [],
  },
  // "We may consider your application for other roles… opt out below." Being considered for more roles only helps.
  {
    key: 'otherRolesConsent',
    re: /\b(?:consider|match)\w* (?:your )?(?:application|profile|candidacy)\b.{0,80}\b(?:additional|other|future|further) (?:opportunit\w*|roles?|positions?|openings?|jobs?)\b(?=.*\bopt ?(?:out|in)\b)/,
    choiceOnly: true,
    value: () => 'Yes',
    tiers: () => [['Yes'], ['Opt in', 'I consent', 'I agree', 'Allow']],
  },
  // Email about your application is how most employers reach you.
  {
    key: 'emailContactConsent',
    re: /(?:consent|agree|opt in|permission|may we|can we|okay to|ok to|allow us).{0,40}(?:contacted|contact|communicat|reach|email you).{0,40}\be ?mail\b|\be ?mail\b.{0,40}(?:consent|opt in)|(?:may we|can we) e ?mail you/,
    not: /marketing|newsletter|promotional/,
    choiceOnly: true,
    value: () => 'Yes',
  },
  // Fired / asked to resign, or disciplined by a regulator or licensing board (accounting
  // and finance firms ask these). Not driving: a suspended driver's license is a different question.
  {
    key: 'disciplinaryHistory',
    re: /\bhave you (?:ever )?been (?:\w+ ){0,3}(?:discharged|terminated|fired|dismissed|let go)\b|\binvoluntarily (?:discharged|terminated)\b|\bunder investigation by your (?:current )?employer\b|\basked to resign\b|\bresign(?:ed)? (?:in lieu of|after being (?:offered|given|asked))|\bseparated by mutual agreement\b|\blicen[cs]es?\b.{0,120}\b(?:revoked|suspended|surrendered|cancell?ed|disciplined|reprimanded|sanctioned|investigated)\b|\b(?:revoked|suspended|surrendered)\b.{0,60}\blicen[cs]es?\b|\b(?:subject of|party to)\b.{0,40}\b(?:pending )?(?:action|investigation|proceeding|complaint)s?\b.{0,80}\b(?:regulat\w*|licensing board|sec|finra|pcaob|irs)\b|\bconsent (?:decree|order)\b/,
    not: /driv(?:er s|ers|ing|er) ?licen[cs]e|\bwilling\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.disciplinaryHistory),
  },
  {
    key: 'fiduciaryRoles',
    re: /\b(?:hold|serve|serving|named|appointed|acting)\b.{0,80}\b(?:board member|member of (?:a|the|any) board|board of directors|trustee|trust protector|executor|executrix|personal representative|fiduciary)\b/,
    not: /relat|family|spouse/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.fiduciaryRoles),
  },
  // "Is your current employer a <company> client?" is certainly No when you have no current job.
  {
    key: 'currentEmployerClient',
    re: /\bcurrent (?:employer|company)\b.{0,40}\b(?:client|customer)\b|\b(?:client|customer)\b.{0,30}\bcurrent employer\b/,
    choiceOnly: true,
    value: (c) => (c.profile.experience.length && !c.profile.experience.some((x) => x.current) ? 'No' : yesNo(c.profile.answers.currentEmployerClient)),
  },
  {
    key: 'governmentDebarment',
    re: /debarred|debarment|suspend(?:ed|sion).*(?:government|federal|contracting)|(?:government|federal|contracting).*suspend(?:ed|sion)/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.governmentDebarment),
  },
  {
    key: 'governmentConsulting',
    re: /(?:retained|engaged|consultant|consulting|support contractor).*(?:u s government|united states government|federal government)|(?:u s government|united states government|federal government).*(?:retained|engaged|consultant|consulting|support contractor)/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.governmentConsulting),
  },
  {
    key: 'stateResidency',
    re: STATE_RESIDENCY,
    choiceOnly: true,
    value: (c, label) => {
      const home = normalize(c.profile.personal.state);
      if (!home) return null;
      const m = label.match(STATE_RESIDENCY);
      const asked = m?.[1] ?? m?.[2] ?? '';
      return (US_STATES[asked] ?? asked) === (US_STATES[home] ?? home) ? 'Yes' : 'No';
    },
  },
  { key: 'governmentRelationshipDetails', re: /if yes.{0,40}(?:entity|government).{0,40}(?:role|name)|(?:name of the government entity|their relationship to you|their position job title)/, value: (c) => c.profile.answers.governmentOfficial === 'No' ? 'N/A' : null },
  {
    key: 'foreignResidency',
    re: /are you a resident of (?:mainland china|any european country|the united kingdom|china|canada|japan|south korea)/,
    choiceOnly: true,
    value: (c) => isUS(c.profile.personal.country) ? 'No' : null,
  },
  {
    // "Have you held citizenship in any of the countries listed above?" (export-control lists).
    // Your one citizenship is either named in the list or it isn't. The US is never on a
    // restricted list, so a mention like "U.S. export control laws" doesn't count.
    key: 'listedCountriesCitizenship',
    re: /\b(?:citizen(?:ship)?s?|nationals?|nationality|permanent resid\w*)\b.{0,60}\b(?:countries|country|nations) (?:listed|above|below|mentioned|shown)\b|\b(?:listed|above|below|following) (?:countries|nations)\b.{0,80}\b(?:citizen|national)/,
    value: (c, label) => {
      const citizenship = normalize(c.profile.answers.citizenship);
      if (!citizenship) return null;
      if (isUS(citizenship)) return /export|sanction|embargo|restrict/.test(label) || !/\b(?:united states|usa|america)\b/.test(label) ? 'No' : null;
      return new RegExp(`\\b${citizenship.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label) ? null : 'No';
    },
  },
  {
    // Export-control / "U.S. person" / citizenship-status lists: pick the US-citizen option.
    key: 'usPersonStatus',
    re: /export control|\bu s person\b|\bitar\b|\bear\b.{0,40}\b(?:regulat|export)|citizenship status|immigration status|(?:describes|is) your (?:current )?(?:citizenship|immigration|residency|work authori[sz]ation) status/,
    choiceOnly: true,
    value: (c) => (isUS(c.profile.answers.citizenship) ? 'United States citizen' : null),
    // Yes/No lists ("Are you a U.S. person?") take Yes last.
    tiers: (c) => (isUS(c.profile.answers.citizenship) ? [['A United States citizen or national', 'United States citizen', 'U.S. citizen', 'US citizen'], ['U.S. person', 'US person', 'Citizen'], ['Yes']] : []),
  },
  // --- Yes/no eligibility questions (before location/country patterns) ---
  {
    key: 'workAuthorized',
    re: /authori[sz](ed|ation)? to work|work authori[sz]ation|legally (authorized|eligible|permitted|able)|eligib(le|ility) to work|right to work|legal right\b.{0,60}\bto work\b|permitted to work|lawfully/,
    value: (c) => yesNo(c.profile.answers.workAuthorized),
  },
  { key: 'usCitizen', re: /(are you )?(a )?(us|u s|united states|american) citizen/, value: (c) => (c.profile.answers.citizenship ? (isUS(c.profile.answers.citizenship) ? 'Yes' : 'No') : null) },
  // "Citizen of any country other than the U.S.?" / dual citizenship: your profile lists one citizenship.
  {
    key: 'otherCitizenships',
    re: /citizen(?:ship)? (?:of|in) (?:any |a |another )?(?:other )?(?:country|countries|nation|nations)(?: other than| besides| apart from| outside)?|dual (?:citizen|national)|other citizenships?|additional citizenships?|multiple citizenships?|more than one (?:citizenship|country)/,
    // "What other country are you a citizen of?" wants a country, so with none it's N/A.
    value: (c, label) => (c.profile.answers.citizenship ? (/\b(?:what|which|list|name|specify)\b/.test(label) ? 'N/A' : 'No') : null),
  },
  {
    // "Are you a Singapore citizen?" / "…permanent resident of Canada?" for a country you're not from.
    key: 'otherCitizenship',
    re: /are you an? ([a-z ]{3,30}) (citizen|national|permanent resident)|(citizen|permanent resident) of ([a-z ]{3,30})/,
    value: (c, label) => {
      const { citizenship } = c.profile.answers;
      if (!citizenship) return null;
      const m = label.match(/are you an? ([a-z ]{3,30}) (?:citizen|national|permanent resident)|(?:citizen|permanent resident) of (?:the )?([a-z ]{3,30})/);
      const country = (m?.[1] ?? m?.[2] ?? '').trim();
      if (!country) return null;
      const same = isUS(country) ? isUS(citizenship) : normalize(citizenship).includes(country) || country.includes(normalize(citizenship));
      return same ? 'Yes' : 'No';
    },
    confidence: 'low',
  },
  {
    key: 'backgroundCheck',
    re: /\b(?:willing|agree|consent|able|submit)\b.{0,40}\b(?:background|drug|pre employment|reference) (?:check|screen|screening|test|investigation)s?\b|\b(?:background|drug) (?:check|screen|screening|test)s?\b.{0,40}\b(?:willing|agree|consent)\b/,
    choiceOnly: true,
    value: () => 'Yes',
  },
  {
    // "Can you provide verification of your identity upon hire?" (Workday spells it "identify").
    key: 'identityVerification',
    re: /\b(?:provide|submit|present|show|produce)\b.{0,40}\b(?:verification|proof|documentation|documents?)\b.{0,20}\b(?:of )?(?:your )?(?:identity|identify)\b|\bverify (?:your )?(?:identity|identify)\b/,
    choiceOnly: true,
    value: () => 'Yes',
  },
  {
    key: 'essentialFunctions',
    re: /\b(?:perform(?:ing)?|able to do|carry(?:ing)? out)\b.{0,30}\bessential (?:functions|duties|job functions)\b/,
    // Legal boilerplate in an acknowledgement ("…your ability to perform the essential functions…").
    not: /\backnowledg|\bi certify\b/,
    choiceOnly: true,
    value: () => 'Yes',
  },
  { key: 'citizenship', re: /citizenship|country of citizenship|nationality/, value: (c) => c.profile.answers.citizenship || null },
  { key: 'willingToRelocate', re: /relocat/, value: (c) => yesNo(c.profile.answers.willingToRelocate) },
  {
    key: 'workScheduleAvailable',
    re: /^(?=.*\b(?:availability|available|able|willing|can you|could you|commit|capable)\b)(?=.*\b(?:work|working|employment|employed|job|internship|program|placement|position|role|summer)\b)(?=.*\b(?:hours?|hrs?|weeks?|months?|full time|part time|schedule|shifts?)\b)/,
    not: /\b(?:how many|how much|which|what|describe|list|specify|provide)\b|\b(?:unavailable|unable|cannot|can t|not available|not able)\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.workScheduleAvailable),
  },
  {
    key: 'officeLocationWorks',
    re: /\b(?:location|office|rto|return to office|on ?site|hybrid|in person)\b.{0,100}(?:work for you|work with your|acceptable|suitable|(?:ok|okay) for you)|(?:comfortable|willing|able to (?:work|commute|attend|meet)|can you (?:work|commute|attend|meet)|meet the).{0,100}\b(?:location|office|rto|return to office|on ?site|hybrid|in person)\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.officeLocationWorks),
  },
  {
    key: 'driversLicense',
    re: /driv(?:er s|ers|ing|er) ?licen[cs]e|licensed driver|valid (?:driver|driving)\b|(?:car|vehicle|motor) licen[cs]e/,
    value: (c) => yesNo(c.profile.answers.driversLicense),
  },
  // "Do you have a valid Insurance License?" A Yes default can't tell which license you hold, so it's left for you.
  {
    key: 'professionalLicense',
    re: /\b(?:do|does) you (?:currently )?(?:have|hold|possess)\b.{0,60}\blicen[cs]e[sd]?\b|\bare you (?:currently )?(?:licensed|a licensed)\b/,
    not: /\b(?:willing|able to|obtain|get|acquire|pursue|plan|require|need)\b/,
    choiceOnly: true,
    value: (c) => (c.profile.answers.professionalLicense === 'No' ? 'No' : null),
  },
  { key: 'over18', re: /18 (years|or older)|at least 18|over (the age of )?18|age of 18|legal (working )?age|of legal age/, value: (c) => yesNo(c.profile.answers.over18) },
  // "Are you currently employed?" is your employment status, not whether you work here.
  {
    key: 'currentlyEmployed',
    re: /^(?:are you )?(?:currently |presently )?(?:employed|working)(?: (?:full time|part time|anywhere|at the moment|right now))?$|^(?:current )?employment status$/,
    choiceOnly: true,
    value: (c) => (c.profile.experience.length ? (c.profile.experience.some((x) => x.current) ? 'Yes' : 'No') : null),
  },
  // "Have you ever been employed under any other name?" asks about aliases, not this company.
  {
    key: 'otherNames',
    re: /\b(?:employed|worked|known|gone|go) (?:under|by) (?:any |an )?(?:other|another|different|former|previous|prior) names?\b|\b(?:other|previous|prior|former) names? (?:used|you have used)\b|\bmaiden name\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.otherNames),
  },
  {
    key: 'previouslyEmployed',
    re: /(previously|ever|before) (been )?(employed|worked)|(employed|worked) (by|for|at|with) .{0,40}(before|previously|in the past)|former employee|current or former|(?:currently|formerly|previously)(?: or (?:currently|formerly|previously))? (?:employed|working)\b|have you (ever )?worked (for|at)|(contingent|contract) work(er)?|contractor (for|at|with)|been a contractor|(?:currently|formerly|previously).{0,80}\b(?:independent contractor|contract labor|contingent worker|consultant)\b|\b(?:do|are) you (?:currently |presently |now )?work(?:ing)? (?:for|at)\b|\bare you an? (?:current|existing|former|past|previous)\b.{0,50}\bemployee/,
    not: /government|public official|public (?:agenc|institution|sector)|willing|able to|relatives?\b|family members?|related to|(?:towards?|pursuing|enrolled in|studying for)\b.{0,40}\bdegree/,
    // "…or were you previously associated with the University as a student?" is Yes only for your own school.
    value: (c, label) => (workedAt(c.profile, label) || studiedAt(c.profile, label) ? 'Yes' : yesNo(c.profile.answers.previouslyEmployed)),
    // Company-list dropdowns ("select the most recent … company, or none") take None.
    // Only when the question asks you to pick a company from a list; plain Yes/No questions just get No.
    tiers: (c, label) => (workedAt(c.profile, label) || c.profile.answers.previouslyEmployed !== 'No' || !/\b(?:select|choose|pick|which)\b|\bnone\b/.test(label) ? [] : [['None', 'None of the above', 'N/A', 'Not applicable'], ['No']]),
  },
  // "Have you or do you currently work for a public agency or institution?" A public
  // university job counts, so any school or government employer leaves it for you.
  {
    key: 'publicAgencyEmployment',
    re: /\bwork(?:ed|ing)? (?:for|at|in) (?:a |an |any )?public (?:agenc|institution|sector|entit|bod)/,
    not: /relat|family|spouse/,
    choiceOnly: true,
    value: (c) => (c.profile.experience.some((x) => PUBLIC_EMPLOYER.test(normalize(x.company))) ? null : yesNo(c.profile.answers.governmentOfficial)),
  },
  {
    key: 'governmentOfficial',
    // Includes past government / Department of Defense employment ("post-government employment", DoD Section 847).
    re: /public official|government (official|entity|employee|agency)|politically exposed|foreign official|state.owned|(?:employed|worked) (?:by|for) (?:a |the |any )?(?:(?:u s|us|federal|united states|state|local|foreign|or|and) )*government|post government employment|department of defen[cs]e|\bdod\b|(?:official|employee) of (?:the )?(?:u s |us |federal )?(?:government|armed forces)/,
    value: (c) => yesNo(c.profile.answers.governmentOfficial),
  },
  // "If you join, will you also be involved in any other jobs, business investments, board
  // memberships…?" Keeping a current job is exactly that, so with one it's left for you.
  {
    key: 'otherCommitments',
    re: /\b(?:also|continue to) be (?:involved|engaged) in\b.{0,30}\b(?:other|outside|additional) (?:jobs?|employment|business)|\bother jobs?\b.{0,60}\b(?:business investments?|board memberships?|political positions?)/,
    choiceOnly: true,
    value: (c) => (c.profile.experience.some((x) => x.current) ? null : yesNo(c.profile.answers.conflictOfInterest)),
  },
  // Having awarded or overseen this company's work (as a client or public official) is a conflict of interest.
  {
    key: 'conflictOfInterest',
    re: /\bawarded\b.{0,40}\b(?:work|contracts?)\b|\bawarding\b.{0,20}\b(?:work|contracts?)\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.conflictOfInterest),
  },
  { key: 'conflictOfInterest', re: /conflicts? of interest|outside (business|employment) (activit|interest)|outside employment|secondary employment|moonlighting|(?:will|would) you (?:also |continue to )?(?:perform|do|engage in|provide) (?:any )?(?:work|services)\b.{0,60}\b(?:other|another|outside) (?:company|companies|employer|entity|entities|organi[sz]ation)/, value: (c) => yesNo(c.profile.answers.conflictOfInterest) },
  {
    key: 'meetsRequirements',
    re: /(minimum|basic|required|stated|listed|job|position|role) (qualifications|requirements)|meet (all |the )?(qualifications|requirements)|qualif(y|ied) for (this|the) (role|position|job)|meet (the )?minimum (years|amount|level) of experience/,
    value: (c) => yesNo(c.profile.answers.meetsRequirements),
  },
  {
    key: 'appliedBefore',
    re: /(have you|did you) (previously |ever )?appl(y|ied) (to|for|with|at)|applied .{0,40}(within|in) the (past|last)|previously applied/,
    value: (c) => yesNo(c.profile.answers.appliedBefore),
  },
  {
    key: 'agreeToTerms',
    re: /i (have read|agree|acknowledge|accept|understand)|terms (and|&) conditions|privacy (policy|notice|agreement|statement)|code of conduct|data privacy|by submitting|i certify|attest|confirm (that )?(everything|all|the information)|(information|answers?) .{0,40}(true|accurate) and|\b(statement|acknowledg(e)?ment|declaration)\b/,
    not: /marketing|newsletter|sms|text messages|promotional|future (job )?opportunit|talent (community|network)|personal statement|statement of (interest|purpose)|financial statement|bank statement|disabilit|veteran|\brace\b|ethnic|gender|which statement|best describes|approach to/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.agreeToTerms),
  },
  { key: 'nonCompete', re: /non ?compete|restrictive covenant|non ?solicit|agreements? not to (?:compete|solicit)|\brestrictions?\b.{0,30}\b(?:former|previous|prior|current) employer|\b(?:former|previous|prior|current) employer\b.{0,40}\brestrict/, value: (c) => yesNo(c.profile.answers.nonCompete) },
  {
    key: 'locatedInUS',
    re: /(currently )?(located|based|reside|residing|living|live) in (the )?(us|u s|united states|usa)\b/,
    value: (c) => (c.profile.personal.country ? (isUS(c.profile.personal.country) ? 'Yes' : 'No') : null),
  },
  // Being able / willing to obtain a clearance is about eligibility (citizenship), not one you hold now.
  {
    key: 'clearanceEligible',
    re: /\b(?:able|eligible|willing|ability|eligibility|can you|could you|would you)\b(?: \w+){0,5} (?:obtain|get|acquire|receive|maintain|be granted|apply for|undergo)\b.{0,60}\bclearances?\b|\bclearances?\b.{0,60}\b(?:eligible|eligibility|obtain|obtainable)\b/,
    value: (c, label) => {
      if (/\bwilling\b/.test(label) && !/\b(?:able|eligib)/.test(label)) return 'Yes';
      return c.profile.answers.citizenship ? (isUS(c.profile.answers.citizenship) ? 'Yes' : null) : null;
    },
  },
  {
    key: 'securityClearance',
    re: /security clearance|active clearance|\bclearance\b/,
    value: (c, label) => {
      const clearance = c.profile.answers.securityClearance.trim();
      if (!clearance) return null;
      const none = /^(none|no|n\/a|na|not applicable)$/i.test(clearance);
      // Yes/no phrasing ("Have you held an active clearance…?") gets Yes/No; otherwise the level itself.
      // Labels can be numbered ("6. Do you hold…").
      if (YES_NO_CLEARANCE.test(label)) return none ? 'No' : 'Yes';
      return clearance;
    },
    // Yes/No dropdowns without yes/no phrasing ("Security clearance": Yes / No).
    tiers: (c, label) => {
      const clearance = c.profile.answers.securityClearance.trim();
      if (!clearance || YES_NO_CLEARANCE.test(label)) return [];
      return /^(none|no|n\/a|na|not applicable)$/i.test(clearance)
        ? [['None', 'No clearance', 'I do not have a clearance', 'Not applicable'], ['No']]
        : [[clearance], ['Yes']];
    },
  },
  {
    key: 'currentStudent',
    re: /currently (enrolled|a student|pursuing)|are you a (current )?student|(?:working|studying) (?:towards?|on) (?:a |an |your )?(?:\w+ ){0,5}degree|pursuing (?:a |an )?(?:\w+ ){0,5}degree/,
    // "What type of degree program are you currently enrolled in?" asks which degree, not whether you study.
    not: /\b(?:what|which)\b.{0,30}\b(?:type|kind|level)\b.{0,30}\bdegree\b|\bdegree (?:program )?(?:type|level)\b/,
    value: currentStudentAnswer,
    // Full-time / Part-time / Not attending option lists answer with your enrollment status.
    tiers: (c, label) => {
      const s = stillStudying(c.profile);
      if (currentStudentAnswer(c, label) !== (s ? 'Yes' : 'No')) return [];
      if (s === false) return [['Not attending', 'Not enrolled', 'Not currently enrolled'], ['No']];
      if (!s) return [];
      const status = c.profile.answers.enrollmentStatus;
      const tiers = status
        ? [status === 'Part-time' ? ['Part-time', 'Part time', 'Yes, part-time'] : ['Full-time', 'Full time', 'Yes, full-time'], ['Yes']]
        : [['Yes']];
      // "You must be currently pursuing a degree…" with Bachelors / Masters / Doctorate as the
      // choices (Workday): the degree you're working towards. Never when the question names a level.
      const pursuing = c.profile.answers.pursuingDegree;
      if (pursuing && !/\b(?:bachelor|master|ph ?d|doctor|associate|mba)/.test(label)) tiers.push(...degreeTiers(pursuing));
      return tiers;
    },
  },

  // --- EEO (blank profile answer → "decline to answer") ---
  {
    key: 'hispanicLatino',
    re: /hispanic|latin[oax]/,
    not: /race and ethnicity|race ethnicity|^race$/,
    choiceOnly: true,
    value: (c) => {
      const { hispanicLatino, raceEthnicity } = c.profile.eeo;
      if (hispanicLatino) return hispanicLatino;
      if (!raceEthnicity) return DECLINE;
      return /hispanic|latin/i.test(raceEthnicity) ? 'Yes' : 'No';
    },
  },
  { key: 'transgender', re: /transgender|trans experience|cisgender/, choiceOnly: true, value: (c) => declineIfBlank(c.profile.eeo.transgender) },
  { key: 'sexualOrientation', re: /sexual orientation|lgbt|queer/, choiceOnly: true, value: (c) => declineIfBlank(c.profile.eeo.sexualOrientation) },
  { key: 'raceEthnicity', re: /\brace\b|ethnic/, choiceOnly: true, value: (c) => declineIfBlank(c.profile.eeo.raceEthnicity), tiers: (c) => raceTiers(c.profile.eeo.raceEthnicity) },
  { key: 'gender', re: /gender|\bsex\b/, choiceOnly: true, value: (c) => declineIfBlank(c.profile.eeo.gender) },
  { key: 'veteranStatus', re: /veteran|military|armed forces|uniformed service/, choiceOnly: true, value: (c) => declineIfBlank(c.profile.eeo.veteranStatus) },
  {
    key: 'disability',
    re: /disabilit|^disabled(?: status| yes no)?$|^are you disabled/,
    choiceOnly: true,
    value: (c) => declineIfBlank(c.profile.eeo.disability),
    // Short Yes/No lists ("Disabled": Yes / No) don't repeat the long wording.
    tiers: (c) => {
      const d = c.profile.eeo.disability;
      if (/^no\b/i.test(d)) return [[d], ['No', 'Not disabled', 'I do not have a disability']];
      if (/^yes\b/i.test(d)) return [[d], ['Yes', 'Disabled']];
      return [];
    },
  },

  // --- Names ---
  { key: 'preferredName', short: true, re: /preferred (first )?name|nick ?name|goes by|name you (prefer|go by)|chosen name/, value: (c) => c.profile.personal.preferredName || c.profile.personal.firstName },
  { key: 'middleName', short: true, re: /middle (name|initial)/, value: (c) => c.profile.personal.middleName || null },
  { key: 'firstName', short: true, re: /first name|given name|forename|^first$|legal first/, value: (c) => c.profile.personal.firstName },
  { key: 'lastName', short: true, re: /last name|family name|surname|^last$|legal last/, value: (c) => c.profile.personal.lastName },
  {
    key: 'fullName',
    short: true,
    re: /^(your |full |legal |candidate |applicant |applicants )*name$|full (legal )?name|legal name|^name first and last|^(your )?signature$|electronic signature|sign your name|^name of (the )?(candidate|applicant)$/,
    value: (c) => fullName(c.profile),
  },
  { key: 'pronouns', short: true, re: /\bpronouns?\b/, value: (c) => c.profile.personal.pronouns || null },

  // --- Contact ---
  { key: 'universityEmail', re: /(?:university|college|school|academic|student|campus).{0,25}e ?mail/, value: (c) => c.profile.personal.universityEmail || (/\.edu(?:\.[a-z]+)?$/i.test(c.profile.personal.email) ? c.profile.personal.email : null) },
  { key: 'email', short: true, re: /e ?mail/, not: /marketing|newsletter|receive|subscribe|opt.?in|updates/, value: (c) => c.profile.personal.email },
  { key: 'phoneCountryCode', re: /(country|phone|dial(ing)?) code|country calling/, choiceOnly: true, value: (c) => c.profile.personal.country || c.profile.personal.phoneCountryCode || null },
  { key: 'phoneType', re: /phone (device )?type|type of phone/, choiceOnly: true, value: () => 'Mobile' },
  // Extensions stay blank; the number goes only in the number field.
  { key: 'phoneExtension', re: /\bext(ension)?\b|\bext\b/, value: () => null },
  { key: 'phone', short: true, re: /phone|mobile|cell|telephone|contact number/, not: /\bext(ension)?\b|country (phone )?code|device type|phone type/, value: (c) => c.profile.personal.phone },
  { key: 'addressLine2', short: true, re: /address line 2|apartment|\bapt\b|suite|unit number/, value: (c) => c.profile.personal.addressLine2 || null },
  { key: 'street', short: true, re: /street|address line 1|^address( 1)?$|home address|mailing address|street address|residential address/, value: (c) => c.profile.personal.street || null },
  { key: 'zip', short: true, re: /zip|postal|post code|postcode/, value: (c) => c.profile.personal.zip || null },
  { key: 'city', short: true, re: /^city\b|\bcity$|city town|town city|location city/, value: (c) => c.profile.personal.city || null },
  { key: 'state', short: true, re: /\b(state|province|region)\b/, not: /united states|statement|state your/, value: (c) => c.profile.personal.state || null },
  { key: 'country', short: true, re: /\bcountry\b/, value: (c) => c.profile.personal.country || null },
  {
    key: 'location',
    re: /^(current )?location$|where are you (currently )?(located|based)|current (city|location)|city and state|location of residence|where do you live/,
    value: (c) => location(c.profile) || null,
  },

  // --- Links ---
  { key: 'linkedin', short: true, re: /linked ?in/, value: (c) => c.profile.links.linkedin || null },
  { key: 'github', short: true, re: /git ?hub/, value: (c) => c.profile.links.github || null },
  { key: 'twitter', short: true, re: /twitter|^x$|\bx profile|x com/, value: (c) => c.profile.links.twitter || null },
  { key: 'portfolio', short: true, re: /portfolio/, value: (c) => c.profile.links.portfolio || c.profile.links.website || null },
  { key: 'otherUrl', short: true, re: /other (website|url|link)|additional (link|url)/, value: (c) => c.profile.links.other || c.profile.links.website || null },
  { key: 'website', short: true, re: /website|personal (site|url|page)|blog|^url$|home ?page|web ?site|^link$/, value: (c) => c.profile.links.website || c.profile.links.portfolio || null },

  // --- Work & education ---
  {
    key: 'academicYear',
    re: /\b(?:current|academic|class|college|university|school) year\b|\byear (?:of|in) (?:your )?(?:study|studies|school|college|university|degree|education)\b|\byear (?:are|will) you\b.{0,30}\b(?:college|university|school|study|studies|program)\b|\b(?:class|student|academic) (?:standing|classification)\b|\b(?:level of education|education level)\b.*\b(?:during|semester|fall|spring|summer|winter|current)\b/,
    not: /\bgraduat(?:ion|e) (?:date|year)|high school|start date|end date/,
    value: (c) => c.profile.answers.academicYear || null,
  },
  // "Do you have a high school degree or GED?" is a Yes/No, not your highest degree.
  {
    key: 'highSchoolDiploma',
    re: /\b(?:do|did|have|are) you\b.{0,60}\b(?:high school|secondary school|ged|hiset)\b/,
    not: /\b(?:year|date|when|gpa|name|which|what)\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.highSchoolDiploma),
  },
  { key: 'highSchoolGraduationYear', re: /high school.*(?:graduat|completion)|(?:graduat|completion).*high school/, value: (c) => c.profile.answers.highSchoolGraduationYear || null },
  { key: 'standardizedTestType', re: /standardi[sz]ed test.*(?:type|taken)|(?:which|type of).*(?:standardi[sz]ed test|sat.*act)/, value: (c) => c.profile.answers.standardizedTestType || null, tiers: (c) => c.profile.answers.standardizedTestType === 'Not taken' ? [['Not taken'], ['Other']] : [[c.profile.answers.standardizedTestType]] },
  { key: 'satScore', re: /\bsat\b.{0,30}(?:score|result|test)|(?:score|result|test|taken|take).{0,30}\bsat\b|^sat$/, not: /\bact\b/, value: (c) => c.profile.answers.satScore || null },
  { key: 'actScore', re: /\bact\b.{0,30}(?:score|result|test)|(?:score|result|test|taken|take).{0,30}\bact\b|^act$/, not: /\bsat\b/, value: (c) => c.profile.answers.actScore || null },
  // Interns going back to class after the internship; not plans for grad school (furtherEducation).
  {
    key: 'returningToSchool',
    re: /\breturn(?:ing)? to (?:school|college|university|campus|classes|your studies|studies|(?:an |your )?academic (?:program|studies))\b|\b(?:back to|resum\w*) (?:school|college|classes|your studies|studies)\b|\bcontinu\w* (?:your |my )?(?:studies|education|degree|enrollment)\b.{0,20}\b(?:after|following|upon)\b.{0,30}\b(?:internship|co ?op|summer|assignment)\b|\b(?:enrolled|a student)\b.{0,40}\b(?:after|following|upon completion of)\b.{0,30}\b(?:internship|co ?op|summer|assignment)\b/,
    choiceOnly: true,
    value: (c) => yesNo(c.profile.answers.returningToSchool),
  },
  { key: 'furtherEducation', re: /\b(?:further|additional|postgraduate|post graduate).{0,20}(?:education|studies|school|degree)|(?:pursu|continu|consider|commit|enroll|attend|plan|intend|intent).{0,60}(?:education|studies|degree|school).{0,70}(?:after|following|upon)|(?:plan|intend|intent|pursu|enroll|attend).{0,40}\b(?:graduate|master s|masters|phd|doctoral) (?:school|degree|studies)/, value: (c) => yesNo(c.profile.answers.furtherEducation) },
  { key: 'currentOffers', re: /(?:currently|current|any|other).{0,25}\boffers?\b|\boffers?\b.{0,25}(?:received|hold|outstanding)/, value: (c) => yesNo(c.profile.answers.currentOffers) },
  { key: 'offerDetails', re: /\boffers?\b.*(?:details|company|deadline)|company name.*job title.*deadline/, value: (c) => c.profile.answers.currentOffers === 'No' ? 'N/A' : c.profile.answers.offerDetails || null },
  {
    key: 'currentCompany',
    short: true,
    re: /current (company|employer|organi[sz]ation)|most recent (company|employer)|^(company|employer|organi[sz]ation)( name)?$/,
    value: (c) => latestJob(c.profile)?.company || null,
  },
  // A bare "Title" choice is an honorific (Mr. / Ms. / Dr.), as on Oracle Recruiting; only a text box wants your job title.
  { key: 'currentTitle', short: true, textOnly: true, re: /^title$/, value: (c) => latestJob(c.profile)?.title || null },
  { key: 'currentTitle', short: true, re: /current (job )?(title|role|position)|most recent (job )?(title|role)|^job title$/, value: (c) => latestJob(c.profile)?.title || null },
  {
    key: 'school',
    re: /school|university|college|institution/,
    not: /high school|\bgraduat|\bgpa\b|grade point/,
    value: (c) => latestSchool(c.profile)?.school || null,
    tiers: (c) => [schoolVariants(latestSchool(c.profile)?.school ?? '')],
  },
  {
    // "Highest completed education": a degree counts only once its end date has passed.
    key: 'highestCompletedEducation',
    re: /\bhighest\b.{0,40}\b(?:completed|attained|obtained|earned|achieved|received)\b|\b(?:completed|attained|obtained|earned|achieved|received)\b.{0,20}\b(?:highest|level of education|education level)\b/,
    // Asking for a date or year, not the level (a notice that "we will verify your graduation date" is fine).
    not: /^(?:date|year|gpa)\b|\b(?:date|year|gpa)$|\b(?:what|which|when) (?:is|was) (?:the |your )?(?:date|year)\b/,
    value: (c) => {
      const done = c.profile.education.find((e) => e.degree && e.end && e.end.slice(0, 7) <= today().slice(0, 7));
      return done?.degree || 'High School Diploma';
    },
    tiers: (c) => {
      const done = c.profile.education.find((e) => e.degree && e.end && e.end.slice(0, 7) <= today().slice(0, 7));
      return done
        ? degreeTiers(done.degree)
        : [['High School Diploma', 'High School Diploma/GED', 'High School or equivalent', 'High School', 'Secondary School', 'GED'], ['Some College', 'Some college coursework completed']];
    },
  },
  // "What month and year did you begin your undergraduate studies?" asks when school started.
  {
    key: 'schoolStartDate',
    re: /\b(?:begin|began|start|started|commence|commenced|enter|entered)\b.{0,40}\b(?:undergraduate|college|university|degree|studies)\b|\b(?:enrollment|matriculation) date\b/,
    not: /\bgraduat|\bcomplet|\bfinish|\bend\b|internship|\bjob\b|position|\brole\b|\bwork|employment|availab|can you|could you|able to/,
    isDate: true,
    value: (c) => latestSchool(c.profile)?.start || null,
  },
  { key: 'degree', re: /\bdegree\b|level of education|highest education|education level/, not: /\b(?:date|year|completion|gpa|coursework)\b|grade point/, value: (c) => latestSchool(c.profile)?.degree || null, tiers: (c) => degreeTiers(latestSchool(c.profile)?.degree ?? '') },
  { key: 'major', short: true, re: /\bmajor\b|field of study|discipline|area of study|concentration|program of study/, value: (c) => latestSchool(c.profile)?.major || null, tiers: (c) => majorTiers(c.profile) },
  { key: 'minor', short: true, re: /\bminor\b/, value: (c) => latestSchool(c.profile)?.minor || null },
  { key: 'gpa', re: /\bgpa\b|grade point|cumulative grade/, value: (c) => latestSchool(c.profile)?.gpa || null },
  // \bgraduat: "undergraduate" names your level, not your graduation date.
  { key: 'graduationDate', re: /\bgraduat|expected (completion|grad)|completion date|degree (end|completion)/, not: /(?<!month (?:and )?)year$/, isDate: true, value: (c) => c.profile.answers.graduationDate || latestSchool(c.profile)?.end || null },
  { key: 'programmingLanguages', re: /programming languages|coding languages/, value: (c) => c.skills },
  // Language proficiency: Workday asks reading / writing / speaking / comprehension / overall separately.
  {
    key: 'languageFluent',
    re: /fluent in this language|native (speaker|language)|i am fluent|is this your (native|first) language/,
    value: (c) => (primaryLanguage(c.profile) ? (primaryLanguage(c.profile)!.fluent ? 'Yes' : 'No') : null),
  },
  {
    key: 'languageProficiency',
    re: /^(read|reading|write|writing|speak|speaking|listen|listening|understand|understanding|comprehension|comprehend|overall|oral|verbal|written|spoken|conversation|conversational|fluency)( proficiency(?: level)?| skills?| level| ability| competency)?$|^(?:language )?proficiency(?: level)?$|(?:english|language).{0,30}(?:proficiency|fluency)|(?:proficiency|fluency).{0,30}(?:english|language)|language level|how well do you (speak|write|read|understand)|(assess|rate) your .{0,30}(english|language|writing|speaking)/,
    value: (c) => {
      const language = primaryLanguage(c.profile);
      if (!language) return null;
      return language.proficiency || null;
    },
    // A fluent speaker tries Native, Fluent, Expert, Advanced, and nothing else:
    // every extra spelling is another search on typeahead dropdowns.
    tiers: (c) => {
      const language = primaryLanguage(c.profile);
      if (!language || !(language.fluent || /native|bilingual|fluent|expert/i.test(language.proficiency))) return [];
      return LANGUAGE_LEVEL_TIERS;
    },
  },
  {
    key: 'languages',
    re: /\blanguages?\b|english/,
    short: true,
    value: (c) => {
      const langs = c.profile.languages.filter((l) => l.language);
      return langs.length ? langs.map((l) => l.language) : null;
    },
  },
  {
    key: 'skills',
    re: /^(your |key |technical |relevant |top )?skills?( set)?$|skills (and|&) (technologies|tools|expertise)|technical skills|technologies|tech stack/,
    not: /writing|speaking|communication|soft skills/,
    value: (c) => (c.skills.length ? c.skills : null),
  },

  // Education date parts (Greenhouse's education block: "Start date month" etc.)
  { key: 'eduStartMonth', re: /start (date )?month/, value: (c) => monthOf(latestSchool(c.profile)?.start) },
  { key: 'eduStartYear', re: /start (date )?year|first year attended/, value: (c) => latestSchool(c.profile)?.start?.slice(0, 4) || null },
  { key: 'eduEndMonth', re: /end (date )?month/, value: (c) => monthOf(latestSchool(c.profile)?.end) },
  { key: 'eduEndYear', re: /end (date )?year|last year attended|graduation year/, value: (c) => latestSchool(c.profile)?.end?.slice(0, 4) || null },

  // --- Logistics ---
  {
    // Hourly by default; annual only when the question asks for a yearly figure.
    key: 'salaryExpectation',
    re: /salary|compensation|pay (expectation|range|requirement|desired)|(?:desired|expected|minimum) pay|rate expectation|hourly rate|desired rate|expected rate/,
    value: (c, label) => {
      const { hourly, annual } = payExpectation(c.profile);
      if (!hourly) return null;
      return asksAnnual(label) ? `$${annual.toLocaleString('en-US')}` : `$${hourly}/hr`;
    },
    // Range dropdowns: pick the option containing the number (hourly ranges, else annual ones).
    tiers: (c, label) => {
      const { hourly, annual } = payExpectation(c.profile);
      if (!hourly) return [];
      return asksAnnual(label) ? [[String(annual)]] : [[String(hourly)], [String(annual)]];
    },
  },
  {
    key: 'referrerName',
    re: /who referred you|\breferr?er\b|referral name|referring employee|name of (?:the |your )?(?:person|employee) who referred/,
    not: /^(?:were|are|did|have|has)\b|how were you/,
    value: (c) => c.profile.answers.referrerName || 'N/A',
  },
  {
    key: 'publications',
    re: /\bpublications?\b|published (?:papers?|research|work|articles?)|research papers?|peer reviewed/,
    value: (c, label) => {
      const pubs = c.profile.answers.publications.trim();
      if (/^(?:do you have|have you)\b/.test(label)) return pubs ? 'Yes' : 'No';
      return pubs || null;
    },
  },
  {
    // Self-assessment dropdowns: prefer the ownership / initiative / data-driven statement.
    key: 'selfAssessment',
    re: /which (?:statement|option|of the following|description)s? (?:best )?describes? (?:you|your)\b.{0,40}\b(?:approach|work style|working style|attitude|abilit(?:y|ies)|skills?)\b/,
    not: /gender|race|ethnic|veteran|disab|sexual|pronoun/,
    choiceOnly: true,
    confidence: 'low',
    value: () => 'take ownership',
    tiers: () => [['take ownership'], ['actively seek'], ['identify trends'], ['develop recommendations'], ['proactive'], ['independently'], ['confident'], ['comfortable']],
  },
  {
    key: 'referredByEmployee',
    re: /(were|are) you (being )?referred|employee referral|referred by (a|an) (current )?employee|did (someone|anyone) refer you|did (a|an|any) .{0,30}\b(employee|staff member|team member) refer you/,
    value: (c) => (c.profile.answers.referralSource && /referr?al/i.test(c.profile.answers.referralSource) ? 'Yes' : 'No'),
  },
  { key: 'noticePeriod', re: /notice period/, value: (c) => c.profile.answers.noticePeriod || null },
  {
    key: 'internshipTermAvailable',
    re: /(?:are you|will you be).{0,20}available.{0,30}internship.{0,20}(?:starting|beginning|in).{0,30}(?:spring|summer|fall|autumn|winter).{0,15}\b20\d{2}\b/,
    choiceOnly: true,
    // Always Yes: you only apply to internships whose term you can do.
    value: () => 'Yes',
  },
  {
    key: 'earliestStartDate',
    re: /(earliest|available|availability).{0,20}start|start date|when can you (start|begin)|date available|available to begin/,
    isDate: true,
    value: (c) => startDateForPosting(c.profile, c.jobTitle, c.jobText) || null,
  },
  {
    key: 'referralSource',
    re: /how did you (?:first )?(hear|find|learn|come across|discover)|where did you (?:first )?(hear|find|learn|see|discover)|^(?:application |candidate |applicant |job |lead )?source(?: of hire)?$|referral source|source of (?:your )?(application|referral)|how were you referred|how you heard|what led you to apply|what prompted you to apply/,
    value: (c) => c.profile.answers.referralSource || null,
    tiers: (c) => c.profile.answers.referralSource ? [c.profile.answers.referralSource, ...c.profile.answers.referralSourceFallbacks].filter(Boolean).map((source) => [source]) : [],
  },
  { key: 'coverLetter', short: true, re: /cover letter/, value: (c) => c.profile.answers.coverLetter || null },
  // Role-specific essays: never reused from saved answers; left for you.
  {
    key: 'whyInterested',
    re: /why (?:are you|do you|you are|you re) (?:\w+ )?(?:interested|applying|want)|why (?:this|our|the) (?:role|company|position|team|job)|what (?:interests|excites|draws|attracted|attracts) you|why do you want to (?:work|join)/,
    value: () => null,
  },
  { key: 'todayDate', short: true, re: /^(today s )?date$|signature date|date signed/, isDate: true, value: () => today() },
];

/** `autocomplete` tokens are the most reliable signal when a site sets them. */
const AUTOCOMPLETE: Record<string, (p: Profile) => string> = {
  'given-name': (p) => p.personal.firstName,
  'additional-name': (p) => p.personal.middleName,
  'family-name': (p) => p.personal.lastName,
  name: fullName,
  nickname: (p) => p.personal.preferredName,
  email: (p) => p.personal.email,
  tel: (p) => p.personal.phone,
  'tel-national': (p) => p.personal.phone,
  'street-address': (p) => p.personal.street,
  'address-line1': (p) => p.personal.street,
  'address-line2': (p) => p.personal.addressLine2,
  'address-level2': (p) => p.personal.city,
  'address-level1': (p) => p.personal.state,
  'postal-code': (p) => p.personal.zip,
  'country-name': (p) => p.personal.country,
  country: (p) => p.personal.country,
  organization: (p) => latestJob(p)?.company ?? '',
  'organization-title': (p) => latestJob(p)?.title ?? '',
  url: (p) => p.links.website || p.links.portfolio,
};

export function answerFromAutocomplete(autocomplete: string | null, profile: Profile): Answer | null {
  const token = (autocomplete ?? '').trim().split(/\s+/).pop() ?? '';
  const get = AUTOCOMPLETE[token];
  const value = get?.(profile);
  return value ? { key: `autocomplete:${token}`, value, confidence: 'high' } : null;
}

/** Question numbers ("6. Do you hold…") hide the question word that rules anchor on. */
const QUESTION_NUMBER = /^\d{1,2} (?=(?:are|do|does|did|have|has|is|will|would|can|could|were|what|which|when|where|how|why|if|please|select|list|describe)\b)/;
const questionText = (text: string) => normalize(text).replace(QUESTION_NUMBER, '');

/**
 * The sentence that actually asks something. Long labels carry legal background
 * ("Section 847 … military departments … Do you now, or did you, serve as an
 * employee of the DoD?"), and a keyword in the background must not decide the answer.
 * Returns null when there's no separate question, or it only makes sense with its
 * context ("Do you meet this requirement?").
 */
export function askedQuestion(text: string): string | null {
  const plain = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Sentence ends: "?" always; "." / "!" only after a real word (not "U.S." or "No.").
  const sentences = plain.split(/(?<=\?)\s+|(?<=[a-z]{3}[.!:])\s+(?=[A-Z0-9])/);
  const asks = sentences.filter((s) => s.includes('?'));
  if (!asks.length || asks.length === sentences.length) return null;
  // A follow-up instruction ("If so, please provide their name.") is part of what's asked.
  const rest = normalize(sentences.filter((x) => !x.includes('?')).join(' '));
  if (/\b(?:if (?:so|yes|no|not|applicable)|please|provide|list|enter|specify|explain|describe|select|choose|indicate|include|name)\b/.test(rest)) return null;
  const question = normalize(asks.join(' ')).replace(QUESTION_NUMBER, '');
  if (!question) return null;
  const words = question.split(' ').length;
  if (words <= 10 && /\b(?:this|these|that|those|such|above|below|following|it|they)\b/.test(question)) return null;
  return question;
}

function fromDefs(text: string, c: AnswerContext, confidence: 'high' | 'low', isChoice = false): Answer | null | 'blank' {
  const asked = askedQuestion(text);
  if (asked) {
    const answer = matchDefs(asked, c, confidence, isChoice);
    if (answer) return answer;
  }
  // Parentheticals are examples and notes ("(e.g., H-1B)", "(select No if …)"); match without them first.
  const bare = text.replace(/\([^)]*\)/g, ' ');
  if (bare !== text) {
    const answer = matchDefs(questionText(bare), c, confidence, isChoice);
    if (answer) return answer;
  }
  return matchDefs(questionText(text), c, confidence, isChoice);
}

function matchDefs(n: string, c: AnswerContext, confidence: 'high' | 'low', isChoice: boolean): Answer | null | 'blank' {
  if (!n) return null;
  const words = n.split(' ').length;
  for (const def of DEFS) {
    if (!def.re.test(n) || def.not?.test(n)) continue;
    if (def.short && words > SHORT_LABEL_WORDS) continue;
    if (def.textOnly && isChoice) continue;
    const value = def.value(c, n);
    if (value === null || value === undefined || (Array.isArray(value) ? !value.length : !value)) return 'blank';
    const tiers = def.tiers?.(c, n).filter((t) => t.length);
    const answer: Answer = { key: def.key, value, confidence: def.confidence ?? confidence, isDate: def.isDate, choiceOnly: def.choiceOnly, tiers: tiers?.length ? tiers : undefined };
    if (def.key === 'locationPreference') answer.locationPreference = { places: c.profile.answers.locationPreferences, rank: locationPreferenceRank(n) };
    if (def.key === 'earliestStartDate' && c.profile.answers.closestStartDateChoice && typeof value === 'string') answer.availabilityDate = value;
    return answer;
  }
  return null;
}

export interface Resolution {
  answer: Answer | null;
  /** Which profile key the question maps to, even when the profile has no value. */
  matchedKey: string | null;
}

/** Find the profile key a question maps to (for tests and the options-page preview). */
export function matchKey(label: string): string | null {
  const find = (n: string) => DEFS.find((d) => d.re.test(n) && !d.not?.test(n))?.key ?? null;
  const asked = askedQuestion(label);
  return (asked && find(asked)) || find(questionText(label));
}

const SAVED_HIGH = 0.82;
const SAVED_LOW = 0.62;

export function savedAnswerFor(label: string, profile: Profile): Answer | null {
  let best: { answer: string; score: number } | null = null;
  for (const item of profile.savedAnswers) {
    if (!item.question.trim() || !item.answer.trim()) continue;
    const score = questionSimilarity(label, item.question);
    if (score > (best?.score ?? 0)) best = { answer: item.answer, score };
  }
  if (!best || best.score < SAVED_LOW) return null;
  return { key: 'savedAnswer', value: best.answer, confidence: best.score >= SAVED_HIGH ? 'high' : 'low' };
}

/**
 * Resolve an answer for a question: autocomplete hint → label patterns →
 * attribute hints → saved answers.
 */
export function resolveAnswer(
  label: string,
  hints: string,
  autocomplete: string | null,
  c: AnswerContext,
  isChoice: boolean,
): Resolution {
  const usable = (a: Answer | null | 'blank'): a is Answer => !!a && a !== 'blank' && (!a.choiceOnly || isChoice);

  const byLabel = fromDefs(label, c, 'high', isChoice);
  if (usable(byLabel)) return { answer: byLabel, matchedKey: byLabel.key };
  const auto = answerFromAutocomplete(autocomplete, c.profile);
  if (auto) return { answer: auto, matchedKey: auto.key };
  if (byLabel === 'blank') return { answer: null, matchedKey: matchKey(label) };

  // Saved answers before attribute hints: a question you answered yourself beats a guess from an id.
  const saved = label ? savedAnswerFor(label, c.profile) : null;
  if (saved) return { answer: saved, matchedKey: 'savedAnswer' };

  if (!label || byLabel === null) {
    for (const hint of hints.split(' | ')) {
      const byHint = fromDefs(hint, c, 'high', isChoice);
      if (usable(byHint)) return { answer: byHint, matchedKey: byHint.key };
      if (byHint === 'blank') return { answer: null, matchedKey: matchKey(hint) };
    }
  }
  return { answer: null, matchedKey: null };
}
