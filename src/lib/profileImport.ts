// Filling the profile from a resume (Options → Fill from resume). The local
// helper (scripts/tailor/profile.mjs) returns a draft of what the resume says,
// already checked against its text; this file turns the draft into a list of
// proposed changes for you to review. Fields you already filled are never
// changed unless you tick them, and entries already in your profile are matched
// so they aren't added twice.
import { emptyEducation, emptyExperience, emptyLanguage, emptyProject, LANGUAGE_LEVELS, phoneDigits } from './defaults';
import type { Education, Experience, Language, Profile, Project } from './types';

export interface ProfileDraft {
  personal: Pick<Profile['personal'], 'firstName' | 'middleName' | 'lastName' | 'email' | 'phone' | 'street' | 'city' | 'state' | 'zip' | 'country'>;
  links: Profile['links'];
  education: Pick<Education, 'school' | 'degree' | 'major' | 'minor' | 'gpa' | 'coursework' | 'start' | 'end'>[];
  experience: Pick<Experience, 'company' | 'title' | 'location' | 'start' | 'end' | 'current' | 'description'>[];
  projects: Pick<Project, 'name' | 'role' | 'url' | 'start' | 'end' | 'description'>[];
  skills: string[];
  languages: Pick<Language, 'language' | 'proficiency'>[];
}

/** A profile page picked with the toolbar popup's "Use for my profile", waiting in Options → Fill my profile. */
export interface PageSource {
  title: string;
  url: string;
  text: string;
}

/** Session storage (cleared when the browser closes): the page's text never outlives the browser session. */
export const PAGE_SOURCE_KEY = 'profileImportPage';
/** Characters of a profile page's text to read. */
export const PAGE_SOURCE_LIMIT = 40_000;

const fillEmpty = <T extends object>(into: T, from: T): T => {
  const out = { ...into };
  for (const k of Object.keys(from) as (keyof T)[]) {
    const v = from[k];
    if ((out[k] === '' || out[k] === undefined || out[k] === false) && v !== '' && v !== undefined) out[k] = v;
  }
  return out;
};

/**
 * One draft from several sources (resume first, then pages and pasted text).
 * The first source to give a value keeps it; later ones fill what's empty, and
 * the same school, job or project from two sources becomes one entry.
 */
export function mergeDrafts(drafts: ProfileDraft[]): ProfileDraft {
  const [first, ...rest] = drafts;
  const out: ProfileDraft = structuredClone(first);
  const mergeList = <T extends object>(list: T[], more: T[], id: (x: T) => string) => {
    for (const item of more) {
      const i = list.findIndex((x) => id(x) && id(x) === id(item));
      if (i >= 0) list[i] = fillEmpty(list[i], item);
      else list.push(item);
    }
  };
  for (const d of rest) {
    out.personal = fillEmpty(out.personal, d.personal);
    out.links = fillEmpty(out.links, d.links);
    mergeList(out.education, d.education, (e) => key(e.school));
    mergeList(out.experience, d.experience, (e) => `${key(e.company)}|${key(e.title)}`);
    mergeList(out.projects, d.projects, (p) => key(p.name));
    const skills = new Set(out.skills.map(key));
    out.skills.push(...d.skills.filter((s) => !skills.has(key(s)) && skills.add(key(s))));
    mergeList(out.languages, d.languages, (l) => key(l.language));
  }
  return out;
}

