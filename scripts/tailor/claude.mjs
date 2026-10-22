// Runs the local Claude Code CLI (`claude -p`), which uses the Claude account
// you signed in with — no API key. Each run is a fresh session with no plugins,
// MCP servers, hooks or CLAUDE.md, and only the tools named here.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { namedIn } from './guard.mjs';
import { isCurrent, isEducation, linkLibrary } from './library.mjs';
import { resumeDocSchema, tailoringSchema } from './schema.mjs';

const TIMEOUT_MS = 4 * 60_000;

/** CLAUDE_PATH, then PATH, then the usual install spots, then the copy inside the VS Code extension. */
export function findClaude() {
  const home = homedir();
  const onPath = (process.env.PATH ?? '').split(':').filter(Boolean).map((d) => join(d, 'claude'));
  const vscode = join(home, '.vscode', 'extensions');
  const bundled = existsSync(vscode)
    ? readdirSync(vscode)
        .filter((d) => d.startsWith('anthropic.claude-code-'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((d) => join(vscode, d, 'resources', 'native-binary', 'claude'))
    : [];
  const candidates = [
    process.env.CLAUDE_PATH,
    ...onPath,
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    ...bundled,
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

export function claudeVersion(bin) {
  return run(bin, ['--version'], '', homedir(), 20_000).then((out) => out.trim());
}

function run(bin, args, stdin, cwd, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude took too long (over 4 minutes).'));
    }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(friendlyError(out || err) || `claude exited with code ${code}`));
    });
    child.stdin.end(stdin);
  });
}

function friendlyError(text) {
  if (/log ?in|not logged|authenticat|\/login/i.test(text)) return 'Claude Code is not signed in. Run `claude` in a terminal once and log in with your Claude account.';
  if (/usage limit|rate limit/i.test(text)) return 'Your Claude usage limit was reached. Try again later.';
  try {
    const r = JSON.parse(text);
    if (r.result) return String(r.result).slice(0, 300);
  } catch {}
  return text.trim().split('\n').slice(-3).join(' ').slice(0, 300);
}

async function ask(bin, { prompt, schema, tools, cwd }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--tools', tools,
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (tools) args.push('--allowedTools', tools);
  const out = await run(bin, args, prompt, cwd);
  const result = JSON.parse(out);
  if (result.is_error || !result.structured_output) throw new Error(friendlyError(out) || 'Claude returned no result.');
  return result.structured_output;
}

const EXTRACT_PROMPT = `Read the resume PDF at ./resume.pdf with the Read tool and transcribe it into the JSON schema.

Rules:
- Copy text exactly as written: same words, punctuation, capitalization, numbers, dashes and symbols. Do not fix, shorten or summarize anything.
- Keep sections and entries in the order they appear.
- kind "entries": sections made of items with a title and bullets (education, experience, projects, leadership, activities). For each entry: title = the bold name (employer, school, project); titleDetail = text after a "|" on the title line (e.g. a project's tech stack), else ""; date = the date on the title line; subtitle = the second line (role, degree), else ""; location = the location on the second line, else ""; bullets = each bullet point.
- kind "skills": lines of the form "Label: item, item, item". items = the comma-separated items.
- kind "text": anything else (publications, summary, awards written as prose). paragraphs = each paragraph.
- Inside bullets and paragraphs, mark bold text as **bold** and italic text as *italic*. Do not mark titles, subtitles or dates.
- contact = each item of the contact line(s) under the name, in order, without separators.
- style: font "computer-modern" for the LaTeX default font, "times" for Times-like, "garamond" for Garamond-like, "sans" for any sans-serif. headings: "smallcaps-rule" (small caps with a line under), "caps-rule" (ALL CAPS with a line), "bold-rule" (bold with a line), "bold" (no line). nameAlign: how the name is aligned. accent: hex color of the name/headings if they are colored, else "".`;

export function extractResume(bin, cwd) {
  return ask(bin, { prompt: EXTRACT_PROMPT, schema: resumeDocSchema, tools: 'Read', cwd });
}

/**
 * The base resume with explicit indices so the model can point at sections,
 * entries and bullets. Profile lines for an entry continue its bullet indices.
 */
function indexed(doc, lib, links) {
  return doc.sections.map((s, si) => ({
    section: si,
    heading: s.heading,
    kind: s.kind,
    ...(s.kind === 'entries' && {
      entries: s.entries.map((e, ei) => {
        const link = links.get(`${si}:${ei}`);
        const extra = link ? lib[link.kind][link.index].lines : [];
        return {
          entry: ei,
          title: e.title,
          titleDetail: e.titleDetail,
          date: e.date,
          subtitle: e.subtitle,
          ...(isEducation(s) ? { fixed: 'education: never dropped' } : isCurrent(e) ? { fixed: 'current role: never dropped' } : {}),
          bullets: e.bullets.map((b, bi) => ({ i: bi, text: b })),
          ...(extra.length && { moreFromProfile: extra.map((l, li) => ({ i: e.bullets.length + li, text: l })) }),
        };
      }),
    }),
    ...(s.kind === 'skills' && { skills: s.skills }),
  }));
}

