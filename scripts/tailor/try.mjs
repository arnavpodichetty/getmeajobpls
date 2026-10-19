// Run the tailoring pipeline from a terminal, without the extension.
//
//   npm run tailor-try -- <resume.pdf> <posting.txt> <out.pdf> [profile.json]
//
// profile.json is optional: { experience: [...], projects: [...], skills: [...] }
// in the extension's format (Options → Backup → Export JSON has it under "profile").
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tailor } from './host.mjs';

const [resume, posting, out, profileFile] = process.argv.slice(2);
if (!resume || !posting || !out) {
  console.error('Usage: npm run tailor-try -- <resume.pdf> <posting.txt> <out.pdf> [profile.json]');
  process.exit(1);
}
/** Accepts a bare profile or a full backup ({ profile: {...} }). */
function profileOf(json) {
  const p = json.profile ?? json;
  return { experience: p.experience, projects: p.projects, skills: [...(p.skills ?? []), ...(p.skillSets ?? []).flatMap((s) => s.skills ?? []), ...(p.tailoringSkills ?? [])] };
}

const started = Date.now();
const res = await tailor({
  resume: { name: basename(resume), base64: readFileSync(resume).toString('base64') },
  page: { title: basename(posting, '.txt'), url: '', text: readFileSync(posting, 'utf8') },
  profile: profileFile ? profileOf(JSON.parse(readFileSync(profileFile, 'utf8'))) : undefined,
});
writeFileSync(out, Buffer.from(res.base64, 'base64'));
console.log(`Wrote ${out} (${res.pages} page${res.pages === 1 ? '' : 's'}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const c of res.changes) console.log(`  change: ${c}`);
for (const w of res.warnings) console.log(`  check:  ${w}`);
