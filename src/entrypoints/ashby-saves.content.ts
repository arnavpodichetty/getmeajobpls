import { defineContentScript } from 'wxt/utils/define-content-script';
import { ASHBY_SAVING_ATTR } from '../lib/ashbySaves';

// Ashby saves each answer to its server as you pick it (one ApiSetFormValue
// request per field) and checks the saved copy on submit. Saves sent at the same
// time overwrite each other there, so an answer can show on screen yet be
// "missing" on submit. This runs in the page's own JavaScript (content scripts
// can't see its requests) and counts saves in flight, so the filler can wait for
// each one before answering the next question.
export default defineContentScript({
  matches: ['https://jobs.ashbyhq.com/*'],
  allFrames: true,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    let inFlight = 0;
    const publish = () => document.documentElement?.setAttribute(ASHBY_SAVING_ATTR, String(inFlight));
    publish();
    const pageFetch = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const [input] = args;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const result = pageFetch.apply(this, args);
      if (!url.includes('ApiSetFormValue')) return result;
      inFlight++;
      publish();
      const done = () => {
        inFlight--;
        publish();
      };
      result.then(done, done);
      return result;
    } as typeof fetch;
  },
});
