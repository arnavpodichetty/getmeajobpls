// Reading a resume PDF into profile fields without Claude (Options → Fill my profile →
// Read resume). pdfText.ts pulls the text out with pdf.js; this file rebuilds the lines
// and sorts them into the same ProfileDraft the Claude reader returns, so the review
// list is shared. Every value is text copied from the resume: nothing is guessed, and
// anything the layout doesn't make clear is left out for you to add.
import type { ProfileDraft } from './profileImport';

/** A run of text on one line, split from the next run by a wide gap (a right-aligned date or location). */
export interface Segment {
  x: number;
  text: string;
}

export interface Line {
  page: number;
  /** Baseline, from the top of the page. */
  y: number;
  /** Left edge of the first character (a bullet counts). */
  x: number;
  /** Right edge of the last character. */
  right: number;
  /** Largest font size on the line. */
  size: number;
  segments: Segment[];
  text: string;
}

/** A clickable link in the PDF and where it sits (y from the top of its page). */
export interface LinkTarget {
  url: string;
  page: number;
  y: number;
}

/** The parts of a pdf.js TextItem this file uses. */
export interface PdfItem {
  str: string;
  width: number;
  transform: number[];
}

/** Rebuild lines from one page's text items. Items closer than a few points vertically share a line. */
export function linesFromItems(items: PdfItem[], page = 0, pageHeight = 792): Line[] {
  const glyphs = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [a, b, c, d, x, y] = it.transform;
      return { str: it.str, x, y: pageHeight - y, w: it.width, size: Math.hypot(c, d) || Math.hypot(a, b) };
    })
    .sort((p, q) => p.y - q.y || p.x - q.x);

  const rows: (typeof glyphs)[] = [];
  for (const g of glyphs) {
    const row = rows.find((r) => Math.abs(r[0].y - g.y) <= Math.max(2.5, Math.min(r[0].size, g.size) * 0.3));
    if (row) row.push(g);
    else rows.push([g]);
  }

  return rows
    .map((row) => {
      row.sort((p, q) => p.x - q.x);
      const size = Math.max(...row.map((g) => g.size));
      const segments: Segment[] = [];
      let end = -Infinity;
      for (const g of row) {
        const gap = g.x - end;
        const last = segments[segments.length - 1];
        if (!last || gap > Math.max(14, size * 1.6)) segments.push({ x: g.x, text: g.str });
        else last.text += gap > size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(g.str) ? ` ${g.str}` : g.str;
        end = Math.max(end, g.x + g.w);
      }
      for (const s of segments) s.text = clean(s.text);
      const kept = segments.filter((s) => s.text);
      // The main text's baseline: small bullet glyphs sit a little off it.
      const y = row.reduce((m, g) => (g.size >= m.size ? g : m)).y;
      return { page, y, x: row[0].x, right: end, size, segments: kept, text: kept.map((s) => s.text).join('  ') };
    })
    .filter((l) => l.text)
    .sort((p, q) => p.y - q.y);
}

const clean = (s: string) =>
  s
    .replace(/[  -  ]/g, ' ')
    .replace(/[​­]/g, '')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/\s+/g, ' ')
    .trim();

// --- Sections ------------------------------------------------------------------

type Kind = 'education' | 'experience' | 'projects' | 'skills' | 'languages' | 'other';

const HEADINGS: [Kind, RegExp][] = [
  ['education', /^(?:education|academic background|academics|education (?:and|&) (?:training|certifications?))$/],
  ['experience', /^(?:(?:work|professional|relevant|research|industry|employment|internship|technical|engineering) )?(?:experience|experiences|employment|employment history|work history)$|^internships?$|^research$/],
  ['projects', /^(?:(?:personal|academic|selected|technical|relevant|side|key|software|research) )?projects$|^projects?(?: (?:and|&) \w+)?$/],
  ['skills', /^(?:(?:technical|relevant|core|key|computer|programming) )?(?:skills|proficiencies)(?: (?:and|&) [a-z]+)?$|^[a-z]+ (?:and|&) skills$|^technologies$|^tools(?: (?:and|&) technologies)?$|^skills (?:summary|profile)$/],
  ['languages', /^(?:spoken )?languages$/],
  [
    'other',
    /^(?:summary|profile|objective|about(?: me)?|professional summary|career objective|publications?|awards?|honors?|honors (?:and|&) awards|awards (?:and|&) honors|achievements|certifications?|certificates|licenses(?: (?:and|&) certifications)?|activities|extracurriculars?|extracurricular activities|leadership|leadership (?:and|&) (?:activities|involvement|experience)|involvement|campus involvement|volunteer(?:ing| work| experience)?|community service|interests|hobbies|references|relevant coursework|coursework|additional(?: information)?|affiliations|memberships|presentations|patents|research interests|teaching(?: experience)?)$/,
  ],
];

