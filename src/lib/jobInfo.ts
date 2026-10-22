// The role, company, location and pay shown at the top of the on-page panel.
// Read from the page only (no requests): the posting's schema.org JobPosting
// data when it has one, then each ATS's own header, then pay ranges in the text.
import { US_STATES } from './engine/text';
import { jobKey } from './tailorMatch';

export interface JobInfo {
  title: string;
  company: string;
  /** One place, or "New York, NY + 2 more". */
  location: string;
  /** Every place, one per line, for a tooltip. */
  locations: string;
  pay: string;
  /** "Posted 3 days ago", "Posted Oct 19, 2026". */
  posted: string;
}

/** Where each ATS shows the posting's details. Update here when a site changes. */
const SITES: { host: RegExp; title?: string; company?: string; location?: string; pay?: string; posted?: string }[] = [
  {
    // Oracle Recruiting: the apply flow's header, and the job details page.
    host: /\.oraclecloud\.com$/,
    title: '.app-header__current-page-title-container [data-bind="text: jobTitle"], .job-details__title',
    location: '.posting-locations li, .job-details__subtitle .job-meta__item',
    pay: '.context-menu__item',
    posted: '.context-menu__item',
  },
  {
    host: /\.myworkday(?:jobs|site)\.com$/,
    title: '[data-automation-id="jobPostingHeader"]',
    location: '[data-automation-id="locations"] dd',
    posted: '[data-automation-id="postedOn"] dd',
    // The sidebar's "About Acme Corporation" heading.
    company: '[data-automation-id="jobSidebar"] h3',
  },
  {
    host: /greenhouse\.io$/,
    title: '.job__title h1, .app-title',
    location: '.job__location, #header .location, .location',
    company: '.company-name',
  },
  {
    host: /(?:^|\.)lever\.co$/,
    title: '.posting-headline h2, .posting-header h2',
    location: '.posting-categories .location, .posting-category.location',
    company: '.main-header-logo img[alt]',
  },
  {
    host: /^jobs\.ashbyhq\.com$/,
    title: 'h1.ashby-job-posting-heading',
  },
  {
    host: /\.smartrecruiters\.com$/,
    title: 'h1.job-title, [data-test="topbar-job-title"]',
    location: '.topbar-location, spl-job-location, .job-location',
    company: '[data-test="topbar-company-name"]',
  },
];

/** The company in an ATS URL slug: boards.greenhouse.io/<acme>, jobs.lever.co/<acme>, <acme>.wd5.myworkdayjobs.com… */
function companyFromUrl(url: URL): string {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let slug = '';
  if (/greenhouse\.io$/.test(host)) slug = url.searchParams.get('for') ?? (parts[0] === 'embed' ? '' : parts[0] ?? '');
  else if (/(?:^|\.)lever\.co$/.test(host) || host === 'jobs.ashbyhq.com' || host === 'apply.workable.com' || host === 'jobs.smartrecruiters.com') slug = parts[0] ?? '';
  if (!slug || slug.length < 3) return '';
  return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const textOf = (doc: Document, selector?: string) => (selector ? clean(doc.querySelector(selector)?.textContent) : '');

// --- schema.org JobPosting -------------------------------------------------------

type Json = Record<string, unknown>;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? clean(String(v)) : '');
const nameOf = (v: unknown) => (typeof v === 'object' && v ? str((v as Json).name) : str(v));

function jobPostings(doc: Document): Json[] {
  const out: Json[] = [];
  const visit = (node: unknown) => {
    for (const item of asArray(node)) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Json;
      if (asArray(obj['@type']).includes('JobPosting')) out.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
    }
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ''));
    } catch {
      // Not JSON; ignore.
    }
  }
  return out;
}

function placeOf(location: unknown): string {
  const address = (typeof location === 'object' && location ? (location as Json).address : null) as Json | string | null;
  if (!address) return nameOf(location);
  if (typeof address === 'string') return clean(address);
  const locality = str(address.addressLocality);
  const parts = [isBuilding(locality) ? '' : locality, str(address.addressRegion)].filter(Boolean);
  const country = nameOf(address.addressCountry);
  // Only a country: worth showing unless it's the US (says nothing about where).
  if (!parts.length && country && !US_COUNTRY.test(country)) parts.push(country);
  return [...new Set(parts)].join(', ');
}

