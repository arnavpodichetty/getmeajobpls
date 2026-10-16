/** Saved values and spellings used by academic-year dropdowns. */
export const ACADEMIC_YEARS = [
  '1st year associates degree', '2nd year associates degree',
  'Freshman', 'Sophomore', 'Junior', 'Senior', 'Fifth year or above',
  'Graduate-level student', "Master's student", 'Doctoral student', 'Other',
];

const UNDERGRADUATE_YEARS = [
  /\bfreshm[ae]n\b|\bfirst year\b|\b1st year\b|\byear (?:one|1)\b/,
  /\bsophomore\b|\bsecond year\b|\b2nd year\b|\byear (?:two|2)\b/,
  /\bjunior\b|\bthird year\b|\b3rd year\b|\byear (?:three|3)\b/,
  /\bsenior\b|\bfourth year\b|\b4th year\b|\byear (?:four|4)\b/,
  /\bfifth year\b|\b5th year\b|\byear (?:five|5)\b/,
];

/** Inputs have already been normalized. Academic years must not fuzzy-match neighbors. */
export function academicYearScore(option: string, wanted: string): number | null {
  const year = UNDERGRADUATE_YEARS.findIndex((pattern) => pattern.test(wanted));
  if (year < 0 || /associat|high school|graduate|master|doctor|phd/.test(wanted)) return null;
  if (/associat|high school|\bgraduate\b|postgraduate|master|doctor|phd/.test(option)) return 0;
  const matches = UNDERGRADUATE_YEARS.map((pattern, index) => pattern.test(option) ? index : -1).filter((index) => index >= 0);
  return matches.length === 1 && matches[0] === year ? 1 : 0;
}
