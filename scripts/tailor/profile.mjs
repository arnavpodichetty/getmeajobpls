// Fill the extension's profile from a resume. Claude sorts the resume (already
// read into a ResumeDoc, see claude.mjs) into profile fields; this file then
// keeps only what the resume itself says. Every value must appear in the resume
// text (in the entry it belongs to), dates must match the entry's date line,
// and descriptions and skills are copied straight from the resume, never
// written by the model. Anything that fails a check is left out and listed.

const str = { type: 'string' };
const int = { type: 'integer', minimum: 0 };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const date = { type: 'string', description: '"YYYY-MM", or "" when the resume gives no month and year' };
const ref = { section: int, entry: int };

export const profileSchema = obj({
  personal: obj({ firstName: str, middleName: str, lastName: str, email: str, phone: str, street: str, city: str, state: str, zip: str, country: str }),
  links: obj({ linkedin: str, github: str, website: str, portfolio: str, twitter: str, other: str }),
  education: {
    type: 'array',
    items: obj({ ...ref, school: str, degree: str, major: str, minor: str, gpa: str, coursework: str, start: date, end: date }),
  },
  experience: {
    type: 'array',
    items: obj({ ...ref, company: str, title: str, location: str, start: date, end: date, current: { type: 'boolean' } }),
  },
  projects: {
    type: 'array',
    items: obj({ ...ref, name: str, role: str, url: str, start: date, end: date }),
  },
  languages: { type: 'array', items: obj({ language: str, proficiency: str }) },
});

/** The resume with indices, so Claude can point at each entry. */
function indexed(doc) {
  return {
    name: doc.name,
    contact: doc.contact,
    sections: doc.sections.map((s, si) => ({
      section: si,
      heading: s.heading,
      kind: s.kind,
      ...(s.kind === 'entries' && {
        entries: s.entries.map((e, ei) => ({ entry: ei, title: e.title, titleDetail: e.titleDetail, date: e.date, subtitle: e.subtitle, location: e.location, bullets: e.bullets })),
      }),
      ...(s.kind === 'text' && { paragraphs: s.paragraphs }),
      ...(s.kind === 'skills' && { skills: s.skills }),
    })),
  };
}

export function profilePrompt(doc) {
  return `Sort this resume into the fields of a job-application profile. Return JSON matching the schema.

Rules:
- Copy every value exactly as the resume writes it (same spelling and abbreviations, e.g. "B.S." stays "B.S."). Never add, guess, expand or reword anything. Use "" for anything the resume doesn't state.
- personal: split the name into firstName, middleName and lastName. email, phone and address parts come from the contact line. A "City, ST" in the contact line gives city and state. country only if the resume names it.
- links: from the contact line. linkedin = a linkedin.com address, github = a github.com address, website = a personal site, portfolio = a portfolio site, twitter = a twitter.com or x.com address, other = any other link. Copy the address as written.
- education, experience, projects: one item per resume entry, in resume order, with "section" and "entry" set to that entry's indices.
  - education: school (usually the entry title), degree (e.g. "B.S.", "Bachelor of Science"), major, minor, gpa (just the number, e.g. "3.8"), coursework (the course list after "Coursework:", without that label).
  - experience: company (usually the title), title (the role, usually the subtitle), location, current = true only if the date says Present, Current or Now.
  - projects: name (the title), role (only if stated), url (only if written in the entry).
- Dates: "YYYY-MM" taken from the entry's date line ("May 2027" → "2027-05"). For a range, start is the first date and end the second. A single date on an education entry is its end (graduation). If the date has no month, use "". Leave end "" when current is true.
- languages: spoken languages only (English, Spanish…), never programming languages. proficiency only if stated (e.g. "Native", "Fluent").
- Everything else on the resume (awards, summary, interests) is ignored.

RESUME (indexed):
${JSON.stringify(indexed(doc), null, 1)}`;
}

// --- Checks -------------------------------------------------------------------

