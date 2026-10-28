// Text normalization, similarity, and option matching shared by every adapter.
import { rangeOptionScore } from './choiceRanges';
import { academicYearScore } from './academicYear';

/** Lowercase, strip accents/required markers/punctuation, collapse whitespace. */
export function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\((?:required|optional)\)|[*✱]/g, ' ')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clean display text: collapse whitespace and drop trailing required markers. */
export function cleanLabel(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[*✱]\s*/g, ' ')
    .replace(/\s*\(?\b(required|optional)\)?\s*$/i, '')
    .replace(/(?<=[a-z])(Required|Optional)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  'a an the of to for in on at by with and or your you are is do does did have has be please this that our we what which who how any if will would'.split(' '),
);

export function tokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

function bigrams(value: string): Map<string, number> {
  const s = ` ${normalize(value)} `;
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice over character bigrams, 0..1. Robust to small wording changes. */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/** Fraction of the shorter text's content words found in the longer one, 0..1. */
export function tokenOverlap(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** Question-to-question similarity used for the saved-answers bank. */
export function questionSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const jaccard = A.size + B.size ? shared / (A.size + B.size - shared) : 0;
  return Math.max(jaccard, dice(na, nb) * 0.9, 0.5 * jaccard + 0.5 * dice(na, nb));
}

// ---------------------------------------------------------------------------
// Option matching (selects, radios, comboboxes, button groups)

/** Sentinel for "decline to answer" (blank EEO answers). */
export const DECLINE = '__decline__';

const DECLINE_RE =
  /decline|prefer not|not (?:to )?(?:wish|want)|don.?t wish|do not wish|choose not|rather not|not (?:to )?(?:say|disclose|answer|specify|self.?identify)|no answer|undisclosed|i don.?t know/;

const YES_RE = /^(?:yes|y|true|i am|i do|i have|i will|i would|i agree|i acknowledge|i consent|i understand|i accept|i confirm|i certify|understand|understood|acknowledge|acknowledged|agree|agreed|accept|accepted|confirm|confirmed|correct|authorized)\b/;
const NO_RE = /^(?:no|n|false|i am not|i do not|i don.?t|i have not|i haven.?t|i have never|i ve never|i will not|i won.?t|i disagree|do not|don.?t|disagree|not|never|none of (?:the above|these))\b/;

export const US_STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin',
  wy: 'wyoming', dc: 'district of columbia', pr: 'puerto rico',
};

/** Full state name → abbreviation ("california" → "ca"), and every full name. */
const STATE_ABBREVIATIONS = new Map(Object.entries(US_STATES).map(([abbr, full]) => [full, abbr]));
const STATE_NAMES = new Set(Object.values(US_STATES));

/** Words that mean the same thing in option lists. Each group is matched as a set. */
const SYNONYM_GROUPS: string[][] = [
  ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  ['united kingdom', 'uk', 'great britain', 'england'],
  ['male', 'man', 'cisgender man'],
  ['female', 'woman', 'cisgender woman'],
  ['non binary', 'nonbinary', 'genderqueer', 'gender non conforming'],
  // Arts and science degrees are different answers; generic "Bachelor's" options are scored separately below.
  ['bachelor of arts', 'ba', 'b a', 'ab', 'a b', 'bachelors of arts', 'bachelor s of arts', 'bachelor of arts ba', 'ba bachelor of arts'],
  ['bachelor of science', 'bs', 'b s', 'bsc', 'b sc', 'bachelors of science', 'bachelor s of science', 'bachelor of science bs', 'bs bachelor of science'],
  ['master of science', 'ms', 'm s', 'msc'],
  ['master of arts', 'ma', 'm a'],
  ['phd', 'ph d', 'doctorate', 'doctoral'],
  ['asian', 'asian american'],
  ['black', 'african american', 'black or african american'],
  ['hispanic', 'latino', 'latinx', 'latina', 'hispanic or latino'],
  ['white', 'caucasian'],
  ['two or more races', 'multiracial', 'mixed'],
  ['native hawaiian', 'pacific islander'],
  ['american indian', 'alaska native', 'native american'],
  ['linkedin', 'linked in'],
  // Months: "May" = "05" = "5".
  ['january', 'jan', '01', '1'],
  ['february', 'feb', '02', '2'],
  ['march', 'mar', '03', '3'],
  ['april', 'apr', '04', '4'],
  ['may', '05', '5'],
  ['june', 'jun', '06', '6'],
  ['july', 'jul', '07', '7'],
  ['august', 'aug', '08', '8'],
  ['september', 'sep', 'sept', '09', '9'],
  ['october', 'oct', '10', '10'],
  ['november', 'nov', '11', '11'],
  ['december', 'dec', '12', '12'],
  ['mobile', 'cell', 'cellular', 'cell phone', 'mobile phone'],
  ['home', 'landline', 'home phone'],
  ['heterosexual', 'straight', 'heterosexual or straight', 'straight heterosexual'],
  ['gay', 'gay man', 'gay or lesbian', 'homosexual'],
  ['native', 'native speaker'],
];

