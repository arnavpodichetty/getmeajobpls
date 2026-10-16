// Move "Capture page" snapshots from your Downloads folder into this repo's
// captures/ folder (git-ignored). The extension can only save to Downloads.
//
//   npm run pull-captures              → move what's there now
//   npm run pull-captures -- --watch   → keep running and move new ones as they arrive
//
// Only files named like a capture are moved: <host>-<ISO timestamp>.html,
// e.g. job-boards.greenhouse.io-2026-10-16T00-09-16-028Z.html.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURE = /^[a-z0-9.-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?: \(\d+\))?\.html$/i;
const downloads = process.env.DOWNLOADS_DIR ?? join(homedir(), 'Downloads');
const captures = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'captures');

if (!existsSync(downloads)) {
  console.error(`No Downloads folder at ${downloads}. Set DOWNLOADS_DIR to where your browser saves files.`);
  process.exit(1);
}
mkdirSync(captures, { recursive: true });

function move(name) {
  if (!CAPTURE.test(name)) return false;
  const from = join(downloads, name);
  // Chrome writes to a .crdownload file and renames it when done, so a finished file is complete.
  if (!existsSync(from) || !statSync(from).isFile()) return false;
  const to = join(captures, name.replace(/ \((\d+)\)\.html$/, '-$1.html'));
  renameSync(from, to);
  console.log(`captures/${to.slice(captures.length + 1)}`);
  return true;
}

const moved = readdirSync(downloads).filter(move).length;
console.log(moved ? `Moved ${moved} capture${moved === 1 ? '' : 's'} into captures/.` : 'No captures in Downloads.');

if (process.argv.includes('--watch')) {
  console.log(`Watching ${downloads} for new captures (Ctrl+C to stop)…`);
  watch(downloads, (_event, name) => {
    if (name) setTimeout(() => move(name), 300);
  });
}