/** Profile entries that aren't on the resume, which may be added. */
function addable(lib, unlinked) {
  return unlinked.map(({ kind, index }) => {
    const x = lib[kind][index];
    return {
      kind,
      index,
      ...(kind === 'experience' ? { company: x.company, title: x.title } : { name: x.name }),
      date: x.date,
      lines: x.lines.map((l, i) => ({ i, text: l })),
    };
  });
}

/**
 * @param lib your profile (library.mjs normalizeLibrary)
 * @param fill how much of one page the original fills at 11pt (1.15 = 15% over)
 */
export function tailorResume(bin, cwd, doc, page, lib, fill = 1) {
  const { links, unlinked } = linkLibrary(doc, lib);
  const pct = Math.round(fill * 100);
  const budget = fill > 1
    ? `The original fills ${pct}% of a page at 11pt. Cut about ${pct - 100 + 5}% of the bullet text (drop or tighten the least relevant bullets) so it fits on one page.`
    : `The original fills ${pct}% of a page at 11pt. Keep the total about the same length or shorter.`;
  const others = addable(lib, unlinked);
  const resumeSkills = doc.sections.flatMap((s) => (s.kind === 'skills' ? s.skills.flatMap((l) => l.items) : []));
  const named = [...new Set([...resumeSkills, ...lib.skills])].filter((s) => namedIn(s, page.text));
  const prompt = `You are tailoring a resume to one job posting. Return JSON matching the schema.

What you may do:
- For each entry, rewrite, reorder or drop its bullets so the most relevant work comes first and uses the posting's vocabulary where it describes the same thing. Keep at least one bullet per entry. Always order bullets most relevant first: if the page overflows, bullets are cut from the end.
- Some entries have "moreFromProfile": extra facts the applicant wrote about that same role or project. You may use them for that entry's bullets, the same as its resume bullets.
- Every bullet you return must list in "from" the index (i) of each line of the SAME entry it is based on (its bullets or moreFromProfile).
- Give each entry a relevance from 1 (unrelated to this job) to 5 (directly relevant). If the page overflows, the least relevant projects are cut first.
- Swap entries when it clearly makes the resume a better fit for this job: "drop" a role or project that matters little for this job, and "add" a role or project from OTHER PROFILE ENTRIES that matters more. For an added entry, write 1–3 bullets citing its lines (from = its line indices). Added roles go under the resume's experience section and added projects under its projects section; their names, titles and dates are copied from the profile. Never drop education, a current role, or the last entry of a section. Keep the resume's overall shape: swap only where the gain is clear, and say why in "changes".
- For a titleDetail (comma-separated tech list), reorder and drop items.
- Skills lines: put the skills this posting names or asks for first in each line. Add every skill from PROFILE SKILLS that the posting names (e.g. "OpenAI Codex" → Codex) or plainly describes (e.g. "sprint planning" → Agile/Scrum, "product requirements and user stories" → Requirements & Specs), into the line where it fits; if no line's label fits it, use the most general line (Tools, Other). Then drop the items this posting has least use for, so each line stays about its original length. Never add a skill the posting doesn't call for just to fill space. Keep every line's label exactly.
- "changes": 2–6 short notes on what you changed and why, for the applicant to review.

What you must never do:
- Add any fact that is not in the cited lines: no new numbers, tools, languages, frameworks, companies, team sizes, responsibilities, outcomes or seniority. A rewrite may only say what its cited lines already say, in different words or emphasis.
- Move a skill or tool from one place into a bullet whose cited lines don't mention it.
- Change names, titles, dates, employers, schools or section headings. Those are copied, not written by you.
- Make it longer than one page. ${budget}

Any bullet that adds a number or a technical term missing from its cited lines is automatically thrown away and replaced by those lines.

Keep **bold** / *italic* markers only where the original had them.

RESUME (indexed):
${JSON.stringify(indexed(doc, lib, links), null, 1)}

OTHER PROFILE ENTRIES (not on this resume; may be added):
${others.length ? JSON.stringify(others, null, 1) : 'none'}

PROFILE SKILLS (may be added to skill lines):
${lib.skills.length ? lib.skills.join(', ') : 'none'}

SKILLS THE POSTING NAMES OUTRIGHT (from the resume and PROFILE SKILLS; these must be listed):
${named.length ? named.join(', ') : 'none'}

JOB POSTING PAGE (title: ${page.title || 'unknown'}; URL: ${page.url || 'unknown'}). The text is scraped from the page and may include navigation and application-form text; use only the job description:
"""
${page.text.slice(0, 30_000)}
"""`;
  return ask(bin, { prompt, schema: tailoringSchema, tools: '', cwd });
}