export interface ImportItem {
  id: string;
  /** Sidebar section the change lands in ("Personal", "Education"…). */
  group: string;
  label: string;
  /** What the profile has now ('' = empty, or a new entry). */
  current: string;
  proposed: string;
  /** Ticked at first: empty fields and new entries. Replacing something you wrote starts unticked. */
  checked: boolean;
  apply(profile: Profile): void;
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
const key = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** "2027-05" → "May 2027" for the review list. */
function showDate(value: string): string {
  const [y, m] = value.split('-');
  const month = new Date(2000, Number(m) - 1, 1).toLocaleString('en-US', { month: 'short' });
  return m ? `${month} ${y}` : y;
}

const PERSONAL: [keyof ProfileDraft['personal'], string][] = [
  ['firstName', 'First name'], ['middleName', 'Middle name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['street', 'Street'], ['city', 'City'], ['state', 'State / province'], ['zip', 'ZIP / postal code'], ['country', 'Country'],
];
const LINKS: [keyof Profile['links'], string][] = [
  ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['website', 'Personal website'], ['portfolio', 'Portfolio'], ['twitter', 'X / Twitter'], ['other', 'Other link'],
];

/**
 * One field of an existing entry. `find` re-finds the entry at apply time (by its id),
 * so applying works on the profile you save, not a stale copy.
 */
function fieldItem<T extends { id: string }>(
  items: ImportItem[],
  group: string,
  label: string,
  list: (p: Profile) => T[],
  entry: T,
  field: keyof T & string,
  proposed: string,
  shown = proposed,
): void {
  const current = String(entry[field] ?? '');
  if (!proposed || same(current, proposed)) return;
  items.push({
    id: `${group}:${entry.id}:${field}`,
    group,
    label,
    current: current && field.match(/start|end/) ? showDate(current) : current,
    proposed: shown,
    checked: !current,
    apply: (p) => {
      const target = list(p).find((x) => x.id === entry.id);
      if (target) (target as Record<string, unknown>)[field] = proposed;
    },
  });
}

const dateRange = (start: string, end: string, current = false) =>
  [start && showDate(start), current ? 'Present' : end && showDate(end)].filter(Boolean).join(' – ');

/** Everything the resume would add or change, for the review list. */
export function planImport(profile: Profile, draft: ProfileDraft): ImportItem[] {
  const items: ImportItem[] = [];

  for (const [field, label] of PERSONAL) {
    // Phone numbers are kept as digits only.
    const proposed = field === 'phone' ? phoneDigits(draft.personal.phone, profile.personal.phoneCountryCode) : draft.personal[field];
    const current = profile.personal[field];
    // The country starts out as "United States"; only a different one on the resume is worth showing.
    if (!proposed || same(current, proposed)) continue;
    items.push({ id: `personal:${field}`, group: 'Personal', label, current, proposed, checked: !current, apply: (p) => { p.personal[field] = proposed; } });
  }
  for (const [field, label] of LINKS) {
    const proposed = draft.links[field];
    const current = profile.links[field];
    const bare = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    if (!proposed || bare(current) === bare(proposed)) continue;
    items.push({ id: `links:${field}`, group: 'Links', label, current, proposed, checked: !current, apply: (p) => { p.links[field] = proposed; } });
  }

  // Education: the same school is the same entry.
  for (const ed of draft.education) {
    const existing = profile.education.find((e) => key(e.school) === key(ed.school));
    if (existing) {
      const g = 'Education';
      const list = (p: Profile) => p.education;
      fieldItem(items, g, `${ed.school}: degree`, list, existing, 'degree', ed.degree);
      fieldItem(items, g, `${ed.school}: major`, list, existing, 'major', ed.major);
      fieldItem(items, g, `${ed.school}: minor`, list, existing, 'minor', ed.minor);
      fieldItem(items, g, `${ed.school}: GPA`, list, existing, 'gpa', ed.gpa);
      fieldItem(items, g, `${ed.school}: coursework`, list, existing, 'coursework', ed.coursework);
      fieldItem(items, g, `${ed.school}: start`, list, existing, 'start', ed.start, ed.start && showDate(ed.start));
      fieldItem(items, g, `${ed.school}: graduation`, list, existing, 'end', ed.end, ed.end && showDate(ed.end));
      continue;
    }
    items.push({
      id: `education:new:${key(ed.school)}`,
      group: 'Education',
      label: `Add ${ed.school}`,
      current: '',
      proposed: [[ed.degree, ed.major].filter(Boolean).join(', '), ed.gpa && `GPA ${ed.gpa}`, dateRange(ed.start, ed.end)].filter(Boolean).join(' · '),
      checked: true,
      apply: (p) => { p.education.push({ ...emptyEducation(), ...ed }); },
    });
  }

  // Experience: the same company and role is the same entry (a second role at a company is its own entry).
  for (const job of draft.experience) {
    const existing = profile.experience.find((e) => key(e.company) === key(job.company) && (!job.title || !e.title || key(e.title) === key(job.title)));
    const name = [job.title, job.company].filter(Boolean).join(' at ');
    if (existing) {
      const g = 'Experience';
      const list = (p: Profile) => p.experience;
      fieldItem(items, g, `${name}: title`, list, existing, 'title', job.title);
      fieldItem(items, g, `${name}: location`, list, existing, 'location', job.location);
      fieldItem(items, g, `${name}: start`, list, existing, 'start', job.start, job.start && showDate(job.start));
      if (job.current && !existing.current) {
        items.push({
          id: `Experience:${existing.id}:current`, group: g, label: `${name}: current role`, current: existing.end ? showDate(existing.end) : 'Not current', proposed: 'Present', checked: !existing.end,
          apply: (p) => { const t = p.experience.find((x) => x.id === existing.id); if (t) { t.current = true; t.end = ''; } },
        });
      } else if (!job.current) {
        fieldItem(items, g, `${name}: end`, list, existing, 'end', job.end, job.end && showDate(job.end));
      }
      fieldItem(items, g, `${name}: description`, list, existing, 'description', job.description);
      continue;
    }
    items.push({
      id: `experience:new:${key(job.company)}:${key(job.title)}`,
      group: 'Experience',
      label: `Add ${name}`,
      current: '',
      proposed: [job.location, dateRange(job.start, job.end, job.current), job.description && `${job.description.split('\n').length} bullet(s)`].filter(Boolean).join(' · '),
      checked: true,
      apply: (p) => { p.experience.push({ ...emptyExperience(), ...job }); },
    });
  }

  for (const proj of draft.projects) {
    const existing = profile.projects.find((x) => key(x.name) === key(proj.name));
    if (existing) {
      const g = 'Projects';
      const list = (p: Profile) => p.projects;
      fieldItem(items, g, `${proj.name}: role`, list, existing, 'role', proj.role);
      fieldItem(items, g, `${proj.name}: link`, list, existing, 'url', proj.url);
      fieldItem(items, g, `${proj.name}: start`, list, existing, 'start', proj.start, proj.start && showDate(proj.start));
      fieldItem(items, g, `${proj.name}: end`, list, existing, 'end', proj.end, proj.end && showDate(proj.end));
      fieldItem(items, g, `${proj.name}: description`, list, existing, 'description', proj.description);
      continue;
    }
    items.push({
      id: `projects:new:${key(proj.name)}`,
      group: 'Projects',
      label: `Add ${proj.name}`,
      current: '',
      proposed: [proj.role, proj.url, dateRange(proj.start, proj.end), proj.description && `${proj.description.split('\n').length} bullet(s)`].filter(Boolean).join(' · '),
      checked: true,
      apply: (p) => { p.projects.push({ ...emptyProject(), ...proj }); },
    });
  }

  const have = new Set(profile.skills.map(key));
  const newSkills = draft.skills.filter((s) => !have.has(key(s)));
  if (newSkills.length) {
    items.push({
      id: 'skills:add',
      group: 'Skills',
      label: `Add ${newSkills.length} skill${newSkills.length === 1 ? '' : 's'}`,
      current: '',
      proposed: newSkills.join(', '),
      checked: true,
      apply: (p) => {
        const now = new Set(p.skills.map(key));
        p.skills.push(...newSkills.filter((s) => !now.has(key(s))));
      },
    });
  }

  for (const stated of draft.languages) {
    if (profile.languages.some((l) => key(l.language) === key(stated.language))) continue;
    const lang = { language: stated.language, ...languageLevel(stated.proficiency) };
    items.push({
      id: `languages:new:${key(lang.language)}`,
      group: 'Languages',
      label: `Add ${lang.language}`,
      current: '',
      proposed: lang.proficiency || 'Level not stated',
      checked: true,
      apply: (p) => { p.languages.push({ ...emptyLanguage(), ...lang }); },
    });
  }

  return items;
}

/**
 * A stated level ("Native or bilingual proficiency", "fluent") as one of the levels
 * Options offers; '' when it isn't one of them. Native and Fluent tick "I am fluent".
 */
export function languageLevel(stated: string): Pick<Language, 'proficiency' | 'fluent'> {
  const s = key(stated).replace(/\s*proficiency$/, '');
  const proficiency = LANGUAGE_LEVELS.find((l) => key(l) === s) ?? (s === 'native' || s === 'native speaker' ? 'Native or bilingual' : '');
  return { proficiency, fluent: proficiency === 'Native or bilingual' || proficiency === 'Fluent' };
}

/** Apply the ticked items to `profile` (in place). Returns how many were applied. */
export function applyImport(profile: Profile, items: ImportItem[], chosen: Set<string>): number {
  let n = 0;
  for (const item of items) {
    if (!chosen.has(item.id)) continue;
    item.apply(profile);
    n++;
  }
  return n;
}
