// "Today" in the time zone from Settings (Pacific by default), never UTC: in the
// evening UTC is already tomorrow, and forms reject a signature date that isn't today.

export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

/** Choices for the Settings dropdown; '' follows the computer's own time zone. */
export const TIME_ZONES: [string, string][] = [
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain, no DST (Phoenix)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/New_York', 'Eastern (New York)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
  ['', "This computer's time zone"],
];

let zone = DEFAULT_TIME_ZONE;

export function setTimeZone(timeZone: string | undefined): void {
  zone = timeZone ?? DEFAULT_TIME_ZONE;
}

/** Today's date as YYYY-MM-DD in the chosen time zone. */
export function todayISO(now = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}
