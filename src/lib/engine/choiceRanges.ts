// Range choices must contain the actual value, rather than merely resemble it.
const MONTH = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
type Period = { from: number; to: number };
const dateKey = (year: number, month: number, day: number) => year * 10_000 + month * 100 + day;

function period(text: string, fallbackYear?: number): Period | null {
  const iso = text.trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (iso) {
    const [, year, month, day] = iso;
    return { from: dateKey(+year, +month, day ? +day : 1), to: dateKey(+year, +month, day ? +day : 31) };
  }
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) return { from: dateKey(+us[3], +us[1], +us[2]), to: dateKey(+us[3], +us[1], +us[2]) };
  const year = Number(text.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? fallbackYear);
  if (!year) return null;
  const month = text.match(MONTH);
  if (month) {
    const number = MONTHS.indexOf(month[1].slice(0, 3).toLowerCase()) + 1;
    const afterMonth = text.slice((month.index ?? 0) + month[0].length);
    const day = afterMonth.match(/^\s+(\d{1,2})\b/);
    return { from: dateKey(year, number, day ? +day[1] : 1), to: dateKey(year, number, day ? +day[1] : 31) };
  }
  const quarter = text.match(/\bq([1-4])\b/i);
  if (quarter) return { from: dateKey(year, +quarter[1] * 3 - 2, 1), to: dateKey(year, +quarter[1] * 3, 31) };
  // Bare year options and year ranges are common graduation choices.
  if (/^\s*(?:19|20)\d{2}\s*$/.test(text)) return { from: dateKey(year, 1, 1), to: dateKey(year, 12, 31) };
  return null;
}

/** Returns null when `wanted` is not a numeric value or ISO date. */
export function rangeOptionScore(option: string, wanted: string): number | null {
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(wanted)) {
    const target = period(wanted)!;
    const years = [...option.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => +match[1]);
    const parts = option.replace(/^\s*between\s+/i, '').split(/\s*(?:[-–—]|\bto\b|\bthrough\b|\band\b)\s*/i);
    if (parts.length === 2) {
      const start = period(parts[0], years[0]);
      const end = period(parts[1], years.at(-1));
      if (start && end) return target.from >= start.from && target.to <= end.to ? 1 : 0;
    }
    const threshold = option.replace(/^\s*(?:before|prior to|after|following)\s+/i, '').replace(/\s+(?:or earlier|or later)\s*$/i, '');
    const bound = period(threshold);
    if (bound) {
      if (/^\s*(?:before|prior to)\b/i.test(option)) return target.to < bound.from ? 1 : 0;
      if (/^\s*(?:after|following)\b/i.test(option)) return target.from > bound.to ? 1 : 0;
      if (/or earlier\s*$/i.test(option)) return target.to <= bound.to ? 1 : 0;
      if (/or later\s*$/i.test(option)) return target.from >= bound.from ? 1 : 0;
    }
    const exact = period(option);
    if (exact && (parts.length === 1 || /^\d{4}-\d{2}(?:-\d{2})?$/.test(option.trim()))) {
      return target.from >= exact.from && target.to <= exact.to ? 1 : 0;
    }
    return 0;
  }
  if (!/^\d+(?:\.\d+)?$/.test(wanted)) return null;
  const value = Number(wanted);
  // Pay options: "$80,000 - $90,000", "$80k–$90k", "$45/hr", "$100,000+".
  const money = /\$|\busd\b|\d\s*k\b|per (?:hour|year|annum)|\/\s*(?:hr|hour|yr|year)\b|\b(?:hourly|annual|annually|salary)\b/i.test(option);
  if (money) {
    option = option
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(Number(n) * 1000))
      .replace(/\$\s*/g, '');
    // Hourly figures and annual figures can't be compared with each other.
    const amounts = [...option.matchAll(/\d+(?:\.\d+)?/g)].map((match) => +match[0]);
    if (amounts.length && (value >= 1000) !== (Math.max(...amounts) >= 1000)) return 0;
  }
  const ratio = option.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*\d+(?:\.\d+)?\s*$/);
  if (ratio) return value === +ratio[1] ? 1 : 0;
  const numbers = [...option.matchAll(/\d+(?:\.\d+)?/g)].map((match) => +match[0]);
  const interval = option.match(/(\d+(?:\.\d+)?)\s*(?:[-–—]|\bto\b)\s*(\d+(?:\.\d+)?)/i);
  if (interval) return value >= +interval[1] && value <= +interval[2] ? 1 : 0;
  if (!numbers.length) return null;
  if (numbers.length !== 1) return 0;
  const bound = numbers[0];
  if (/<=|≤|at most|or (?:less|lower|earlier)|and (?:below|under)/i.test(option)) return value <= bound ? 1 : 0;
  if (/>=|≥|at least|or (?:more|higher|later)|and (?:above|over)|\+\s*$/i.test(option)) return value >= bound ? 1 : 0;
  if (/<|less than|below|under|before/i.test(option)) return value < bound ? 1 : 0;
  if (/>|greater than|above|over|after/i.test(option)) return value > bound ? 1 : 0;
  return value === bound ? 1 : 0;
}
