// Waiting for Ashby's per-field saves; the counter is kept by
// entrypoints/ashby-saves.content.ts in the page's own JavaScript.
import { sleep } from './engine/dom';

/** On <html>: how many Ashby saves are in flight. */
export const ASHBY_SAVING_ATTR = 'data-getmeajobpls-saving';

/** Ashby starts a save within ~10ms of a change; give it time to begin. */
const START_MS = 60;
/** Without the counter (script blocked), leave about one save's round trip between fields. */
const FALLBACK_MS = 400;
const TIMEOUT_MS = 6000;

/** Resolve once Ashby has no save in flight, so the next answer can't overwrite this one on its server. */
export async function waitForAshbySaves(): Promise<void> {
  await sleep(START_MS);
  const root = document.documentElement;
  if (!root.hasAttribute(ASHBY_SAVING_ATTR)) {
    await sleep(FALLBACK_MS);
    return;
  }
  const end = Date.now() + TIMEOUT_MS;
  while (root.getAttribute(ASHBY_SAVING_ATTR) !== '0' && Date.now() < end) await sleep(25);
}
