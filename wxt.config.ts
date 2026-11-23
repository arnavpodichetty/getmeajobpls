import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

/**
 * The version the browser shows: package.json's (npm needs three parts, "1.5.0") with a
 * trailing ".0" dropped, so 1.5.0 shows as "1.5". 1.5.1 stays "1.5.1".
 */
export function displayVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, '$1');
}
// npm scripts (and vitest) run from the project root.
const { version } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };

/**
 * Firefox (and Zen and other Firefox-based browsers) needs a fixed add-on id: without one
 * every install gets a random id, which loses saved data on reinstall and breaks the
 * tailoring helper's registration (scripts/tailor/install.mjs uses the same id).
 */
// Never reuse an ID that was deleted on addons.mozilla.org: Mozilla rejects it for good.
// Retired: getmeajobpls@getmeajobpls (deleted 2026-11-22).
export const FIREFOX_ID = 'getmeajobpls@addon';

export default defineConfig({
  srcDir: 'src',
  // Explicit imports everywhere; easier to follow than auto-imports.
  imports: false,
  // `npm run zip:firefox` also makes a sources zip for addons.mozilla.org's reviewers. WXT
  // ignores .gitignore there, so it would pack profile/, captures/ and your resumes: list
  // exactly what rebuilding the extension needs instead (tests/firefox.test.ts checks).
  zip: {
    includeSources: ['src/**', 'public/**', 'package.json', 'package-lock.json', 'tsconfig.json', 'wxt.config.ts', 'README.md'],
  },
  // `npm run build` → .output/chrome-mv3, `npm run build:firefox` → .output/firefox-mv2.
  manifest: ({ browser }) => ({
    name: 'getmeajobpls',
    version: displayVersion(version),
    description: 'Apply faster: one-click autofill for Workday, Greenhouse, Lever and more, plus tailored resumes. No account, no tracking.',
    // identity: Google sign-in for optional Cloud sync. No install warning, and nothing
    // happens until you click "Sign in with Google" (Options → Cloud sync).
    permissions: ['storage', 'unlimitedStorage', 'webNavigation', 'identity'],
    // Only requested when you turn on resume tailoring (Options → Resume tailoring),
    // to talk to the local helper that runs Claude Code.
    optional_permissions: ['nativeMessaging'],
    // Content script runs in every frame (all_frames) so embedded Greenhouse/iCIMS
    // iframes on company career sites are reachable.
    host_permissions: ['<all_urls>'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_ID,
          // data_collection_permissions needs 142 (on Android too; addons.mozilla.org warns below that).
          strict_min_version: '142.0',
          // Nothing is sent to the developer; optional Cloud sync goes only to the user's own
          // Google Drive. See PRIVACY.md.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