const plain = (s) => String(s ?? '').replace(/\*\*|\*/g, '');
const norm = (s) => plain(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();

/** `value` appears in `text` as whole words (case, accents and punctuation ignored). */
export function appearsIn(value, text) {
  const v = norm(value);
  return !!v && ` ${norm(text)} `.includes(` ${v} `);
}

const entryText = (e) => [e.title, e.titleDetail, e.date, e.subtitle, e.location, ...e.bullets].map(plain).join('\n');

function docText(doc) {
  return [doc.name, ...doc.contact, ...doc.sections.flatMap((s) => [s.heading, ...s.entries.map(entryText), ...s.paragraphs, ...s.skills.map((l) => `${l.label}: ${l.items.join(', ')}`)])].map(plain).join('\n');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A "YYYY-MM" the entry's date line supports: the year and month (name or number) are both written there. */
export function dateSupported(value, dateLine) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!m) return false;
  const line = plain(dateLine).toLowerCase();
  const year = m[1];
  const month = Number(m[2]);
  const short = `'${year.slice(2)}`;
  if (!line.includes(year) && !line.includes(short)) return false;
  const name = MONTHS[month - 1];
  const names = name === 'sep' ? ['sep', 'sept'] : [name];
  if (names.some((n) => new RegExp(`\\b${n}`).test(line))) return true;
  // Numeric dates: "05/2027", "5/2027", "2027-05".
  return new RegExp(`(?:^|\\D)0?${month}\\s*[/.-]\\s*(?:${year}|${year.slice(2)})\\b|\\b${year}\\s*[/.-]\\s*0?${month}(?:\\D|$)`).test(line);
}

/** A GPA the entry states as the score, not as the scale ("3.9/4.0" supports 3.9, never 4.0). */
export function gpaSupported(value, text) {
  const v = String(value ?? '').trim();
  if (!/^\d(?:\.\d{1,3})?$/.test(v)) return false;
  return new RegExp(`(?<![\\d.]|/\\s*)${v.replace('.', '\\.')}(?![\\d])`).test(plain(text));
}

const CURRENT = /\b(?:present|current|now|ongoing)\b/i;
const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** "linkedin.com/in/ada" and "https://www.linkedin.com/in/ada/" are the same address. */
const bareUrl = (s) => String(s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

function urlSupported(value, text) {
  const v = bareUrl(value);
  if (!v || !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(v)) return false;
  return text.toLowerCase().split(/[\s|,;•·]+/).some((tok) => bareUrl(tok.replace(/[()<>]/g, '')) === v);
}

const fullUrl = (s) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`);

/** Skill lines that aren't skills. */
const NOT_SKILLS = /certif|interest|hobb|award|honou?r|activit|spoken/i;

/** Digits of every phone-number-like run in some text. */
const phonesIn = (text) => [...String(text).matchAll(/\+?\d[\d\s().-]{5,}\d/g)].map((m) => digits(m[0])).filter((d) => d.length >= 7);

/**
 * The checks shared by every source. `src` says where values may come from:
 * where (for notes), all (the whole text), name, contact (address lines), phones
 * (digit strings), entry(item, label) → { text, date, description } or null, and
 * skills(raw) → the skills to keep.
 */
function verify(raw, src) {
  const dropped = [];
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const missing = (label, v) => dropped.push(`${label}: "${v}" is not on ${src.where}.`);

  /** Keep `value` when it appears in `source`, else note it. */
  const keep = (label, value, source) => {
    const v = s(value);
    if (!v) return '';
    if (appearsIn(v, source)) return v;
    missing(label, v);
    return '';
  };

  const p = r.personal ?? {};
  const personal = {
    firstName: keep('First name', p.firstName, src.name),
    middleName: keep('Middle name', p.middleName, src.name),
    lastName: keep('Last name', p.lastName, src.name),
    email: '',
    phone: '',
    street: keep('Street', p.street, src.contact),
    city: keep('City', p.city, src.contact),
    state: keep('State', p.state, src.contact),
    zip: keep('ZIP', p.zip, src.contact),
    country: keep('Country', p.country, src.contact),
  };
  const email = s(p.email);
  if (email) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && src.all.toLowerCase().includes(email.toLowerCase())) personal.email = email;
    else missing('Email', email);
  }
  const phone = s(p.phone);
  if (phone) {
    const d = digits(phone);
    if (d.length >= 7 && src.phones.some((c) => c === d || c.endsWith(d))) personal.phone = phone;
    else missing('Phone', phone);
  }

  const l = r.links ?? {};
  const links = {};
  for (const key of ['linkedin', 'github', 'website', 'portfolio', 'twitter', 'other']) {
    const v = s(l[key]);
    links[key] = '';
    if (!v) continue;
    if (urlSupported(v, src.all)) links[key] = fullUrl(v);
    else missing('Link', v);
  }

  /** Dates of one entry: each must be supported by its date text. */
  const dates = (label, item, e) => {
    const out = { start: '', end: '' };
    for (const k of ['start', 'end']) {
      const v = s(item[k]);
      if (!v) continue;
      if (dateSupported(v, e.date)) out[k] = v;
      else dropped.push(`${label} ${k} date: "${v}" doesn't match "${shorten(plain(e.date))}".`);
    }
    return out;
  };

  const education = [];
  for (const item of Array.isArray(r.education) ? r.education : []) {
    const e = src.entry(item, 'School', dropped);
    if (!e) continue;
    const school = keep('School', item.school, e.text);
    if (!school) continue;
    const gpa = s(item.gpa);
    if (gpa && !gpaSupported(gpa, e.text)) missing(`${school} GPA`, gpa);
    education.push({
      school,
      degree: keep(`${school} degree`, item.degree, e.text),
      major: keep(`${school} major`, item.major, e.text),
      minor: keep(`${school} minor`, item.minor, e.text),
      gpa: gpa && gpaSupported(gpa, e.text) ? gpa : '',
      coursework: keep(`${school} coursework`, item.coursework, e.text),
      ...dates(school, item, e),
    });
  }

  const experience = [];
  for (const item of Array.isArray(r.experience) ? r.experience : []) {
    const e = src.entry(item, 'Job', dropped);
    if (!e) continue;
    const company = keep('Company', item.company, e.text);
    if (!company) continue;
    const current = item.current === true && CURRENT.test(plain(e.date));
    const d = dates(company, item, e);
    experience.push({
      company,
      title: keep(`${company} title`, item.title, e.text),
      location: keep(`${company} location`, item.location, e.text),
      ...d,
      end: current ? '' : d.end,
      current,
      description: e.description,
    });
  }

  const projects = [];
  for (const item of Array.isArray(r.projects) ? r.projects : []) {
    const e = src.entry(item, 'Project', dropped);
    if (!e) continue;
    const name = keep('Project', item.name, e.text);
    if (!name) continue;
    const url = s(item.url);
    const urlOk = url && urlSupported(url, e.text);
    if (url && !urlOk) missing(`${name} link`, url);
    projects.push({
      name,
      role: keep(`${name} role`, item.role, e.text),
      url: urlOk ? fullUrl(url) : '',
      ...dates(name, item, e),
      description: e.description,
    });
  }

  const languages = [];
  for (const item of Array.isArray(r.languages) ? r.languages : []) {
    const language = keep('Language', item?.language, src.all);
    if (language) languages.push({ language, proficiency: keep(`${language} level`, item?.proficiency, src.all) });
  }

  return { draft: { personal, links, education, experience, projects, skills: src.skills(r, dropped), languages }, dropped };
}