function salaryOf(job: Json): string {
  const salary = job.baseSalary as Json | undefined;
  if (!salary || typeof salary !== 'object') return '';
  const value = (typeof salary.value === 'object' && salary.value ? salary.value : salary) as Json;
  const min = Number(value.minValue ?? value.value);
  const max = Number(value.maxValue ?? value.value);
  if (!Number.isFinite(min) || min <= 0) return '';
  const symbol = { USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$' }[str(salary.currency).toUpperCase()] ?? (str(salary.currency) ? `${str(salary.currency)} ` : '$');
  return formatPay(symbol, min, Number.isFinite(max) && max > min ? max : min, unitFrom(str(value.unitText)));
}

// --- Pay text ----------------------------------------------------------------------

const unitFrom = (text: string): string => {
  if (/\b(?:hour|hourly|hr)\b/i.test(text)) return '/hr';
  if (/\b(?:year|yearly|annual(?:ly)?|annum|yr)\b/i.test(text)) return '/yr';
  if (/\b(?:month|monthly|mo)\b/i.test(text)) return '/mo';
  if (/\b(?:week|weekly|wk)\b/i.test(text)) return '/wk';
  return '';
};

const money = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : Number.isInteger(n) ? String(n) : n.toFixed(2));

function formatPay(symbol: string, min: number, max: number, unit: string): string {
  const range = max > min ? `${symbol}${money(min)} – ${symbol}${money(max)}` : `${symbol}${money(min)}`;
  return `${range}${unit}`;
}

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK])?`;
const PAY_RANGE = new RegExp(String.raw`([$£€])\s?${AMOUNT}\s*(?:-|–|—|to)\s*[$£€]?\s?${AMOUNT}(?:\s*(?:USD|CAD|GBP|EUR))?([^.\n]{0,24})`);
const PAY_SINGLE = new RegExp(String.raw`([$£€])\s?${AMOUNT}\s*(?:USD\s*)?(?:\/|per|an?)\s*(hour|hr|year|yr|annum)\b`, 'i');

const amount = (digits: string, k?: string) => Number(digits.replace(/,/g, '')) * (k ? 1000 : 1);

/** The first pay range ("$135,000 - $155,000 per year", "$40–$45/hr") in some text. */
export function payFromText(text: string): string {
  const range = PAY_RANGE.exec(text);
  if (range) {
    const [, symbol, minDigits, minK, maxDigits, maxK, after] = range;
    const max = amount(maxDigits, maxK);
    // "$80-120K": the k on the top end applies to both.
    const min = amount(minDigits, minK || (maxK && Number(minDigits.replace(/,/g, '')) < 1000 ? maxK : undefined));
    if (min >= 10 && max >= min) return formatPay(symbol, min, max, unitFrom(after));
  }
  const single = PAY_SINGLE.exec(text);
  if (single) {
    const [, symbol, digits, k, unit] = single;
    const value = amount(digits, k);
    if (value >= 10) return formatPay(symbol, value, value, unitFrom(unit));
  }
  return '';
}

// --- Putting it together --------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Posted 3 days ago" for a date within the last month, else "Posted Oct 19, 2026".
 * Text that's already relative ("Posted 30+ Days Ago", "Posted Today") is kept.
 */
export function postedLabel(raw: string, now = new Date()): string {
  const text = clean(raw);
  if (!text) return '';
  if (/\b(?:ago|today|yesterday)\b/i.test(text)) return /^posted\b/i.test(text) ? text.replace(/^posted/i, 'Posted') : `Posted ${text}`;
  // 2026-10-19[T…] or 10/19/2026 (US order, as Oracle and Workday show it).
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : us ? [+us[3], +us[1], +us[2]] : [0, 0, 0];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days < 0) return '';
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days <= 30) return `Posted ${days} days ago`;
  return `Posted ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** A "Location" heading's text on a posting (Ashby: "San Francisco, California; New York, New York"). */
function locationSection(doc: Document): string[] {
  const heading = [...doc.querySelectorAll('h2, h3, h4, dt')].find((el) => /^locations?$/i.test(clean(el.textContent)) && !el.closest('form, label'));
  const value = clean(heading?.nextElementSibling?.textContent);
  return value && value.length <= 300 ? value.split(/\s*;\s*|\s*\|\s*/).filter(Boolean) : [];
}

