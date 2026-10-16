import { isPlaceholderOption, optionScore, type OptionPick } from './text';

/** Select the offered window nearest the saved date; never choose a past semester. */
export function bestAvailabilityOption<T>(options: T[], text: (o: T) => string, target: string, now = new Date()): OptionPick<T> | null {
  const targetTime = Date.parse(target);
  if (!Number.isFinite(targetTime)) return null;
  let best: { option: T; distance: number; exact: boolean } | null = null;
  for (const option of options) {
    const label = text(option);
    if (isPlaceholderOption(label)) continue;
    const relative = label.match(/(?:within|in|next)\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(weeks?|months?|days?)/i);
    let date: Date | null = null;
    if (/^(?:immediately|as soon as possible|asap)$/i.test(label.trim())) date = new Date(now);
    else if (relative) {
      date = new Date(now);
      if (/month/i.test(relative[2])) date.setMonth(date.getMonth() + Number(relative[1]));
      else date.setDate(date.getDate() + Number(relative[1]) * (/week/i.test(relative[2]) ? 7 : 1));
    }
    const year = label.match(/\b(20\d{2})\b/)?.[1];
    const season = label.match(/\b(spring|summer|fall|autumn|winter)\b/i)?.[1]?.toLowerCase();
    if (!date && year && season) {
      const month = season === 'spring' ? 5 : season === 'summer' ? 8 : 12;
      date = new Date(Number(year), month, 0);
    }
    const exact = optionScore(label, target) >= 0.85;
    if (!date && exact) return { option, score: 1 };
    if (!date || date.getTime() < now.getTime()) continue;
    const distance = Math.abs(date.getTime() - targetTime);
    if (!best || distance < best.distance) best = { option, distance, exact };
  }
  return best ? { option: best.option, score: best.exact ? 1 : 0.9 } : null;
}

/** Summer uses the saved date; other advertised seasons use their saved overrides. */
export function startDateForPosting(profile: import('../types').Profile, title = '', postingText = ''): string {
  if (!/intern/i.test(title)) return profile.answers.earliestStartDate;
  const season = /winter/i.test(title) ? 'winter' : /spring/i.test(title) ? 'spring' : /fall|autumn/i.test(title) ? 'fall' : 'summer';
  if (season === 'summer') return profile.answers.earliestStartDate;
  const override = season === 'winter' ? profile.answers.winterStartDate : season === 'spring' ? profile.answers.springStartDate : profile.answers.fallStartDate;
  if (override) return override;
  const advertised = postingText.match(/\b(?:start(?:ing|s| date)?|begin(?:ning|s)?)\s*(?:on|:)?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})/i)?.[1];
  if (advertised && Number.isFinite(Date.parse(advertised))) {
    const parsed = new Date(advertised);
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  const month = season === 'winter' ? '01' : season === 'spring' ? '03' : '09';
  const now = new Date();
  const explicitYear = title.match(/\b20\d{2}\b/)?.[0];
  const year = explicitYear ?? String(now.getFullYear() + (Number(month) <= now.getMonth() + 1 ? 1 : 0));
  return `${year}-${month}-01`;
}
