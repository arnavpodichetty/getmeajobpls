// Keeping a tailored resume to one page. pdf.mjs first shrinks the font (down
// to 10pt); if that isn't enough it calls trimOnce until the page fits:
//   1. the last (least relevant) bullet of the entry with the most bullets,
//      never leaving an entry without one
//   2. then the least relevant project, keeping at least one
// Education and jobs are never removed. Each cut is reported to you.

const clone = (x) => JSON.parse(JSON.stringify(x));
const isEducation = (s) => /educat/i.test(s.heading);
const isProjects = (s) => /project/i.test(s.heading);
const short = (t) => {
  const plain = t.replace(/\*+/g, '');
  return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain;
};

/**
 * @param doc ResumeDoc; entries may carry `relevance` 1 (least) … 5 (most relevant to the job)
 * @returns { doc, note } with one thing removed, or null when nothing more can go
 */
export function trimOnce(doc) {
  const rel = (si, ei) => doc.sections[si].entries[ei].relevance ?? 3;

  let best = null;
  doc.sections.forEach((s, si) => {
    if (s.kind !== 'entries' || isEducation(s)) return;
    s.entries.forEach((e, ei) => {
      if (e.bullets.length < 2) return;
      // Most bullets first; then the less relevant entry; then the one further down.
      const better = !best
        || e.bullets.length > best.n
        || (e.bullets.length === best.n && (rel(si, ei) < best.rel || (rel(si, ei) === best.rel && (si > best.si || (si === best.si && ei > best.ei)))));
      if (better) best = { si, ei, n: e.bullets.length, rel: rel(si, ei) };
    });
  });
  if (best) {
    const out = clone(doc);
    const entry = out.sections[best.si].entries[best.ei];
    const cut = entry.bullets.pop();
    return { doc: out, note: `Cut to fit one page: a bullet under ${entry.title} ("${short(cut)}").` };
  }

  let project = null;
  doc.sections.forEach((s, si) => {
    if (s.kind !== 'entries' || !isProjects(s) || s.entries.length < 2) return;
    s.entries.forEach((e, ei) => {
      if (!project || rel(si, ei) < project.rel || (rel(si, ei) === project.rel && ei > project.ei)) project = { si, ei, rel: rel(si, ei) };
    });
  });
  if (project) {
    const out = clone(doc);
    const [removed] = out.sections[project.si].entries.splice(project.ei, 1);
    return { doc: out, note: `Cut to fit one page: the ${removed.title} project.` };
  }
  return null;
}