function headingKind(line: Line): Kind | null {
  if (line.segments.length > 1 || /\d/.test(line.text) || line.text.length > 45) return null;
  const t = line.text.toLowerCase().replace(/[:|]+$/, '').replace(/\s+/g, ' ').trim();
  if (t.split(' ').length > 5) return null;
  for (const [kind, re] of HEADINGS) if (re.test(t)) return kind;
  return null;
}

// --- Dates ---------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const ONE_DATE = String.raw`(?:${MONTH},? \d{4}|\d{1,2}\/\d{4}|(?:Spring|Summer|Fall|Autumn|Winter) \d{4}|\d{4})`;
const END_DATE = String.raw`(?:${ONE_DATE}|Present|Current|Now|Ongoing|Today)`;
const RANGE = new RegExp(String.raw`(?:(?:Expected|Anticipated|Exp\.?|Graduat(?:ed|ing|ion)|Class of)[: ]+)?(${ONE_DATE})(?:\s*(?:–|—|-|to|until)\s*(${END_DATE}))?`, 'i');

/** "May 2027" or "05/2027" → "2027-05"; a year or season alone → '' (no month). */
export function monthYear(s: string): string {
  const m = new RegExp(String.raw`^(${MONTH}),? (\d{4})$`, 'i').exec(s.trim());
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}`;
  const n = /^(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (n && +n[1] >= 1 && +n[1] <= 12) return `${n[2]}-${n[1].padStart(2, '0')}`;
  return '';
}

interface Dates {
  start: string;
  end: string;
  current: boolean;
  /** The date text as written, to cut out of the line. */
  raw: string;
}

function findDates(text: string): Dates | null {
  const m = RANGE.exec(text);
  if (!m) return null;
  // A bare year inside other text ("Top 2025 Hackathon") isn't an entry's date unless it's a whole segment.
  if (/^\d{4}$/.test(m[1]) && !m[2] && m[0].trim() !== text.trim()) return null;
  const current = !!m[2] && /^(?:present|current|now|ongoing|today)$/i.test(m[2]);
  if (!m[2]) return { start: '', end: monthYear(m[1]), current: false, raw: m[0] };
  return { start: monthYear(m[1]), end: current ? '' : monthYear(m[2]), current, raw: m[0] };
}

// --- Entries -------------------------------------------------------------------

const BULLET = /^[•◦▪▫■□●○‣⁃∙·➢➤►▸▹✓✔◆◇♦❖*–—-]\s*/;

interface Entry {
  headers: Line[];
  bullets: string[];
}

/** Split a section's lines into entries: header lines (name, role, dates) followed by bullets. */
function entriesOf(lines: Line[]): Entry[] {
  const out: Entry[] = [];
  let cur: Entry | null = null;
  // Where the last bullet's text starts, so wrapped lines join it.
  let bulletX: number | null = null;
  let bodySize = 0;
  // Bullets drawn as shapes (Word, Google Docs, browsers) leave no glyph: those lines are indented instead.
  const margin = Math.min(...lines.map((l) => l.x));
  const widest = Math.max(...lines.map((l) => l.right));
  let prev: Line | null = null;
  const datesIn = (e: Entry) => e.headers.some((h) => h.segments.some((s) => findDates(s.text)));
  for (const line of lines) {
    const before = prev;
    prev = line;
    if (BULLET.test(line.text)) {
      const text = line.text.replace(BULLET, '');
      if (!cur) out.push((cur = { headers: [], bullets: [] }));
      cur.bullets.push(text);
      const first = line.segments[0];
      bulletX = first.text.replace(BULLET, '') ? first.x + (line.x === first.x ? line.size : 0) : line.segments[1]?.x ?? null;
      // pdf.js often gives the bullet glyph its own item; the text starts at the next one.
      bodySize = line.size;
      continue;
    }
    // A wrapped bullet line starts where the bullet's text did (and is never bigger than it).
    if (cur && cur.bullets.length && bulletX !== null && Math.abs(line.x - bulletX) <= 3 && line.size <= bodySize + 0.5 && !findDates(line.segments[line.segments.length - 1].text.trim())) {
      const prev = cur.bullets.length - 1;
      cur.bullets[prev] = /[a-z]-$/.test(cur.bullets[prev]) ? cur.bullets[prev] + line.text : `${cur.bullets[prev]} ${line.text}`;
      continue;
    }
    bulletX = null;
    const hasDate = line.segments.some((s) => findDates(s.text));
    if (cur && line.x > margin + 6 && !hasDate && line.segments.length === 1) {
      // An indented line under an entry: a new bullet, or the rest of one that filled the line above.
      const wraps = before && cur.bullets.length && before.x > margin + 6 && before.right > widest - line.size * 4 && !/[.!?]$/.test(cur.bullets[cur.bullets.length - 1]);
      if (wraps) cur.bullets[cur.bullets.length - 1] += /[a-z]-$/.test(cur.bullets[cur.bullets.length - 1]) ? line.text : ` ${line.text}`;
      else cur.bullets.push(line.text);
      continue;
    }
    if (!cur || cur.bullets.length || (hasDate && datesIn(cur)) || cur.headers.length >= 3) out.push((cur = { headers: [], bullets: [] }));
    cur.headers.push(line);
  }
  return out;
}

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' '));

const LOCATION = /^(?:[A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*)*, ?(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)*)(?:, ?[A-Z][A-Za-z]+(?: [A-Z][a-z]+)*)?|Remote|Hybrid|On-?site|(?:[A-Z][A-Za-z.'-]+ )*\(?(?:Remote|Hybrid)\)?)$/;
const isLocation = (s: string) => LOCATION.test(s.trim()) && s.length <= 40;

/** Words that make a phrase a job title rather than a company. */
const TITLE_WORDS = /\b(?:intern|internship|engineer|engineering|developer|analyst|assistant|associate|manager|researcher|research|scientist|consultant|designer|apprentice|fellow|director|coordinator|specialist|officer|president|founder|co-founder|tutor|teacher|teaching|instructor|lead|leader|head|member|volunteer|representative|administrator|architect|technician|editor|writer|strategist|trainee|student|ambassador|chair|captain|cashier|clerk|advisor|adviser|mentor|counselor|programmer|operator|owner|partner|vp|ceo|cto|coo|cfo)\b/i;
const SCHOOL_WORDS = /\b(?:university|college|institute|school|academy|polytechnic|conservatory|universidad|universite|universit[aä]t|iit|mit)\b/i;

interface Header {
  /** The left-hand text of each header line, date and location removed, split at " | " and " — ". */
  parts: string[];
  location: string;
  dates: Dates | null;
}

function readHeader(e: Entry): Header {
  let dates: Dates | null = null;
  let location = '';
  const parts: string[] = [];
  for (const line of e.headers) {
    for (const [i, seg] of line.segments.entries()) {
      let text = seg.text;
      const d = findDates(text);
      if (d && !dates) {
        dates = d;
        text = text.replace(d.raw, '');
      }
      text = text.replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, '');
      if (!text) continue;
      const pieces = i === 0 ? text.split(/\s+[|–—]\s+|\s+-\s+|\s+·\s+/) : [text];
      for (const piece of pieces) {
        let p = piece.trim();
        if (!p) continue;
        // "Example Group, Chicago, IL": the company, then where it is.
        const tail = /^(.+?),\s*([A-Z][A-Za-z.' -]+,\s*([A-Z]{2}))$/.exec(p);
        if (tail && US_STATES.has(tail[3]) && !isLocation(tail[1]) && !location) {
          location = tail[2];
          p = tail[1];
        }
        if (!location && isLocation(p) && (i > 0 || parts.length)) location = p;
        else if (i === 0) parts.push(p);
        else if (!location && isLocation(p)) location = p;
      }
    }
  }
  return { parts, location, dates };
}

function experienceOf(e: Entry): ProfileDraft['experience'][number] | null {
  const h = readHeader(e);
  let [company = '', title = ''] = h.parts;
  if (!title && company.includes(', ') && TITLE_WORDS.test(company.split(', ')[0]) && !TITLE_WORDS.test(company.split(', ').slice(1).join(', '))) {
    [title, company] = [company.split(', ')[0], company.split(', ').slice(1).join(', ')];
  } else if (!title && / at /.test(company)) {
    [title, company] = company.split(/ at (.+)/);
  } else if (TITLE_WORDS.test(company) && !TITLE_WORDS.test(title)) {
    [company, title] = [title, company];
  } else if (!title && TITLE_WORDS.test(company)) {
    [company, title] = ['', company];
  }
  if (!company && !title) return null;
  return {
    company,
    title,
    location: h.location,
    start: h.dates?.start ?? '',
    end: h.dates?.end ?? '',
    current: h.dates?.current ?? false,
    description: e.bullets.join('\n'),
  };
}

const DEGREE = /\b((?:Bachelor|Master|Associate|Doctor)(?:'s|’s)?(?: of (?:[A-Z][a-z]+)(?: (?:and |& )?[A-Z][a-z]+)*)?|Ph\.? ?D\.?|M\.? ?B\.? ?A\.?|B\.? ?S\. ?E\.?|B\.? ?Sc\.?|M\.? ?Sc\.?|B\.? ?Eng\.?|M\.? ?Eng\.?|B\.? ?B\.? ?A\.?|B\.? ?F\.? ?A\.?|B\. ?[AS]\.?|M\. ?[AS]\.?|A\. ?[AS]\.?|BS|BA|MS|MA|High School Diploma)(?=$|[\s,;:()|])/g;

/** DEGREE without the global flag, for yes/no checks (a /g regex remembers where it stopped). */
const HAS_DEGREE = new RegExp(DEGREE.source);

function educationOf(e: Entry): ProfileDraft['education'][number] | null {
  const h = readHeader(e);
  const all = [...h.parts, ...e.bullets];
  let school = h.parts.find((p) => SCHOOL_WORDS.test(p)) ?? '';
  // "University of X, Springfield" stays whole; a trailing ", City, ST" is the location.
  if (!school) school = h.parts.find((p) => !HAS_DEGREE.test(p)) ?? '';
  if (!school) return null;
  const rest = all.filter((p) => p !== school).join(' ; ');

  let degree = '';
  let major = '';
  let secondMajor = '';
  for (const m of rest.matchAll(DEGREE)) {
    const after = rest.slice((m.index ?? 0) + m[0].length);
    const field = /^,?\s*(?:in|of)?\s*([A-Z][^,;()|]*?)(?=\s*(?:$|[,;()|]|\bwith\b|\band\b(?= minor)|\bminor\b))/i.exec(after)?.[1]?.trim() ?? '';
    const ok = field && !/^(?:minor|gpa|expected|class)\b/i.test(field) && !SCHOOL_WORDS.test(field);
    if (!degree) {
      degree = m[1];
      if (ok) major = field;
    } else if (ok && field !== major && !secondMajor) secondMajor = field;
  }
  // "Computer Science, B.S." puts the major first.
  if (degree && !major) {
    const before = rest.split(degree)[0].replace(/[,\s]+$/, '');
    const last = before.split(/[;|]/).pop()?.trim() ?? '';
    if (last && !SCHOOL_WORDS.test(last) && !isLocation(last) && last.length <= 60) major = last;
  }
  if (!major) major = /\bmajor(?:ing)?(?: in)?:?\s+([A-Z][^,;()|]*)/i.exec(rest)?.[1]?.trim() ?? '';
  const minor =
    /\bminors? in:?\s+([A-Z][^,;()|]*?)(?=\s*(?:$|[,;()|]))/i.exec(rest)?.[1]?.trim() ??
    /(?:^|[,;(]\s*)([A-Z][A-Za-z &]*?)\s+minor\b/i.exec(rest)?.[1]?.trim() ??
    /\bminor:\s*([A-Z][^,;()|]*)/i.exec(rest)?.[1]?.trim() ??
    '';
  const gpa = /\bG\.?P\.?A\.?\s*[:\-–]?\s*([0-4]\.\d{1,3})/i.exec(rest)?.[1] ?? /\b([0-4]\.\d{1,3})\s*\/\s*4(?:\.0+)?\s*(?:cumulative )?G\.?P\.?A\b/i.exec(rest)?.[1] ?? '';
  const coursework = /(?:relevant |selected |key )?coursework\s*:\s*([^;]+)/i.exec(e.bullets.join(' ; ') || rest)?.[1]?.replace(/\.$/, '').trim() ?? '';

  const draft: ProfileDraft['education'][number] = { school, degree, major, minor, gpa, coursework, start: h.dates?.start ?? '', end: h.dates?.current ? '' : (h.dates?.end ?? '') };
  if (secondMajor) draft.secondMajor = secondMajor;
  return draft;
}

const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app|co|me|edu|xyz|tech|site|page|info|us|uk|ca|in)(?:\/[^\s|,;)]*)?/gi;

function projectOf(e: Entry): ProfileDraft['projects'][number] | null {
  const h = readHeader(e);
  const name = h.parts[0] ?? '';
  if (!name) return null;
  const url = [...e.headers.map((l) => l.text)].join(' ').match(URL_RE)?.find((u) => !u.includes('@')) ?? '';
  return { name, role: '', url: url ? fullUrl(url) : '', start: h.dates?.start ?? '', end: h.dates?.current ? '' : (h.dates?.end ?? ''), description: e.bullets.join('\n') };
}

// --- Skills and languages --------------------------------------------------------

const NOT_SKILLS = /certif|interest|hobb|award|honou?r|activit|spoken|coursework|leadership|involvement|volunteer|clubs?\b|organi[sz]ations|membership|publication/i;
const SPOKEN = /^(?:english|spanish|french|german|italian|portuguese|mandarin|chinese|cantonese|japanese|korean|hindi|urdu|bengali|bangla|punjabi|gujarati|marathi|telugu|tamil|kannada|malayalam|arabic|hebrew|persian|farsi|turkish|russian|ukrainian|polish|dutch|greek|swedish|norwegian|danish|finnish|czech|romanian|hungarian|vietnamese|thai|tagalog|filipino|indonesian|malay|swahili|amharic|somali|haitian creole|american sign language|asl)$/i;

/** Split "Python, SQL (PostgreSQL, SQLite), Java" at the top-level commas. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;•|·]/.test(ch)) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/\.$/, '')).filter((x) => x && x.length <= 40);
}

/** A spoken language with its stated level: "Spanish (Fluent)", "Hindi - Native". */
function spoken(item: string): ProfileDraft['languages'][number] | null {
  const m = /^([A-Za-z ]+?)\s*(?:\(([^)]+)\)|[-–:]\s*(.+))?$/.exec(item.trim());
  if (!m || !SPOKEN.test(m[1].trim())) return null;
  return { language: m[1].trim(), proficiency: (m[2] ?? m[3] ?? '').trim() };
}

function readSkills(lines: Line[], kind: 'skills' | 'languages', draft: ProfileDraft): void {
  // Join wrapped lines onto the labeled line above them.
  const rows: { label: string; items: string }[] = [];
  for (const line of lines) {
    const text = line.text.replace(BULLET, '');
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(text);
    if (m) rows.push({ label: m[1].trim(), items: m[2] });
    else if (rows.length && rows[rows.length - 1].label && !BULLET.test(line.text)) rows[rows.length - 1].items += ` ${text}`;
    else rows.push({ label: '', items: text });
  }
  for (const row of rows) {
    if (row.label && NOT_SKILLS.test(row.label)) {
      if (/spoken/i.test(row.label)) for (const it of splitList(row.items)) { const l = spoken(it); if (l) draft.languages.push(l); }
      continue;
    }
    for (const item of splitList(row.items)) {
      const lang = spoken(item);
      if (lang) draft.languages.push(lang);
      else if (kind === 'skills') draft.skills.push(item);
    }
  }
}

// --- Contact ----------------------------------------------------------------------

const fullUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
const bare = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');

function readContact(header: Line[], targets: LinkTarget[], draft: ProfileDraft): void {
  if (!header.length) return;
  // The name is the biggest text at the top; anything beside it is contact info.
  const nameLine = header.reduce((m, l) => (l.size > m.size + 0.5 ? l : m), header[0]);
  const name = nameLine.segments[0].text.replace(/,.*$/, '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w)) && !/@|\d/.test(name)) {
    const cased = words.map((w) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w));
    const suffix = /^(?:jr|sr|ii|iii|iv)\.?$/i.test(cased[cased.length - 1]) ? cased.pop() : '';
    draft.personal.firstName = cased[0];
    draft.personal.lastName = [cased[cased.length - 1], suffix].filter(Boolean).join(' ');
    if (cased.length === 3) draft.personal.middleName = cased[1];
  }

  // Links behind the header's words; ones further down (a project demo, a paper) aren't yours.
  const last = header[header.length - 1];
  const links = targets.filter((t) => t.page < last.page || (t.page === last.page && t.y <= last.y + 6)).map((t) => t.url);
  const contact = header.flatMap((l) => (l === nameLine ? l.segments.slice(1) : l.segments)).map((s) => s.text).join(' | ');
  draft.personal.email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(contact)?.[0] ?? links.find((u) => u.startsWith('mailto:'))?.slice(7).split('?')[0] ?? '';
  const phone = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d[\d\s().-]{7,}\d/.exec(contact)?.[0];
  draft.personal.phone = phone?.trim() ?? links.find((u) => u.startsWith('tel:'))?.slice(4) ?? '';

  for (const piece of contact.split(/\s*[|•·◦⋄♦✉☎]\s*|\s{2,}/)) {
    const p = piece.trim();
    if (!p || p.includes('@') || /\d{3}.*\d{4}/.test(p) || /\.(?:com|org|net|io|dev|me|edu)\b/i.test(p)) continue;
    const addr = /^(\d+[^,]+),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(p);
    const city = /^([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(p);
    if (addr && US_STATES.has(addr[3])) {
      Object.assign(draft.personal, { street: addr[1].trim(), city: addr[2].trim(), state: addr[3], zip: addr[4] ?? '' });
      break;
    }
    if (city) {
      // "London, UK" gives the city; only a US state code is a state.
      Object.assign(draft.personal, US_STATES.has(city[2]) ? { city: city[1].trim(), state: city[2], zip: city[3] ?? '' } : { city: city[1].trim() });
      break;
    }
  }

  // Links: written in the header, or behind a clickable word ("LinkedIn").
  const found = [...(contact.match(URL_RE) ?? []).filter((u) => !contact.includes(`@${u}`) && !/@/.test(u)), ...links.filter((u) => /^https?:/i.test(u))];
  const seen = new Set<string>();
  for (const raw of found) {
    const u = raw.replace(/[.,]+$/, '');
    if (seen.has(bare(u))) continue;
    seen.add(bare(u));
    const host = bare(u).split('/')[0];
    const path = bare(u).split('/').slice(1).filter(Boolean);
    if (/linkedin\.com$/.test(host)) draft.links.linkedin ||= fullUrl(u);
    else if (/github\.com$/.test(host)) {
      if (path.length === 1) draft.links.github ||= fullUrl(u);
    } else if (/(?:^|\.)(?:twitter|x)\.com$/.test(host)) draft.links.twitter ||= fullUrl(u);
    else {
      if (/portfolio/i.test(u)) draft.links.portfolio ||= fullUrl(u);
      else if (!draft.links.website) draft.links.website = fullUrl(u);
      else draft.links.other ||= fullUrl(u);
    }
  }
}

// --- Whole resume ---------------------------------------------------------------

export function emptyDraft(): ProfileDraft {
  return {
    personal: { firstName: '', middleName: '', lastName: '', email: '', phone: '', street: '', city: '', state: '', zip: '', country: '' },
    links: { linkedin: '', github: '', website: '', portfolio: '', twitter: '', other: '' },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    languages: [],
  };
}

/** Sort a resume's lines (every page, in reading order) into profile fields. `links` are the PDF's link targets. */
export function parseResume(lines: Line[], links: LinkTarget[] = []): ProfileDraft {
  const draft = emptyDraft();
  const sections: { kind: Kind; lines: Line[] }[] = [];
  const header: Line[] = [];
  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) sections.push({ kind, lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else header.push(line);
  }

  readContact(header, links, draft);
  for (const s of sections) {
    if (s.kind === 'education') draft.education.push(...entriesOf(s.lines).map(educationOf).filter((x) => x !== null));
    if (s.kind === 'experience') draft.experience.push(...entriesOf(s.lines).map(experienceOf).filter((x) => x !== null));
    if (s.kind === 'projects') draft.projects.push(...entriesOf(s.lines).map(projectOf).filter((x) => x !== null));
    if (s.kind === 'skills' || s.kind === 'languages') readSkills(s.lines, s.kind, draft);
  }
  draft.skills = [...new Map(draft.skills.map((x) => [x.toLowerCase(), x])).values()];
  draft.languages = [...new Map(draft.languages.map((l) => [l.language.toLowerCase(), l])).values()];
  return draft;
}
