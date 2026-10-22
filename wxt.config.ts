import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Explicit imports everywhere; easier to follow than auto-imports.
  imports: false,
  manifest: {
    name: 'getmeajobpls — Autofill',
    description: 'Apply faster: one-click autofill for Workday, Greenhouse, Lever and more, plus tailored resumes. No account; data stored on-device.',
    permissions: ['storage', 'unlimitedStorage', 'webNavigation'],
    // Only requested when you turn on resume tailoring (Options → Resume tailoring),
    // to talk to the local helper that runs Claude Code.
    optional_permissions: ['nativeMessaging'],
    // Content script runs in every frame (all_frames) so embedded Greenhouse/iCIMS
    // iframes on company career sites are reachable.
    host_permissions: ['<all_urls>'],
  },
});
