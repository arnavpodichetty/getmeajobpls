// Your profile's Experience, Projects and skills as extra source material for
// tailoring. Each description line is a citable "line", like a resume bullet.
//   - A profile entry that matches a resume entry (same company / project name)
//     adds its lines to that entry's sources.
//   - Profile entries not on the resume can be added; their dates, titles and
//     companies come from the profile, never from the model.

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One point per line; a single paragraph is split into sentences. Leading bullet marks are dropped. */
export function descriptionLines(description) {
  const lines = text(description).split(/\n+/).map((l) => l.replace(/^\s*[-•*–·]\s*/, '').trim()).filter(Boolean);
  if (lines.length !== 1) return lines;
  return lines[0].split(/(?<=[.!?])\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
}

/** "2026-05" → "May 2026" */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(text(ym));
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`.trim() : text(ym);
}

export function dateRange(start, end, current) {
  const a = monthLabel(start);
  const b = current ? 'Present' : monthLabel(end);
  return a && b ? `${a} – ${b}` : a || b;
}

export function normalizeLibrary(raw) {
  const lib = raw && typeof raw === 'object' ? raw : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    experience: list(lib.experience)
      .map((e) => ({
        company: text(e?.company),
        title: text(e?.title),
        location: text(e?.location),
        date: dateRange(e?.start, e?.end, !!e?.current),
        current: !!e?.current,
        lines: descriptionLines(e?.description),
      }))
      .filter((e) => e.company && e.lines.length),
    projects: list(lib.projects)
      .map((p) => ({
        name: text(p?.name),
        role: text(p?.role),
        date: dateRange(p?.start, p?.end, false),
        lines: descriptionLines(p?.description),
      }))
      .filter((p) => p.name && p.lines.length),
    skills: [...new Set(list(lib.skills).map(text).filter(Boolean))],
  };
}

const isExperience = (s) => /experience|employment|work|research/i.test(s.heading) && !/project/i.test(s.heading);
const isProjects = (s) => /project/i.test(s.heading);
export const isEducation = (s) => /educat/i.test(s.heading);

/** Same company or project name, ignoring case and punctuation ("Initech" = "Initech, Inc."). */
function sameName(a, b) {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

/**
 * Pair resume entries with profile entries.
 * @returns { links: Map<"si:ei", {kind, index}>, unlinked: [{kind, index}] }
 */
export function linkLibrary(doc, lib) {
  const links = new Map();
  const used = new Set();
  doc.sections.forEach((s, si) => {
    if (s.kind !== 'entries' || isEducation(s)) return;
    s.entries.forEach((e, ei) => {
      const kinds = isProjects(s) ? ['projects', 'experience'] : ['experience', 'projects'];
      for (const kind of kinds) {
        const index = lib[kind].findIndex((x, i) => !used.has(`${kind}:${i}`) && sameName(kind === 'experience' ? x.company : x.name, e.title));
        if (index >= 0) {
          used.add(`${kind}:${index}`);
          links.set(`${si}:${ei}`, { kind, index });
          return;
        }
      }
    });
  });
  const unlinked = ['experience', 'projects'].flatMap((kind) => lib[kind].map((_, index) => ({ kind, index })).filter((x) => !used.has(`${x.kind}:${x.index}`)));
  return { links, unlinked };
}

/** The resume section a profile entry goes into, or -1 if the resume has none. */
export function targetSection(doc, kind) {
  return doc.sections.findIndex((s) => s.kind === 'entries' && (kind === 'projects' ? isProjects(s) : isExperience(s)));
}

/** A resume entry built only from profile fields. */
export function entryFromLibrary(lib, kind, index) {
  if (kind === 'experience') {
    const e = lib.experience[index];
    return { title: e.company, titleDetail: '', date: e.date, subtitle: e.title, location: e.location, bullets: [] };
  }
  const p = lib.projects[index];
  return { title: p.name, titleDetail: '', date: p.date, subtitle: '', location: '', bullets: [] };
}

/** Rough end date for ordering (Present sorts first); 0 when unknown. */
export function endValue(date) {
  if (/present|current|now/i.test(date)) return Infinity;
  const all = [...date.matchAll(/(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(\d{4})/gi)];
  const last = all.at(-1);
  if (!last) return 0;
  const month = last[1] ? MONTHS.findIndex((m) => m.toLowerCase() === last[1].slice(0, 3).toLowerCase()) : 11;
  return Number(last[2]) * 12 + month;
}

export const isCurrent = (entry) => /present|current/i.test(entry.date);
