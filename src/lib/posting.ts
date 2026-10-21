// The job description for tailoring when the application page doesn't show it
// (Workday's wizard, Lever's /apply, Ashby's Application tab). Runs in the
// background worker: first the ATS's public job API, then the last posting page
// seen in the same tab.
import { browser } from 'wxt/browser';
import { jobKey } from './tailorMatch';

export interface Posting {
  title: string;
  text: string;
}

interface PostingSource {
  api: string;
  read(json: unknown): Posting | null;
}

/** Shorter than this, a page is a list, a login or an error page, not a posting. */
const MIN_POSTING_TEXT = 800;
const FETCH_TIMEOUT_MS = 8000;

/** HTML from a job API → plain text with one paragraph or list item per line. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return entities[e.toLowerCase()] ?? m;
    });
  // Greenhouse escapes its HTML once more.
  if (!/<[a-z]/i.test(html) && /&lt;[a-z]/i.test(html)) html = decode(html);
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+(?=- )/g, '\n')
    .trim();
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const posting = (title: string, text: string): Posting | null => (text.trim() ? { title: title.trim(), text: text.trim() } : null);

/** The public job API that holds the description for this posting or application URL, if the ATS has one. */
export function postingSource(pageUrl: string): PostingSource | null {
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const enc = (s: string) => encodeURIComponent(s);

  // Workday: /[locale/]<site>/job/<location>/<slug>[/apply/...] or /<site>/details/<slug>;
  // myworkdaysite.com puts /recruiting/<tenant>/ before the site.
  if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) {
    const at = parts.findIndex((p) => p === 'job' || p === 'details');
    if (at < 1) return null;
    const rec = parts.indexOf('recruiting');
    const tenant = rec >= 0 ? parts[rec + 1] : host.split('.')[0];
    const site = parts[at - 1];
    const apply = parts.indexOf('apply', at);
    const rest = parts.slice(at + 1, apply > at ? apply : undefined);
    if (!tenant || !site || !rest.length || site === tenant) return null;
    return {
      api: `${u.origin}/wday/cxs/${enc(tenant)}/${enc(site)}/job/${rest.map(enc).join('/')}`,
      read(json) {
        const info = (json as { jobPostingInfo?: Record<string, unknown> })?.jobPostingInfo;
        return info ? posting(str(info.title), htmlToText(str(info.jobDescription))) : null;
      },
    };
  }

  // Lever: jobs.lever.co/<company>/<id>[/apply]
  if ((host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') && parts.length >= 2) {
    const api = host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co';
    return {
      api: `https://${api}/v0/postings/${enc(parts[0])}/${enc(parts[1])}`,
      read(json) {
        const j = json as { text?: unknown; descriptionPlain?: unknown; lists?: { text?: unknown; content?: unknown }[]; additionalPlain?: unknown };
        const lists = (Array.isArray(j?.lists) ? j.lists : []).map((l) => `${str(l.text)}\n${htmlToText(str(l.content))}`);
        return posting(str(j?.text), [str(j?.descriptionPlain), ...lists, str(j?.additionalPlain)].filter(Boolean).join('\n\n'));
      },
    };
  }

  // Ashby: jobs.ashbyhq.com/<org>/<id>[/application]. The board API lists every open job.
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    const id = parts[1].toLowerCase();
    return {
      api: `https://api.ashbyhq.com/posting-api/job-board/${enc(parts[0])}`,
      read(json) {
        const jobs = (json as { jobs?: Record<string, unknown>[] })?.jobs;
        const job = Array.isArray(jobs) ? jobs.find((j) => str(j.id).toLowerCase() === id) : undefined;
        return job ? posting(str(job.title), str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml))) : null;
      },
    };
  }

  // Greenhouse: (job-)boards.greenhouse.io/<company>/jobs/<id>, or the embedded form ?for=<company>&token=<id>
  if (host.endsWith('greenhouse.io')) {
    const jobs = parts.indexOf('jobs');
    const board = jobs > 0 ? parts[jobs - 1] : u.searchParams.get('for');
    const id = jobs > 0 ? parts[jobs + 1] : u.searchParams.get('token');
    if (!board || !id || !/^\d+$/.test(id)) return null;
    return {
      api: `https://boards-api.greenhouse.io/v1/boards/${enc(board)}/jobs/${id}`,
      read(json) {
        const j = json as { title?: unknown; content?: unknown };
        return posting(str(j?.title), htmlToText(str(j?.content)));
      },
    };
  }
  return null;
}

async function fetchPosting(pageUrl: string): Promise<Posting | null> {
  const source = postingSource(pageUrl);
  if (!source) return null;
  try {
    const res = await fetch(source.api, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return source.read(await res.json());
  } catch {
    return null;
  }
}

// --- Posting pages seen in each tab -----------------------------------------

interface Seen extends Posting {
  key: string;
  host: string;
}

const seenKey = (tabId: number) => `posting:${tabId}`;
const hostOf = (key: string) => key.split('/')[0];

/** Remember a page that isn't an application form, in case the application that follows doesn't show the description. */
export async function rememberPosting(tabId: number, url: string, page: Posting): Promise<void> {
  const key = jobKey(url);
  if (!key || page.text.trim().length < MIN_POSTING_TEXT) return;
  await browser.storage.session.set({ [seenKey(tabId)]: { key, host: hostOf(key), title: page.title, text: page.text } satisfies Seen });
}

export async function forgetPostings(tabId: number): Promise<void> {
  await browser.storage.session.remove(seenKey(tabId));
}

/** The description for the job on this tab: from the ATS's API, else the last posting page seen on the same site in this tab. */
export async function findPosting(tabId: number, url: string): Promise<Posting | null> {
  const fetched = await fetchPosting(url);
  if (fetched && fetched.text.length >= 200) return fetched;
  const key = jobKey(url);
  const seen = (await browser.storage.session.get(seenKey(tabId)))[seenKey(tabId)] as Seen | undefined;
  return seen && key && seen.host === hostOf(key) ? { title: seen.title, text: seen.text } : null;
}
