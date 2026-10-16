import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Explicit imports everywhere; easier to follow than auto-imports.
  imports: false,
  manifest: {
    name: 'getmeajobpls — Autofill',
    description: 'Fill job applications on Workday, Greenhouse, Lever and more from one profile. Never submits. Your data stays in your browser.',
    permissions: ['storage', 'unlimitedStorage', 'webNavigation'],
    // Content script runs in every frame (all_frames) so embedded Greenhouse/iCIMS
    // iframes on company career sites are reachable.
    host_permissions: ['<all_urls>'],
  },
});
