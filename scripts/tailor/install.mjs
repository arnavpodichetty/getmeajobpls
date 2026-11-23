// Registers the tailoring helper as a native messaging host with Chrome (and other
// Chromium browsers that are installed) and with Firefox-based browsers (Firefox, Zen).
//
//   npm run tailor-install -- <extension-id> [<extension-id> ...]
//
// The extension ID is shown in Options → Resume tailoring. Chrome IDs are 32 letters
// and differ per install; the Firefox build always has FIREFOX_ID (see wxt.config.ts).
// Browsers start helpers with a bare PATH, so a small launcher script records this
// terminal's PATH and the absolute path to node.
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './host.mjs';
import { findClaude } from './claude.mjs';

export const HOST_NAME = 'com.getmeajobpls.tailor';
/** Must match FIREFOX_ID in wxt.config.ts (tests/firefox.test.ts checks). */
export const FIREFOX_ID = 'getmeajobpls@getmeajobpls';

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const BROWSER_DIRS = platform() === 'darwin'
  ? [
      'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium',
      'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data',
    ].map((d) => join(home, 'Library', 'Application Support', d))
  : ['google-chrome', 'google-chrome-beta', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map((d) => join(home, '.config', d));
// Firefox reads Mozilla's per-user folder. Zen is built on Firefox; its own app folder gets a copy
// too, in case it looks there instead. Each entry: [browser's folder, where the host file goes].
const FIREFOX_DIRS = platform() === 'darwin'
  ? [
      [join(home, 'Library', 'Application Support', 'Mozilla'), join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')],
      ...['zen', 'Zen'].map((d) => [join(home, 'Library', 'Application Support', d), join(home, 'Library', 'Application Support', d, 'NativeMessagingHosts')]),
    ]
  : [
      [join(home, '.mozilla'), join(home, '.mozilla', 'native-messaging-hosts')],
      [join(home, '.zen'), join(home, '.zen', 'native-messaging-hosts')],
    ];

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const ids = args.filter((a) => /^[a-p]{32}$/.test(a));
const unknown = args.filter((a) => a !== '--uninstall' && a !== FIREFOX_ID && !ids.includes(a));
if (unknown.length) console.warn(`Not an extension ID, skipped: ${unknown.join(' ')}`);
// macOS folders ignore case ("zen" and "Zen" are one folder): keep each once.
const firefoxManifests = [...new Map(FIREFOX_DIRS.filter(([browserDir]) => existsSync(browserDir))
  .map(([, hosts]) => join(hosts, `${HOST_NAME}.json`)).map((f) => [platform() === 'darwin' ? f.toLowerCase() : f, f])).values()];
if (!uninstall && !ids.length && !firefoxManifests.length) {
  console.error('Usage: npm run tailor-install -- <extension-id>\nCopy the ID from the extension\'s Options page → Resume tailoring.');
  process.exit(1);
}

const launcher = join(DATA_DIR, 'host.sh');
const manifests = BROWSER_DIRS.filter(existsSync).map((d) => join(d, 'NativeMessagingHosts', `${HOST_NAME}.json`));

if (uninstall) {
  for (const m of [...manifests, ...firefoxManifests]) rmSync(m, { force: true });
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
// Chrome IDs are per install, so Chrome-family browsers are registered only when one is given.
for (const file of ids.length ? manifests : []) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  console.log('Registered for', dirname(dirname(file)).replace(home, '~'));
}
if (ids.length && !manifests.length) console.warn('No Chrome-family browser profile folder found.');
// Firefox-family browsers name the extension by its fixed add-on ID instead of an origin.
const { allowed_origins: _origins, ...firefoxManifest } = manifest;
for (const file of firefoxManifests) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...firefoxManifest, allowed_extensions: [FIREFOX_ID] }, null, 2));
  console.log('Registered for', dirname(dirname(file)).replace(home, '~'), '(Firefox-based)');
}

const claude = findClaude();
console.log(claude ? `Claude Code: ${claude}` : 'Claude Code was not found. Install it and run `claude` once to log in.');
console.log('Done. In the extension, Options → Resume tailoring → Test connection.');