/** "Native" matches options that say native ("Native speaker", "Native or bilingual"); Fluent is the next try. */
const NATIVE_LEVEL = /\bnative\b/;

function expand(value: string): string[] {
  const n = normalize(value);
  const out = new Set([n]);
  if (US_STATES[n]) out.add(US_STATES[n]);
  const abbr = STATE_ABBREVIATIONS.get(n);
  if (abbr) out.add(abbr);
  for (const group of SYNONYM_GROUPS) {
    if (group.includes(n)) for (const g of group) out.add(g);
  }
  return [...out];
}

function isYesNo(value: string): 'yes' | 'no' | null {
  const n = normalize(value);
  if (n === 'yes') return 'yes';
  if (n === 'no') return 'no';
  return null;
}

/**
 * Score how well an option's text answers `wanted`, 0..1.
 * Handles yes/no phrasing ("Yes, I am authorized…"), decline variants, US
 * state abbreviations, and common EEO/degree/country synonyms.
 */
/**
 * Race subgroups some forms list separately. Each matches only its own options;
 * its broad category ("Asian") is the next tier, never a neighboring subgroup.
 */
export const RACE_SUBGROUPS: Record<string, { match: RegExp; aliases: string[]; category: string }> = {
  'south asian': { match: /\bsouth asian\b|\basian indian\b|^indian\b|\bindian subcontinent\b/, aliases: ['Asian Indian'], category: 'Asian' },
  'asian indian': { match: /\bsouth asian\b|\basian indian\b|^indian\b|\bindian subcontinent\b/, aliases: ['South Asian'], category: 'Asian' },
  'east asian': { match: /(?<!south )\beast asian\b/, aliases: [], category: 'Asian' },
  'southeast asian': { match: /\bsouth ?east asian\b/, aliases: [], category: 'Asian' },
};

/**
 * A qualified field of study ("Computer Science", "Software Engineering"),
 * normalized with "sciences" → "science"; null for anything else. The head word
 * alone is not that major, and a different qualifier is a different major.
 */
export function qualifiedField(value: string): string | null {
  const n = normalize(value).replace(/\bsciences\b/g, 'science');
  if (/\b(?:of|school|university|college|institute|bachelor|master|doctor|associate)\b/.test(n)) return null;
  return /^(?:[a-z]+ ){1,4}(?:science|engineering|studies)$/.test(n) ? n : null;
}

/** `existing` is just the head word ("Science") of the qualified major `wanted`. */
export function isBareFieldHead(existing: string, wanted: string): boolean {
  const field = qualifiedField(wanted);
  return !!field && normalize(existing).replace(/\bsciences\b/g, 'science') === field.split(' ').pop();
}

const JOB_BOARDS = /\b(?:linked ?in|indeed|glassdoor|handshake|zip ?recruiter|monster|google|facebook|twitter|instagram|tiktok|reddit|youtube|social media|job board|built ?in|wellfound|angel ?list|simplify|dice|career ?builder)\b/;

