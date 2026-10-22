// Applies a Tailoring to a base ResumeDoc and enforces that nothing new is
// claimed. The model can only:
//   - reword, reorder or drop bullets, each citing the lines it came from: the
//     entry's resume bullets, plus the description lines of the matching entry
//     in your profile (Options → Experience / Projects)
//   - add an entry from your profile that isn't on the resume (fields copied
//     from the profile, bullets citing its lines), or remove a role or project
//     (never education, a current role or a section's last entry)
//   - reorder or drop items in a project's tech list, and use skills from the
//     resume or your profile's skill sets in the skill lines
// Skills the posting names outright (and that you have) are always listed, first
// in their line; a line they grow drops its unnamed items from the end.
// Names, contact details, headings, employers, titles, dates, locations,
// schools and text sections (publications) always come from the base resume.
//
// A rewritten bullet is checked against the bullets it cites (plus its entry's
// title line). If it has a number or a technical term those don't have, the
// cited original bullets are used instead and a warning says why. Wrong-but-
// confident is worse than untailored, so every doubtful case falls back.

import { endValue, entryFromLibrary, isCurrent, isEducation, linkLibrary, targetSection } from './library.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const lower = (s) => s.toLowerCase();

/** Numbers as written: 1,000+ → 1000, 38.5K → 38.5, 0.72–0.76 → 0.72 and 0.76. */
export function numbers(text) {
  return (text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

const WORD = /[A-Za-z][A-Za-z0-9+#./&'-]*[A-Za-z0-9+#]|[A-Za-z]/g;
const stripMarks = (s) => s.replace(/\*+/g, '');

/** Lowercased words, with a plural "s" also stored without it. */
export function vocabulary(...texts) {
  const vocab = new Set();
  for (const t of texts) {
    for (const w of stripMarks(t).match(WORD) ?? []) {
      const l = lower(w);
      vocab.add(l);
      vocab.add(l.replace(/s$/, ''));
      // "gradient-boosted" also allows "gradient" and "boosted".
      for (const part of l.split(/[-/]/)) if (part) vocab.add(part);
    }
  }
  return vocab;
}

/**
 * Words that name a specific thing (tools, companies, acronyms, versions):
 * any capital after the first letter, any digit or + # . / &, or a capitalized
 * word that doesn't start a sentence.
 */
export function terms(text) {
  const out = [];
  const plain = stripMarks(text);
  for (const m of plain.matchAll(WORD)) {
    const w = m[0].replace(/[.'-]+$/, '');
    const before = plain.slice(0, m.index).trimEnd();
    const startsSentence = before === '' || /[.:;!?]$/.test(before);
    if (/[A-Z]/.test(w.slice(1)) || /[0-9+#./&]/.test(w) || (/^[A-Z]/.test(w) && !startsSentence)) out.push(w);
  }
  return out;
}

/** Why a rewritten bullet can't be trusted, or null if everything in it is backed by its sources. */
export function unsupported(text, sourceText) {
  const have = new Set(numbers(sourceText));
  const n = numbers(text).find((x) => !have.has(x));
  if (n) return `"${n}" isn't in the original bullet`;
  const vocab = vocabulary(sourceText);
  const t = terms(text).find((w) => {
    const l = lower(w);
    return !vocab.has(l) && !vocab.has(l.replace(/s$/, '')) && !l.split(/[-/]/).every((p) => !p || vocab.has(p));
  });
  return t ? `"${t}" isn't in the original bullet` : null;
}

const key = (s) => lower(s.trim());

/** Keep items that exist in the base list (base spelling), in the order given. */
function subset(items, baseItems) {
  const byKey = new Map(baseItems.map((b) => [key(b), b]));
  const seen = new Set();
  const out = [];
  for (const i of items) {
    const b = byKey.get(key(i));
    if (b && !seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

/**
 * Rewritten bullets, checked against the lines they cite. A rewrite that adds
 * a number or term its sources don't have is replaced by the cited lines.
 */
function rewrite(proposed, sources, header, label, warnings) {
  const used = new Set();
  const bullets = [];
  for (const b of Array.isArray(proposed) ? proposed : []) {
    const from = [...new Set((b.from ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < sources.length))];
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!from.length || !text) continue;
    const why = unsupported(text, `${from.map((i) => sources[i]).join(' ')} ${header}`);
    if (!why) {
      bullets.push(text);
      from.forEach((i) => used.add(i));
      continue;
    }
    warnings.push(`${label}: kept the original wording because ${why}.`);
    for (const i of from) {
      if (used.has(i)) continue;
      used.add(i);
      bullets.push(sources[i]);
    }
  }
  return bullets;
}

/**
 * @param base the resume as a ResumeDoc
 * @param tailoring the model's answer (tailoringSchema)
 * @param lib your profile (library.mjs normalizeLibrary); optional
 * @returns { doc, warnings, swaps } — swaps describe entries added from your profile or removed
 */
export function applyTailoring(base, tailoring, lib = { experience: [], projects: [], skills: [] }, posting = '') {
  const doc = clone(base);
  const warnings = [];
  const swaps = [];
  const t = tailoring ?? {};
  const { links, unlinked } = linkLibrary(base, lib);
  /** Profile lines for a resume entry, cited after its own bullets. */
  const extra = (si, ei) => {
    const link = links.get(`${si}:${ei}`);
    return link ? lib[link.kind][link.index].lines : [];
  };

  for (const te of t.entries ?? []) {
    const sec = base.sections[te.section];
    const be = sec?.kind === 'entries' ? sec.entries[te.entry] : undefined;
    if (!be) continue;
    const out = doc.sections[te.section].entries[te.entry];
    const label = be.title || sec.heading;
    // Used only to decide what to cut first if the page overflows (fit.mjs).
    if (Number.isInteger(te.relevance)) out.relevance = Math.min(5, Math.max(1, te.relevance));

    if (be.titleDetail && typeof te.titleDetail === 'string') {
      const items = subset(te.titleDetail.split(','), be.titleDetail.split(',').map((x) => x.trim()));
      if (items.length) out.titleDetail = items.join(', ');
    }

    const sources = [...be.bullets, ...extra(te.section, te.entry)];
    if (!Array.isArray(te.bullets) || !sources.length) continue;
    const bullets = rewrite(te.bullets, sources, [be.title, be.titleDetail, be.subtitle].join(' '), label, warnings);
    out.bullets = bullets.length ? bullets : be.bullets.slice();
  }

  // Removing roles or projects to make room. Never education, a current role,
  // or a section's last entry.
  const drop = new Set();
  for (const d of t.drop ?? []) {
    const sec = base.sections[d?.section];
    const be = sec?.kind === 'entries' ? sec.entries[d.entry] : undefined;
    if (!be || isEducation(sec) || isCurrent(be)) continue;
    const left = sec.entries.filter((_, ei) => ei !== d.entry && !drop.has(`${d.section}:${ei}`)).length;
    if (!left) continue;
    drop.add(`${d.section}:${d.entry}`);
    swaps.push(`Removed ${be.title} to make room for more relevant work.`);
  }

  // Adding profile entries that aren't on the resume, built only from profile fields.
  const added = [];
  const open = new Set(unlinked.map((u) => `${u.kind}:${u.index}`));
  for (const a of t.add ?? []) {
    if (!open.has(`${a?.kind}:${a?.index}`)) continue;
    open.delete(`${a.kind}:${a.index}`);
    const si = targetSection(base, a.kind);
    if (si < 0) continue;
    const entry = entryFromLibrary(lib, a.kind, a.index);
    const lines = lib[a.kind][a.index].lines;
    entry.bullets = rewrite(a.bullets, lines, [entry.title, entry.subtitle].join(' '), entry.title, warnings);
    if (!entry.bullets.length) continue;
    if (Number.isInteger(a.relevance)) entry.relevance = Math.min(5, Math.max(1, a.relevance));
    added.push({ si, entry });
    swaps.push(`Added ${entry.title} from your profile.`);
  }

  doc.sections.forEach((s, si) => {
    if (s.kind === 'entries') s.entries = s.entries.filter((_, ei) => !drop.has(`${si}:${ei}`));
  });
  // Newest first, like the rest of the resume.
  for (const { si, entry } of added) {
    const list = doc.sections[si].entries;
    const at = list.findIndex((e) => endValue(e.date) < endValue(entry.date));
    list.splice(at < 0 ? list.length : at, 0, entry);
  }

  const seen = new Set();
  for (const ts of t.skills ?? []) {
    const sec = base.sections[ts.section];
    if (sec?.kind !== 'skills' || !Array.isArray(ts.lines)) continue;
    const lines = [];
    const done = new Set();
    for (const tl of ts.lines) {
      const bl = sec.skills.find((l) => key(l.label) === key(tl.label ?? ''));
      if (!bl || done.has(bl)) continue;
      done.add(bl);
      // A line's own items, plus any skill from your profile not already listed elsewhere.
      const items = subset(tl.items ?? [], [...bl.items, ...lib.skills]).filter((i) => !seen.has(key(i)));
      items.forEach((i) => seen.add(key(i)));
      lines.push({ label: bl.label, items: items.length ? items : bl.items.slice() });
    }
    // A line the model left out stays as it was.
    for (const bl of sec.skills) if (!done.has(bl)) lines.push(clone(bl));
    doc.sections[ts.section].skills = lines;
  }

  const named = postingSkills(base, doc, lib, posting);
  if (named.length) swaps.push(`Added ${named.join(', ')} to your skills because the posting names ${named.length === 1 ? 'it' : 'them'}.`);

  return { doc, warnings, swaps };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Tool names that are also everyday words ("excel in", "a linear model", "react quickly").
const PROPER = /^[A-Z][a-z]+$/;

/** Whether the posting names this skill: "Agile/Scrum" counts for "agile"; "Excel" must be capitalized. */
export function namedIn(skill, posting) {
  const parts = [skill, ...(skill.includes('/') ? skill.split('/').filter((p) => p.trim().length >= 4) : [])];
  return parts.some((part) => {
    const p = part.trim();
    const re = new RegExp(`(?<![A-Za-z0-9])${escape(p)}(?![A-Za-z0-9+#])`, p === skill && PROPER.test(p) ? '' : 'i');
    return re.test(posting);
  });
}

/** Line for a profile skill that isn't on the resume: the tools/other line, else the last non-language line. */
function lineFor(lines) {
  const general = lines.filter((l) => /tool|software|technolog|platform|other|skill|framework/i.test(l.label));
  if (general.length) return general[general.length - 1];
  const rest = lines.filter((l) => !/language/i.test(l.label));
  return rest[rest.length - 1] ?? lines[lines.length - 1];
}

const width = (items) => items.join(', ').length;

/**
 * Makes sure skills the posting names are listed. Returns the profile skills it
 * added that the tailored resume left out.
 */
function postingSkills(base, doc, lib, posting) {
  if (!posting) return [];
  const added = [];
  doc.sections.forEach((sec, si) => {
    if (sec.kind !== 'skills' || !sec.skills.length) return;
    const baseLines = base.sections[si].skills;
    const listed = () => new Set(sec.skills.flatMap((l) => l.items.map(key)));
    const grown = new Set();
    const tailored = new Map(sec.skills.map((l) => [l, width(l.items)]));
    // A posting-named item the tailoring dropped goes back into its own line.
    baseLines.forEach((bl) => {
      const line = sec.skills.find((l) => key(l.label) === key(bl.label));
      if (!line) return;
      for (const item of bl.items) {
        if (!listed().has(key(item)) && namedIn(item, posting)) {
          line.items.push(item);
          grown.add(line);
        }
      }
    });
    for (const skill of lib.skills ?? []) {
      if (listed().has(key(skill)) || !namedIn(skill, posting)) continue;
      const line = lineFor(sec.skills);
      line.items.push(skill);
      grown.add(line);
      added.push(skill);
    }
    for (const line of sec.skills) {
      // Named skills first, keeping the tailored order within each group.
      const named = line.items.filter((i) => namedIn(i, posting));
      line.items = [...named, ...line.items.filter((i) => !named.includes(i))];
      if (!grown.has(line)) continue;
      // Keep a grown line no longer than it was by dropping unnamed items from the end.
      const was = Math.max(tailored.get(line) ?? 0, width(baseLines.find((bl) => key(bl.label) === key(line.label))?.items ?? []));
      while (width(line.items) > was && line.items.length > named.length) line.items.pop();
    }
  });
  return added;
}
