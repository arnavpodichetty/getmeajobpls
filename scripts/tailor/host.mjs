// Chrome native messaging host for resume tailoring. Chrome starts this script
// for each request (chrome.runtime.sendNativeMessage), sends one message on
// stdin and reads one reply on stdout, both as a 4-byte length + JSON.
//
// Requests:
//   { type: 'ping' } → { ok, claude, claudeVersion }
//   { type: 'tailor', resume: { name, base64 }, page: { title, url, text },
//     profile: { experience, projects, skills } }   (see library.mjs)
//     → { ok, base64, changes, warnings, pages }
//   { type: 'profile', resume: { name, base64 } }
//     → { ok, draft, dropped }   (profile fields found on the resume; see profile.mjs)
//   { type: 'profileText', source: { kind: 'page' | 'paste', title, url, text } }
//     → { ok, draft, dropped }   (the same, from a profile page or pasted text)
//
// The first time a resume file is seen, Claude reads it into a ResumeDoc
// (cached by file hash in the app-data folder below, never in the repo).
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeVersion, extractResume, findClaude, sortProfile, sortProfileText, tailorResume } from './claude.mjs';
import { applyTailoring } from './guard.mjs';
import { normalizeLibrary } from './library.mjs';
import { checkProfile, checkProfileText } from './profile.mjs';
import { normalizeDoc } from './schema.mjs';
import { pageFill, renderOnePage } from './pdf.mjs';

export const DATA_DIR = platform() === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'getmeajobpls', 'tailor')
  : join(homedir(), '.config', 'getmeajobpls', 'tailor');
// Chrome rejects replies over 1 MB.
const MAX_REPLY = 1024 * 1024 - 1024;

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let size = -1;
    process.stdin.on('data', (c) => {
      chunks.push(c);
      received += c.length;
      // Join chunks only once the whole message is here (resumes arrive in many chunks).
      if (size < 0) {
        if (received < 4) return;
        size = Buffer.concat(chunks).readUInt32LE(0);
      }
      if (received < 4 + size) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).subarray(4, 4 + size).toString('utf8')));
      } catch (err) {
        // Reply with the error instead of crashing without an answer.
        reject(err);
      }
    });
    process.stdin.on('end', () => reject(new Error('No message from Chrome.')));
  });
}

function writeMessage(msg) {
  let body = Buffer.from(JSON.stringify(msg), 'utf8');
  if (body.length > MAX_REPLY) body = Buffer.from(JSON.stringify({ ok: false, error: 'The tailored PDF is too large to send back to Chrome.' }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([len, body]), resolve));
}

function log(line) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, 'host.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

/** Read a resume into a ResumeDoc once per file (cached as { doc }). */
async function baseDoc(bin, pdf, work) {
  const hash = createHash('sha256').update(pdf).digest('hex');
  const cacheFile = join(DATA_DIR, 'base', `${hash}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  writeFileSync(join(work, 'resume.pdf'), pdf);
  const doc = normalizeDoc(await extractResume(bin, work));
  if (!doc.name || !doc.sections.length) throw new Error('Claude could not read this resume PDF.');
  const base = { doc };
  mkdirSync(join(DATA_DIR, 'base'), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(base, null, 2));
  return base;
}

export async function tailor(msg) {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code is not installed. Install it (see Options → Resume tailoring), run `claude` once to log in, then try again.');
  const pdf = Buffer.from(msg.resume?.base64 ?? '', 'base64');
  if (!pdf.length) throw new Error('No resume file was sent.');
  const page = { title: String(msg.page?.title ?? ''), url: String(msg.page?.url ?? ''), text: String(msg.page?.text ?? '') };
  if (page.text.trim().length < 200) throw new Error('No job description found on this page.');

  const work = mkdtempSync(join(tmpdir(), 'getmeajobpls-tailor-'));
  try {
    const base = await baseDoc(bin, pdf, work);
    const fill = await pageFill(base.doc);
    // Your profile's Experience, Projects and skills, sent along by the extension.
    const lib = normalizeLibrary(msg.profile);
    const tailoring = await tailorResume(bin, work, base.doc, page, lib, fill);
    const { doc, warnings, swaps } = applyTailoring(base.doc, tailoring, lib, page.text);
    // Always one page: smaller font first (down to 10pt), then the least relevant bullets and projects.
    const out = await renderOnePage(doc);
    warnings.push(...out.cuts);
    if (out.pages > 1) warnings.push('Still longer than one page after every allowed cut; shorten the original resume.');
    return {
      ok: true,
      base64: out.pdf.toString('base64'),
      changes: [...swaps, ...(Array.isArray(tailoring.changes) ? tailoring.changes.filter((c) => typeof c === 'string') : [])],
      warnings,
      pages: out.pages,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Fill the profile from a resume: everything kept is checked against the resume's own text. */
export async function profileFromResume(msg) {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code is not installed. Install it (see Options → Resume tailoring), run `claude` once to log in, then try again.');
  const pdf = Buffer.from(msg.resume?.base64 ?? '', 'base64');
  if (!pdf.length) throw new Error('No resume file was sent.');
  const work = mkdtempSync(join(tmpdir(), 'getmeajobpls-profile-'));
  try {
    const base = await baseDoc(bin, pdf, work);
    const raw = await sortProfile(bin, work, base.doc);
    return { ok: true, ...checkProfile(base.doc, raw) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Fill the profile from a page or pasted text: entries count only when their quoted text is really there. */
export async function profileFromText(msg) {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code is not installed. Install it (see Options → Resume tailoring), run `claude` once to log in, then try again.');
  const kind = msg.source?.kind === 'paste' ? 'paste' : 'page';
  const source = { kind, title: String(msg.source?.title ?? ''), url: String(msg.source?.url ?? ''), text: String(msg.source?.text ?? '') };
  if (source.text.trim().length < 20) throw new Error(kind === 'page' ? 'That page had no text to read.' : 'The pasted text is empty.');
  const work = mkdtempSync(join(tmpdir(), 'getmeajobpls-profile-'));
  try {
    const raw = await sortProfileText(bin, work, source);
    return { ok: true, ...checkProfileText(source.text, raw, kind) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function handle(msg) {
  if (msg?.type === 'ping') {
    const bin = findClaude();
    return { ok: true, claude: bin, claudeVersion: bin ? await claudeVersion(bin).catch(() => '') : '' };
  }
  if (msg?.type === 'tailor') return tailor(msg);
  if (msg?.type === 'profile') return profileFromResume(msg);
  if (msg?.type === 'profileText') return profileFromText(msg);
  throw new Error(`Unknown request: ${msg?.type}`);
}

// Run only when started by Chrome (not when imported by tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  readMessage()
    .then(handle)
    .catch((err) => {
      log(`error: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    })
    .then(writeMessage)
    .then(() => process.exit(0));
}
