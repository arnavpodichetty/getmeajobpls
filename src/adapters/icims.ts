import { fillPage } from '../lib/engine/fill';
import type { Adapter } from './types';

// iCIMS renders its form inside an iframe (#icims_content_iframe) on the same
// host; the content script runs in that frame too (all_frames), and this
// adapter fills it. The application is behind an account sign-in, so these
// selectors come from iCIMS's standard field names — capture a page with the
// popup's "Capture this form" button if something is missed.
const SELECTORS = {
  resume: 'input[type=file][name*="resume" i], input[type=file][id*="resume" i], input[type=file]',
} as const;

export const icims: Adapter = {
  id: 'icims',
  name: 'iCIMS',
  detect(url) {
    return url.hostname.endsWith('.icims.com');
  },
  async fill(ctx) {
    return fillPage(ctx, {
      ats: this.name,
      incremental: ctx.incremental,
      resumeTarget: () => document.querySelector<HTMLElement>(SELECTORS.resume),
    });
  },
};