/** "Career Site", "Acme Careers Website", "Corporate website", "Company careers page", "Acme.com". */
function isCareersSiteOption(opt: string): boolean {
  if (JOB_BOARDS.test(opt) || /\b(?:fair|event|platform|center at|office at)\b/.test(opt)) return false;
  return /\bcareers? (?:web ?site|site|page|portal|section)\b/.test(opt)
    || /^(?:(?:company|employer|corporate|our) )?careers?$/.test(opt)
    || /\bcorporate (?:web ?site|site|careers?)\b/.test(opt)
    || /^(?:company|employer|our|the) (?:web ?site|site)$/.test(opt)
    // "<Company> website" / "<Company> com", but not "<Company> website, article, podcast…".
    || /^[a-z0-9]+(?: [a-z0-9]+){0,2} (?:web ?site|com)$/.test(opt);
}

type VeteranClass = 'protected' | 'veteran' | 'notProtected' | 'veteranNotProtected' | 'notVeteran';

/** Says you are not a veteran at all. */
const NOT_VETERAN = /\bnot (?:an? )?(?:military |u s |us )?veteran\b|\bnon ?veteran\b|\bnever (?:served|been in)\b|\b(?:have|has) not served\b|\bdid not serve\b|\bno (?:prior )?(?:military|armed forces) service\b/;
/** Says "not protected", which on its own is ambiguous ("I am not a protected veteran"). */
const NOT_PROTECTED = /\bnot (?:an? )?protected\b|\bnon ?protected\b|\bunprotected\b|\bnot (?:identify|one of)\b/;
/** Says you ARE a veteran, in any wording ("I identify as a veteran, just not…", "Veteran, but not…"). */
const IS_VETERAN = /\b(?:am|identify as|i m|was|have served as) (?:an? )?(?:military |u s |us )?veteran\b|\bveteran\b.{0,25}\b(?:but|just|though|although|however|only|except)\b|\b(?:i|have|has) served (?:in|with|on)\b|\bnon ?protected veteran\b|^(?:yes )?(?:i am )?(?:a )?veteran$|^veteran\b/;
/** The protected categories themselves. */
const PROTECTED = /\bprotected veterans?\b|\bclassifications?\b|\bdisabled veteran|\brecently separated\b|\bactive duty wartime\b|\bcampaign badge\b|\bservice medal\b/;

function veteranClass(t: string): VeteranClass | null {
  if (!/\bveterans?\b|\bmilitary\b|\barmed forces\b|\bserved\b/.test(t)) return null;
  if (NOT_VETERAN.test(t)) return 'notVeteran';
  if (NOT_PROTECTED.test(t)) return IS_VETERAN.test(t) ? 'veteranNotProtected' : 'notProtected';
  if (PROTECTED.test(t)) return 'protected';
  if (IS_VETERAN.test(t)) return 'veteran';
  return null;
}

/**
 * Veteran statements differ by a word or two ("I identify as a veteran, just not a
 * protected veteran" vs "I am not a protected veteran"), so match by meaning, never by
 * overlap. "Not a protected veteran" counts as not a veteran unless you chose the
 * veteran-but-not-protected answer; an option saying you are a veteran is never chosen for it.
 */
function veteranScore(opt: string, wanted: string): number | null {
  const want = veteranClass(wanted);
  const have = veteranClass(opt);
  if (!want || !have) return null;
  if (want === have) return 1;
  const isVet = (c: VeteranClass) => c === 'protected' || c === 'veteran' || c === 'veteranNotProtected';
  const notProtected = (c: VeteranClass) => c === 'notProtected' || c === 'notVeteran' || c === 'veteranNotProtected';
  // A plain "I am a veteran" option answers either veteran answer.
  if (have === 'veteran') return isVet(want) ? 0.9 : 0;
  if (want === 'veteran') return isVet(have) ? 0.9 : 0;
  if (want === 'protected' || have === 'protected') return 0;
  if (have === 'veteranNotProtected') return 0; // only for someone who chose it
  if (want === 'veteranNotProtected') return have === 'notProtected' ? 0.95 : 0;
  return notProtected(want) && notProtected(have) ? 0.95 : 0;
}