const shorten = (t, n = 80) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * Keep only what the resume supports. Returns the draft (shaped like the
 * extension's profile, see src/lib/profileImport.ts) and a note for each value
 * that was left out.
 */
export function checkProfile(doc, raw) {
  return verify(raw, {
    where: 'the resume',
    all: docText(doc),
    name: plain(doc.name),
    contact: doc.contact.map(plain).join('\n'),
    phones: doc.contact.map(digits),
    // The entry Claude pointed at; null when it pointed somewhere that isn't one.
    entry(item) {
      const e = doc.sections[item?.section]?.entries?.[item?.entry];
      // Descriptions are copied from the resume, one bullet per line.
      return e ? { text: entryText(e), date: e.date, description: e.bullets.map(plain).join('\n') } : null;
    },
    // Skills come straight from the resume's skill lines, not from Claude.
    skills: () => [...new Set(doc.sections
      .filter((sec) => sec.kind === 'skills')
      .flatMap((sec) => sec.skills.filter((line) => !NOT_SKILLS.test(line.label)).flatMap((line) => line.items))
      .map((x) => plain(x).trim())
      .filter(Boolean))],
  });
}

// --- Text sources: a profile page (Simplify, LinkedIn, a personal site) or pasted text ---

/** Longest text sent to Claude from one page or paste. */
export const MAX_TEXT = 40_000;

const entryRef = { quote: { type: 'string', description: 'The passage of the text this entry comes from, copied word for word (title, dates and description)' }, bullets: { type: 'array', items: str, description: 'Description lines copied word for word from the quote' } };

export const textProfileSchema = obj({
  personal: profileSchema.properties.personal,
  links: profileSchema.properties.links,
  education: {
    type: 'array',
    items: obj({ quote: entryRef.quote, school: str, degree: str, major: str, minor: str, gpa: str, coursework: str, start: date, end: date }),
  },
  experience: {
    type: 'array',
    items: obj({ ...entryRef, company: str, title: str, location: str, start: date, end: date, current: { type: 'boolean' } }),
  },
  projects: {
    type: 'array',
    items: obj({ ...entryRef, name: str, role: str, url: str, start: date, end: date }),
  },
  skills: { type: 'array', items: str },
  languages: profileSchema.properties.languages,
});

export function textProfilePrompt(source) {
  const what = source.kind === 'page' ? `a web page about the person (title: ${source.title || 'unknown'}; URL: ${source.url || 'unknown'})` : 'text the person pasted about themselves';
  return `Sort ${what} into the fields of their job-application profile. Return JSON matching the schema.

Rules:
- The text is copied from ${source.kind === 'page' ? 'a web page and includes navigation, ads, suggestions and other people (e.g. "People also viewed", recommendations, comments). Use only the profile owner\'s own details' : 'wherever the person found it. Use only the person\'s own details'}.
- Copy every value exactly as the text writes it. Never add, guess, expand or reword anything. Use "" for anything the text doesn't state.
- personal: the person's name split into firstName, middleName and lastName; email, phone and address parts only if the text shows them.
- links: linkedin = a linkedin.com address, github = a github.com address, website = a personal site, portfolio = a portfolio site, twitter = a twitter.com or x.com address, other = any other link of theirs. Only addresses written in the text.
- education, experience, projects: one item per school, job or project. "quote" = the passage of the text the item comes from, copied word for word, including its dates. "bullets" = the item's description lines, copied word for word from the quote (none if it has no description).
  - education: school, degree (e.g. "B.S.", "Bachelor of Science"), major, minor, gpa (just the number), coursework.
  - experience: company, title (the role), location, current = true only if the text says Present, Current or Now.
  - projects: name, role (only if stated), url (only if written).
- Dates: "YYYY-MM" from the item's dates ("May 2027" → "2027-05"). For a range, start is the first date and end the second. A single date on a school is its end (graduation). If there is no month, use "". Leave end "" when current is true.
- skills: skills the text lists for the person, each copied as written.
- languages: spoken languages only, never programming languages. proficiency only if stated.

TEXT:
"""
${String(source.text ?? '').slice(0, MAX_TEXT)}
"""`;
}

/** Keep only what the page or pasted text supports, the same way as for a resume. */
export function checkProfileText(text, raw, kind = 'page') {
  const all = String(text ?? '').slice(0, MAX_TEXT);
  return verify(raw, {
    where: kind === 'page' ? 'the page' : 'the pasted text',
    all,
    name: all,
    contact: all,
    phones: phonesIn(all),
    // An entry counts only when its quote is really in the text; its fields must then be in the quote.
    entry(item, label, dropped) {
      const quote = typeof item?.quote === 'string' ? item.quote : '';
      if (!quote.trim() || !appearsIn(quote, all)) {
        const name = item?.school || item?.company || item?.name || '';
        dropped.push(`${label}${name ? ` "${name}"` : ''}: its text is not on ${kind === 'page' ? 'the page' : 'the pasted text'}.`);
        return null;
      }
      const lines = (Array.isArray(item.bullets) ? item.bullets : []).filter((b) => typeof b === 'string' && b.trim());
      const kept = lines.filter((b) => appearsIn(b, quote));
      if (kept.length < lines.length) dropped.push(`${label} "${item.school || item.company || item.name}": ${lines.length - kept.length} description line(s) were not in its text.`);
      // Dates and "Present" are read from the quote without its description, which may say "current" in passing.
      const dateText = lines.reduce((t, b) => t.split(b).join(' '), quote);
      return { text: quote, date: dateText, description: kept.map((b) => plain(b).trim()).join('\n') };
    },
    skills: (r, dropped) => {
      const out = [];
      for (const x of Array.isArray(r.skills) ? r.skills : []) {
        if (typeof x !== 'string' || !x.trim()) continue;
        if (appearsIn(x, all)) out.push(x.trim());
        else dropped.push(`Skill: "${x.trim()}" is not on ${kind === 'page' ? 'the page' : 'the pasted text'}.`);
      }
      return [...new Set(out)];
    },
  });
}
