// Registers the tailoring helper with Chrome (and other Chromium browsers that
// are installed) as a native messaging host.
//
//   npm run tailor-install -- <extension-id> [<extension-id> ...]
//
// The extension ID is shown in Options → Resume tailoring. Chrome starts
// helpers with a bare PATH, so a small launcher script records this
// terminal's PATH and the absolute path to node.
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './host.mjs';
import { findClaude } from './claude.mjs';

export const HOST_NAME = 'com.getmeajobpls.tailor';

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const BROWSER_DIRS = platform() === 'darwin'
  ? [
      'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium',
      'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data',
    ].map((d) => join(home, 'Library', 'Application Support', d))
  : ['google-chrome', 'google-chrome-beta', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map((d) => join(home, '.config', d));

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const ids = args.filter((a) => /^[a-p]{32}$/.test(a));
if (!uninstall && !ids.length) {
  console.error('Usage: npm run tailor-install -- <extension-id>\nCopy the ID from the extension\'s Options page → Resume tailoring.');
  process.exit(1);
}

const launcher = join(DATA_DIR, 'host.sh');
const manifests = BROWSER_DIRS.filter(existsSync).map((d) => join(d, 'NativeMessagingHosts', `${HOST_NAME}.json`));

if (uninstall) {
  for (const m of manifests) rmSync(m, { force: true });
  rmSync(launcher, { force: true });
  console.log('Removed the tailoring helper. Cached resume reads stay in', DATA_DIR);
  process.exit(0);
}

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(
  launcher,
  `#!/bin/sh\n# Started by the browser for getmeajobpls resume tailoring.\nexport PATH=${JSON.stringify(process.env.PATH ?? '')}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(here, 'host.mjs'))} "$@"\n`,
);
chmodSync(launcher, 0o755);

const manifest = {
  name: HOST_NAME,
  description: 'getmeajobpls resume tailoring (runs your local Claude Code)',
  path: launcher,
  type: 'stdio',
  allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
};
for (const file of manifests) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  console.log('Registered for', dirname(dirname(file)).replace(home, '~'));
}
if (!manifests.length) console.warn('No Chrome-family browser profile folder found.');

const claude = findClaude();
console.log(claude ? `Claude Code: ${claude}` : 'Claude Code was not found. Install it and run `claude` once to log in.');
console.log('Done. In the extension, Options → Resume tailoring → Test connection.');