/** "Software Engineer - Acme Careers" → "Acme"; "Jobs at Acme" → "Acme". */
function companyFromTitle(title: string): string {
  for (const part of title.split(/\s+[|–—-]\s+/)) {
    const m = /^(?:jobs|careers) at (.+)$/i.exec(part.trim()) ?? /^(.+?)\s+(?:careers|jobs)$/i.exec(part.trim());
    if (m && m[1].length <= 40) return m[1].trim();
  }
  return '';
}

export function readJobInfo(doc: Document = document, url: URL = new URL(location.href)): JobInfo {
  const site = SITES.find((s) => s.host.test(url.hostname.toLowerCase()));
  const job = jobPostings(doc)[0];
  const info: JobInfo = { title: '', company: '', location: '', locations: '', pay: '', posted: '' };
  let places: string[] = [];
  let ldPlaces: string[] = [];

  if (job) {
    info.title = str(job.title);
    info.company = nameOf(job.hiringOrganization);
    ldPlaces = asArray(job.jobLocation).map(placeOf).filter(Boolean);
    if (!ldPlaces.length && asArray(job.jobLocationType).some((t) => /telecommute/i.test(str(t)))) ldPlaces = ['Remote'];
    info.pay = salaryOf(job);
    info.posted = postedLabel(str(job.datePosted));
  }

  if (site) {
    info.title ||= textOf(doc, site.title);
    const companyEl = site.company ? doc.querySelector(site.company) : null;
    // A logo's alt text often says so ("Spotify logo").
    info.company ||= clean(companyEl?.getAttribute('alt') ?? companyEl?.textContent).replace(/^about\s+/i, '').replace(/\s+logo$/i, '');
    if (!info.posted && site.posted) {
      // Oracle: "Posting Date: 10/19/2026, 06:37 PM"; Workday: "Posted 3 Days Ago".
      const item = [...doc.querySelectorAll(site.posted)].map((el) => clean(el.textContent)).find((t) => /^(?:posted|posting date)\b/i.test(t));
      info.posted = item ? postedLabel(item.replace(/^(?:posting date|posted on)\s*:?\s*/i, '')) : '';
    }
    // The ATS's own header beats its job data: Workday's data can name a building ("Acme Headquarters").
    if (site.location) places = [...doc.querySelectorAll(site.location)].map((el) => clean(el.textContent).replace(/\s*\/$/, '')).filter(Boolean);
    if (!info.pay && site.pay) {
      // Oracle lists "Base Pay/Salary: New York,NY $135,000.00-$155,000.00; Seattle,WA …".
      const payItem = [...doc.querySelectorAll(site.pay)].find((el) => /\b(?:pay|salary|compensation)\b/i.test(el.textContent ?? ''));
      info.pay = payFromText(clean(payItem?.textContent));
    }
  }

  if (!places.length) places = ldPlaces;
  if (!places.length) places = locationSection(doc);
  info.company ||= clean(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) || companyFromUrl(url) || companyFromTitle(doc.title);
  if (!info.title) {
    const h1 = clean(doc.querySelector('h1')?.textContent);
    // Not a site banner ("Acme Careers", "Join our team").
    if (h1.length <= 120 && !/^(?:apply|application|job application|careers?|join (?:us|our team))$|\b(?:careers|jobs)$|^(?:careers|jobs) at\b/i.test(h1)) info.title = h1;
  }
  info.pay ||= payFromText((doc.body?.innerText || doc.body?.textContent || '').slice(0, 60_000));
  if (normalizeName(info.company) === normalizeName(info.title)) info.company = '';
  places = places.flatMap((p) => p.split(/\s+•\s+/));
  const unique = [...new Set(places.map(cityState).filter(Boolean))];
  info.location = unique.length > 1 ? `${unique[0]} + ${unique.length - 1} more` : unique[0] ?? '';
  info.locations = unique.length > 1 ? unique.join('\n') : '';
  return info;
}

/**
 * A job posting page (before the application): it carries schema.org JobPosting
 * data, or it's a known ATS showing a posting's own header.
 */
export function isJobPosting(doc: Document = document, url: URL = new URL(location.href)): boolean {
  if (jobPostings(doc).length) return true;
  const site = SITES.find((s) => s.host.test(url.hostname.toLowerCase()));
  return !!site?.title && !!textOf(doc, site.title);
}

const US_COUNTRY = /^(?:United States(?: of America)?|U\.?S\.?A?\.?)$/i;

