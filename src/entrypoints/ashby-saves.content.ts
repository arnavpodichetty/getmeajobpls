import { defineContentScript } from 'wxt/utils/define-content-script';
import { countAshbySaves } from '../lib/ashbySaves';

// Ashby saves each answer to its server as you pick it (one ApiSetFormValue
// request per field) and checks the saved copy on submit. Saves sent at the same
// time overwrite each other there, so an answer can show on screen yet be
// "missing" on submit. This runs in the page's own JavaScript (content scripts
// can't see its requests; Chrome and Firefox 128+ both honor world: MAIN) and
// counts saves in flight, so the filler can wait for each one before answering
// the next question.
export default defineContentScript({
  matches: ['https://jobs.ashbyhq.com/*'],
  allFrames: true,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    countAshbySaves(window);
  },
});
