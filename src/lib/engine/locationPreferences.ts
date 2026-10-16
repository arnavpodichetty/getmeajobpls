import { isPlaceholderOption, normalize, US_STATES, type OptionPick } from './text';

export interface LocationPreference {
  places: string[];
  rank: number;
}

const CALIFORNIA_CITIES = [
  'san francisco', 'south san francisco', 'san jose', 'san diego', 'los angeles',
  'oakland', 'berkeley', 'sacramento', 'palo alto', 'menlo park', 'mountain view',
  'sunnyvale', 'santa clara', 'cupertino', 'san mateo', 'redwood city', 'foster city',
  'san bruno', 'san carlos', 'burlingame', 'fremont', 'milpitas', 'emeryville',
  'pleasanton', 'san ramon', 'walnut creek', 'irvine', 'costa mesa', 'newport beach',
  'santa monica', 'el segundo', 'carlsbad', 'santa barbara', 'silicon valley', 'bay area',
];

const US_REGIONS: [RegExp, string[]][] = [
  [/\b(?:western|west coast|west)\b/, ['ak', 'az', 'ca', 'co', 'hi', 'id', 'mt', 'nm', 'nv', 'or', 'ut', 'wa', 'wy']],
  [/\b(?:northeastern|northeast)\b/, ['ct', 'ma', 'me', 'nh', 'nj', 'ny', 'pa', 'ri', 'vt']],
  [/\b(?:midwestern|midwest)\b/, ['ia', 'il', 'in', 'ks', 'mi', 'mn', 'mo', 'nd', 'ne', 'oh', 'sd', 'wi']],
  [/\b(?:southern|south)\b/, ['al', 'ar', 'dc', 'de', 'fl', 'ga', 'ky', 'la', 'md', 'ms', 'nc', 'ok', 'sc', 'tn', 'tx', 'va', 'wv']],
];

export function matchesLocation(option: string, preference: string): boolean {
  const text = normalize(option);
  const wanted = normalize(preference);
  if (!wanted) return false;
  const state = US_STATES[wanted] ?? wanted;
  const abbreviation = Object.keys(US_STATES).find((key) => US_STATES[key] === state);
  const contains = (place: string) => (` ${text} `).includes(` ${place} `);
  if (contains(state) || (abbreviation && contains(abbreviation))) return true;
  if (abbreviation && /\b(?:locations?|regions?)\b/.test(text)
    && US_REGIONS.some(([pattern, states]) => pattern.test(text) && states.includes(abbreviation))
    && !Object.values(US_STATES).some((other) => other !== state && contains(other))) return true;
  if (state !== 'california') return false;
  // Infer California for familiar city-only office choices, but respect an
  // explicitly different state/country (e.g. Los Angeles, Chile).
  if (/\b(?:canada|uk|united kingdom|scotland|england|costa rica)\b/.test(text)) return false;
  const explicitState = option.match(/,\s*([A-Z]{2})\b/);
  if (explicitState && US_STATES[explicitState[1].toLowerCase()] && explicitState[1] !== 'CA') return false;
  if (Object.values(US_STATES).some((other) => other !== state && contains(other))) return false;
  // Any other qualifier after the city ("Los Angeles, Chile") names somewhere else.
  const qualifiers = option.split(/[,(]/).slice(1).map((part) => normalize(part)).filter(Boolean);
  const allowed = /^(?:ca|california|us|usa|u|s|a|united|states|of|america|remote|hybrid|on|site|onsite|in|office|bay|area|silicon|valley|hq|headquarters|downtown)$/;
  if (qualifiers.some((q) => !CALIFORNIA_CITIES.includes(q) && !q.split(' ').every((word) => allowed.test(word)))) return false;
  return CALIFORNIA_CITIES.some(contains);
}

/** Stable ranking: preferred places first, preserving the site's order within each. */
export function bestLocationOption<T>(options: T[], text: (option: T) => string, preference: LocationPreference, includeOthers = true): OptionPick<T> | null {
  const ranked = options.flatMap((option, index) => {
    const label = text(option);
    if (isPlaceholderOption(label)) return [];
    const priority = preference.places.findIndex((place) => matchesLocation(label, place));
    if (priority < 0 && !includeOthers) return [];
    return [{ option, index, priority: priority < 0 ? preference.places.length : priority, preferred: priority >= 0 }];
  }).sort((a, b) => a.priority - b.priority || a.index - b.index);
  const pick = ranked[preference.rank - 1];
  return pick ? { option: pick.option, score: pick.preferred ? 1 : 0.9 } : null;
}

export function locationPreferenceRank(label: string): number {
  const ordinal = label.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/);
  const ranks: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
  if (ordinal) return ranks[ordinal[1]];
  const number = label.match(/\b(?:preference|choice|location|office)(?: number)?\s*#?\s*([1-9])\b/)
    ?? label.match(/(?:^|\s)#?([1-9])\s+(?:preferred )?(?:location|office|preference|choice)\b/);
  return number ? Number(number[1]) : 1;
}

export function locationSearchTerms(place: string): string[] {
  const normalized = normalize(place);
  const state = US_STATES[normalized] ?? normalized;
  const abbreviation = Object.keys(US_STATES).find((key) => US_STATES[key] === state);
  return [...new Set([place, ...(abbreviation ? [abbreviation.toUpperCase()] : [])])];
}