/** A building, office or site code rather than a place: "Acme Headquarters", "01234-100 Main", "Building 4". */
const isBuilding = (place: string) =>
  !endsInState(place) && /\b(?:headquarters|hq|campus|building|bldg|offices?|tower|plaza|cent(?:er|re)|suite|floor|plant|warehouse|facility|distribution)\b/i.test(place)
  || /^\d{3,}[-\s]/.test(clean(place));

/** "Center Valley, PA" is a town, whatever its name says. */
const endsInState = (place: string) => {
  const last = clean(place).replace(/,?\s*(?:United States(?: of America)?|USA?)$/i, '').split(/\s*,\s*/).slice(1).pop()?.toLowerCase() ?? '';
  return !!last && (!!US_STATES[last] || Object.values(US_STATES).includes(last));
};

const STATE_ABBR = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) => [name, abbr.toUpperCase()]));

/**
 * One place as "City, ST": "New York, New York" → "New York, NY", "Seattle, WA, United States"
 * → "Seattle, WA", Workday's "US-CA-San Jose" → "San Jose, CA". Other places keep their own form.
 */
export function cityState(place: string): string {
  if (isBuilding(place)) return '';
  let p = clean(place).replace(/,?\s*(?:United States(?: of America)?|U\.?S\.?A?\.?)$/i, '').replace(/\s+\d{5}(?:-\d{4})?$/, '');
  const workday = /^(?:US|USA)\s*[-,]\s*([A-Za-z]{2})\s*[-,]\s*(.+)$/.exec(p);
  if (workday && US_STATES[workday[1].toLowerCase()]) return `${workday[2].trim()}, ${workday[1].toUpperCase()}`;
  const parts = p.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 2) return p;
  const [city, region] = parts;
  const abbr = STATE_ABBR[region.toLowerCase()] ?? (US_STATES[region.toLowerCase()] ? region.toUpperCase() : '');
  return abbr ? `${city}, ${abbr}` : parts.slice(0, 2).join(', ');
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// --- Carrying a posting's details to its application ----------------------------
// Workday's and Oracle's application steps don't show the pay or location. The
// posting page's details are kept in this tab's session storage (per site, never
// sent anywhere) and shown again on the application for the same job.

const MEMORY_PREFIX = 'getmeajobpls:job:';

/** The same key for a posting and every step of its application (Oracle adds /apply/section/2…). */
export function postingKey(url: URL): string {
  const parts = url.pathname.split('/');
  const apply = parts.findIndex((p, i) => i > 0 && /^apply$/i.test(p));
  const trimmed = new URL(url.href);
  if (apply > 0) trimmed.pathname = parts.slice(0, apply).join('/');
  return jobKey(trimmed.href);
}

function remembered(key: string): JobInfo | null {
  try {
    const raw = sessionStorage.getItem(MEMORY_PREFIX + key);
    return raw ? (JSON.parse(raw) as JobInfo) : null;
  } catch {
    return null;
  }
}

function remember(key: string, info: JobInfo): void {
  try {
    sessionStorage.setItem(MEMORY_PREFIX + key, JSON.stringify(info));
  } catch {
    // Storage blocked or full; the panel still shows this page's details.
  }
}

/**
 * The details to show: on a posting, the page's own (kept for later); on an
 * application, the posting's details seen earlier in this tab, with gaps filled from the page.
 */
export function jobInfoForPage(doc: Document = document, url: URL = new URL(location.href)): JobInfo {
  const current = readJobInfo(doc, url);
  const key = postingKey(url);
  if (!key) return current;
  const before = remembered(key);
  if (isJobPosting(doc, url)) {
    // Workday's application keeps the posting's JobPosting data but not its header,
    // so even a "posting" fills its gaps from what was seen before.
    const merged = before ? merge(current, before) : current;
    if (merged.title) remember(key, merged);
    return merged;
  }
  return before ? merge(before, current) : current;
}

/** `primary`'s details, with any it lacks taken from `fallback`. */
function merge(primary: JobInfo, fallback: JobInfo): JobInfo {
  const out = { ...primary };
  for (const k of Object.keys(out) as (keyof JobInfo)[]) out[k] ||= fallback[k];
  // A location list belongs with the location it came from.
  if (!primary.location) out.locations = fallback.locations;
  return out;
}