export function optionScore(optionText: string, wanted: string): number {
  const opt = normalize(optionText);
  if (!opt) return 0;

  // A race subgroup only matches itself; its broad category is a separate fallback tier.
  const subgroup = RACE_SUBGROUPS[normalize(wanted)];
  if (subgroup) return subgroup.match.test(opt) ? 1 : 0;

  if (wanted === DECLINE) return DECLINE_RE.test(opt) ? 1 : 0;
  if (DECLINE_RE.test(opt) && !DECLINE_RE.test(normalize(wanted))) return 0;

  // A stored statement ("I am not a protected veteran") answering a plain Yes/No option.
  const optYN = isYesNo(optionText);
  const w = normalize(wanted);
  const level = wanted.startsWith(DEGREE_LEVEL) ? wanted.slice(DEGREE_LEVEL.length) : null;
  if (level) return isGenericDegreeLevel(opt, level) ? 1 : 0;
  const yearScore = academicYearScore(opt, w);
  if (yearScore !== null) return yearScore;
  const veteran = veteranScore(opt, w);
  if (veteran !== null) return veteran;
  // Employer-branded careers pages are distinct from career fairs, campus
  // platforms and generic company content. Do not fuzzy-match those sources.
  if (/^(?:(?:company|employer|corporate) )?careers? (?:web ?site|site|page)$/.test(w) || /^(?:company|employer|corporate) web ?site$/.test(w)) {
    return isCareersSiteOption(opt) ? 1 : 0;
  }
  if (w === 'not taken') {
    return /\b(?:not taken|did not take|have not taken|haven t taken|never taken|didn t take|not applicable)\b|\b(?:don t|do not) have (?:an? )?(?:(?:sat|act|standardized test) )?scores?\b|^(?:n a|na|none|neither|no standardized tests?)\b/.test(opt) ? 1 : 0;
  }
  const rangeScore = rangeOptionScore(optionText, wanted);
  if (rangeScore !== null) return rangeScore;
  // N/A is a distinct answer from No. Prefer it when offered, then let an
  // answer's explicit fallback tier choose No if N/A is absent.
  if (/^(?:n a|na|not applicable|does not apply)$/.test(w)) {
    return /^(?:n a|na|not applicable|does not apply)(?:$| )/.test(opt) ? 1 : 0;
  }
  // Percentage ranges are discrete choices; do not fuzzy-match a neighboring
  // range just because it shares an endpoint (25-50% versus 50-75%).
  const range = wanted.match(/^(\d+)\s*%?\s*(?:[-–—]|to)\s*(\d+)\s*%$/i);
  if (range) {
    const candidate = optionText.match(/\b(\d+)\s*%?\s*(?:[-–—]|to)\s*(\d+)\s*%/i);
    return candidate && Number(candidate[1]) === Number(range[1]) && Number(candidate[2]) === Number(range[2]) ? 1 : 0;
  }
  // Language levels are distinct choices. Never fuzzily substitute Expert or
  // Advanced for Fluent; also accept numbered labels such as "5 - Fluent".
  if (w === 'fluent') return /\bfluent\b/.test(opt) && !/\b(not|non) fluent\b/.test(opt) ? 1 : 0;
  // Numbered scales: "3 - Advanced" is Advanced, "4 - Expert" is Expert.
  if ((w === 'advanced' || w === 'expert') && opt.replace(/^\d+\s*/, '') === w) return 1;
  // Keep majors separate: a shared "Science" is not "Computer Science", and
  // "Computer Science" does not answer "Computer and Information Science".
  const field = qualifiedField(w);
  if (field) {
    if (opt === w) return 1;
    const o = opt.replace(/\bsciences\b/g, 'science');
    if (o === field) return 0.99;
    return new RegExp(`\\b${field}\\b`).test(o) ? 0.9 + dice(opt, w) * 0.09 : 0;
  }
  if (optYN && !isYesNo(wanted)) {
    if (optYN === 'no' && NO_RE.test(w)) return 0.9;
    if (optYN === 'yes' && YES_RE.test(w) && !NO_RE.test(w)) return 0.9;
    return 0;
  }

  const yn = isYesNo(wanted);
  if (yn) {
    if (yn === 'yes' && /\b(?:(?:do not|don t) (?:agree|accept|understand|acknowledge|consent)|disagree)\b/.test(opt)) return 0;
    // "Yes, but I will need sponsorship later" is a qualified answer: chosen if it's the best fit, never trusted.
    const sure = HEDGE.test(opt) ? 0.8 : 0.95;
    if (yn === 'yes' && YES_RE.test(opt) && !NO_RE.test(opt)) return opt === 'yes' ? 1 : sure;
    if (yn === 'no' && NO_RE.test(opt)) return opt === 'no' ? 1 : sure;
    return 0;
  }

  // A generic "Bachelor's Degree" option answers any bachelor's.
  if (/^bachelor/.test(w) && /^(bachelor s?( degree)?|bachelors( degree)?|undergraduate( degree)?|4 year degree|four year degree)$/.test(opt)) return 0.88;

  if (/^native( or bilingual)?$|^native speaker$/.test(w)) {
    return NATIVE_LEVEL.test(opt) && !/\bnon native\b/.test(opt) ? 1 : 0;
  }

  if (opt === w) return 1;
  // Opposite meanings never match, however many words they share:
  // "I am a protected veteran" vs "I am not a protected veteran", "Not Hispanic" vs "Hispanic".
  // Parenthetical qualifiers ("Asian (Not Hispanic or Latino)") don't flip the main answer.
  if (negated(normalize(optionText.replace(/\([^)]*\)/g, ' '))) !== negated(normalize(wanted.replace(/\([^)]*\)/g, ' ')))) return 0;

  let best = 0;
  const optionForms = expand(optionText);
  for (const w of expand(wanted)) {
    for (const o of optionForms) {
      if (o === w) return 1; // a synonym ("USA" for "United States")
      // "Asian (Not Hispanic or Latino)" answers "Asian"; "Yes, but …" style extras are only a loose match.
      if (o.startsWith(`${w} `)) best = Math.max(best, HEDGE.test(o.slice(w.length)) ? 0.8 : 0.9);
      else if (w.startsWith(`${o} `)) best = Math.max(best, 0.8);
      // Whole words only: "Female" doesn't contain "Male".
      else if (w.length > 3 && ` ${o} `.includes(` ${w} `)) best = Math.max(best, 0.8);
      else if (o.length > 3 && ` ${w} `.includes(` ${o} `)) best = Math.max(best, 0.7);
    }
  }
  // Places: "San Francisco, CA" answers "San Francisco, California, United States". Only for
  // place-like answers; for statements, sharing every word can still mean the opposite.
  const wantedTokens = w.split(' ').map((t) => US_STATES[t] ?? t).join(' ').split(' ');
  const optTokens = new Set(opt.split(' ').concat(...opt.split(' ').map((t) => (US_STATES[t] ?? t).split(' '))));
  const placeLike = /,/.test(wanted) && w.split(' ').length <= 5 && w.split(' ').some((t) => US_STATES[t] || STATE_NAMES.has(t) || expand(t).includes('united states'));
  if (placeLike && wantedTokens.every((t) => optTokens.has(t))) best = Math.max(best, 0.9);
  // Fuzzy overlap alone is never confident (always below CONFIDENT_OPTION_SCORE).
  // Spelling-level similarity is for long names (schools, employers); on short answers
  // it confuses different words ("Male" / "Female", "Intern" / "International").
  const spelling = Math.min(opt.length, w.length) >= 10 ? Math.min(dice(opt, wanted) * 0.85, 0.84) : 0;
  return Math.max(best, spelling, tokenOverlap(opt, wanted) * 0.8);
}

/** Words that qualify an answer ("Yes, but…", "…except…"): such options are never a confident match. */
const HEDGE = /\b(?:but|except|unless|however|although|though|only if|provided that|other than)\b/;
const NEGATION = /\b(?:not|never|no|non|none|neither|nor|without|cannot|can t|don t|doesn t|didn t|haven t|hasn t|isn t|aren t|wasn t|weren t|won t|wouldn t)\b/;
const negated = (text: string) => NEGATION.test(text);

export interface OptionPick<T> {
  option: T;
  score: number;
}

/**
 * The best option for `wanted`. When two different options score (nearly) the
 * same, the choice is a coin flip, so it's chosen but never marked confident.
 */
export function bestOption<T>(options: T[], text: (o: T) => string, wanted: string): OptionPick<T> | null {
  let best: OptionPick<T> | null = null;
  let runnerUp = 0;
  const seen = new Set<string>();
  for (const option of options) {
    const raw = text(option);
    const label = normalize(raw);
    if (seen.has(label)) continue;
    seen.add(label);
    const score = optionScore(raw, wanted);
    if (score > (best?.score ?? 0)) {
      runnerUp = best?.score ?? 0;
      best = { option, score };
    } else if (score > runnerUp) runnerUp = score;
  }
  if (best && best.score >= CONFIDENT_OPTION_SCORE && best.score < 1 && best.score - runnerUp < 0.02) {
    best = { ...best, score: CONFIDENT_OPTION_SCORE - 0.01 };
  }
  return best;
}

/** Below this an option is not chosen; between this and CONFIDENT it is chosen but flagged. */
export const MIN_OPTION_SCORE = 0.6;
export const CONFIDENT_OPTION_SCORE = 0.85;

/**
 * Pick from options trying each tier in order: every spelling in a tier is
 * equally good ("UC Davis" = "University of California, Davis"); a later
 * tier is a fallback used only if nothing in the earlier ones matches.
 */
export function bestOptionTiered<T>(options: T[], text: (o: T) => string, tiers: string[][]): OptionPick<T> | null {
  // Reading an option's text can mean DOM lookups; do it once per option, not once per spelling.
  const texts = new Map<T, string>();
  const cachedText = (o: T) => {
    let t = texts.get(o);
    if (t === undefined) texts.set(o, (t = text(o)));
    return t;
  };
  for (const tier of tiers) {
    let best: OptionPick<T> | null = null;
    for (const wanted of tier) {
      const pick = bestOption(options, cachedText, wanted);
      if (pick && pick.score > (best?.score ?? 0)) best = pick;
    }
    if (best && best.score >= MIN_OPTION_SCORE) return best;
  }
  return null;
}

/** The configured major first, then each saved fallback in its listed order. */
export function majorPreferenceTiers(major: string, fallbacks: string[]): string[][] {
  if (!major.trim()) return [];
  const preferred = [major, ...fallbacks];
  const seen = new Set<string>();
  return preferred.filter((value) => {
    const key = normalize(value).replace(/\bsciences\b/g, 'science');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value) => [value]);
}

/** Ways a school name gets written across ATS lists. */
export function schoolVariants(name: string): string[] {
  const n = name.trim().replace(/^the\s+/i, '');
  if (!n) return [];
  const out = [n];
  // Multi-campus systems: "University of Texas, Austin" = "University of Texas-Austin" (Workday's
  // standard list) = "University of Texas at Austin".
  const campus = n.match(/^(university of [a-z .]+?)(?:\s*,\s*|\s*[-–]\s*|\s+at\s+)(\S.*)$/i)
    ?? n.match(/^(university of california)\s+(\S.*)$/i)
    ?? n.match(/^(uc)\s+(\S.*)$/i);
  if (campus) {
    const system = /^uc$/i.test(campus[1]) ? 'University of California' : campus[1];
    const place = campus[2].trim();
    out.push(
      `${system}, ${place}`,
      `${system} - ${place}`,
      `${system}-${place}`,
      `${system} ${place}`,
      `${system} at ${place}`,
    );
    if (/^university of california$/i.test(system)) out.push(`UC ${place}`, `U.C. ${place}`);
  }
  const stateU = n.match(/^university of ([a-z .]+)$/i);
  if (stateU) out.push(`${stateU[1]} University`);
  return [...new Set(out)];
}

/** Ways a degree gets written ("Bachelor of Arts" = "B.A." = "BA"). */
export function degreeVariants(degree: string): string[] {
  const d = degree.trim();
  if (!d) return [];
  const n = normalize(d);
  const table: [RegExp, string[]][] = [
    [/^(bachelor s? of arts|ba|b a|ab|a b)$/, ['Bachelor of Arts', 'B.A.', 'BA', 'Bachelor of Arts (BA)', 'BA - Bachelor of Arts', 'A.B.']],
    [/^(bachelor s? of science|bs|b s|bsc)$/, ['Bachelor of Science', 'B.S.', 'BS', 'Bachelor of Science (BS)', 'BS - Bachelor of Science', 'B.Sc.']],
    [/^(master s? of science|ms|m s|msc)$/, ['Master of Science', 'M.S.', 'MS', 'Master of Science (MS)']],
    [/^(master s? of arts|ma|m a)$/, ['Master of Arts', 'M.A.', 'MA', 'Master of Arts (MA)']],
  ];
  for (const [re, variants] of table) if (re.test(n)) return [d, ...variants.filter((v) => v !== d)];
  return [d];
}

/** Marks a tier entry that matches only a level-only option ("Bachelor Degree/Int'l Equiv"). */
const DEGREE_LEVEL = 'degree-level:';

/** What to type into a search box for a tier entry ("degree-level:bachelor" searches "Bachelor"). */
export function searchTextFor(value: string): string {
  if (!value.startsWith(DEGREE_LEVEL)) return value;
  const level = value.slice(DEGREE_LEVEL.length);
  return level === 'doctor' ? 'Doctor' : level[0].toUpperCase() + level.slice(1);
}

function degreeLevel(degree: string): string | null {
  const n = normalize(degree);
  if (/\bbachelor|^(?:ba|bs|ab|bsc|b a|b s|a b|beng|b eng|bba|bfa|b f a)\b/.test(n)) return 'bachelor';
  if (/\bmba\b|business administration/.test(n)) return null; // forms list the MBA on its own
  if (/\bmaster|^(?:ms|ma|msc|m s|m a|meng|m eng|mfa|m f a)\b/.test(n)) return 'master';
  if (/\bdoctor|\bph ?d\b/.test(n)) return 'doctor';
  if (/\bassociate/.test(n)) return 'associate';
  return null;
}

/** "Bachelor Degree/Int'l Equiv", "Bachelor's degree or equivalent", "Bachelors": the level, no field. */
function isGenericDegreeLevel(opt: string, level: string): boolean {
  const stem = level === 'doctor' ? '(?:doctorate|doctoral|doctor s|doctors)' : `${level}(?: s|s)?`;
  const m = opt.match(new RegExp(`^${stem}\\b(.*)$`));
  if (!m) return false;
  const rest = m[1].replace(/\b(?:degrees?|or|and|int l|international|equiv|equivalent|higher|level|4 year|four year|2 year|two year|college|university|program)\b/g, '').trim();
  return rest === '';
}

/**
 * Degree tiers: the degree's own spellings first, then a level-only option
 * ("Bachelor Degree/Int'l Equiv"), never a different field of the same level.
 */
export function degreeTiers(degree: string): string[][] {
  const tiers = [degreeVariants(degree)];
  const level = degreeLevel(degree);
  if (level) tiers.push([DEGREE_LEVEL + level]);
  return tiers;
}

export function isPlaceholderOption(text: string): boolean {
  const n = normalize(text);
  return !n || /^(?:select|choose|please select|please choose|pick)\b/.test(n) || n === 'none selected';
}
