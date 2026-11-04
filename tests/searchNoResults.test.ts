import { afterEach, describe, expect, it } from 'vitest';
import { fillCombobox, TIMING } from '../src/lib/engine/controls';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { fastTimings } from './helpers/fixture';

const MAJORS = ['Computer Science', 'Economics', 'Mathematics'];

/**
 * A react-select-style async search (Greenhouse's major and school boxes): typing shows
 * "Loading…" for `loadMs`, then the matches or "No options". With `flashMs`, "No options"
 * shows first, before loading starts (a debounced search).
 */
function asyncSelect({ loadMs = 50, flashMs = 0, v3 = false } = {}): HTMLInputElement {
  // react-select v3/v4 (hashed classes, no roles, no aria-controls) or v5.
  document.body.innerHTML = v3
    ? `<div class="css-2b097c-container">
        <div class="css-l772dy-control"><input id="major" aria-autocomplete="list"></div>
        <div class="css-26l3qy-menu"><div class="css-11unzgr" id="major-listbox"></div></div>
      </div>`
    : `<div class="select__container">
        <div class="select__control"><input id="major" role="combobox" aria-autocomplete="list" aria-controls="major-listbox"></div>
        <div class="select__menu"><div class="select__menu-list" role="listbox" id="major-listbox"></div></div>
      </div>`;
  resetLayoutCache();
  const input = document.querySelector<HTMLInputElement>('#major')!;
  const list = document.querySelector('#major-listbox')!;
  const notice = (text: string) => {
    const cls = v3 ? `css-1gl4k7y-${/load/i.test(text) ? 'loadingMessage' : 'NoOptionsMessage'}` : 'select__menu-notice';
    list.innerHTML = `<div class="${cls}">${text}</div>`;
  };
  let run = 0;
  let picked = '';
  Object.defineProperty(input, 'picked', { get: () => picked });
  input.addEventListener('input', () => {
    const id = ++run;
    const q = input.value.toLowerCase();
    const load = () => {
      notice('Loading...');
      setTimeout(() => {
        if (id !== run) return;
        const hits = MAJORS.filter((m) => q && m.toLowerCase().includes(q));
        if (!hits.length) return notice('No options');
        list.innerHTML = hits.map((m, i) => (v3 ? `<div class="css-yt9ioa-option" id="react-select-3-option-${i}">${m}</div>` : `<div role="option" class="select__option" id="o${i}">${m}</div>`)).join('');
        list.querySelectorAll('[id*=option-], [role=option]').forEach((o) => o.addEventListener('click', () => { picked = o.textContent!; input.insertAdjacentHTML('beforebegin', `<div class="select__single-value">${picked}</div>`); list.innerHTML = ''; }));
      }, loadMs);
    };
    if (flashMs) {
      notice('No options');
      setTimeout(() => id === run && load(), flashMs);
    } else load();
  });
  return input;
}

afterEach(fastTimings);

describe('searches that find nothing', () => {
  it('moves on to the next major soon after "No options" instead of waiting out the timeout', async () => {
    Object.assign(TIMING, { open: 300, search: 4000, noResults: 600 });
    const input = asyncSelect();
    const t0 = Date.now();
    const outcome = await fillCombobox(input, 'Statistics', { tiers: [['Statistics'], ['Computer Science']] });
    expect((input as unknown as { picked: string }).picked).toBe('Computer Science');
    expect(outcome.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2500);
  }, 10_000);

  it('still waits for a slow search that shows "Loading…"', async () => {
    Object.assign(TIMING, { open: 100, search: 4000, noResults: 300 });
    const input = asyncSelect({ loadMs: 1500 });
    await fillCombobox(input, 'Computer Science', { tiers: [['Computer Science'], ['Economics']] });
    expect((input as unknown as { picked: string }).picked).toBe('Computer Science');
  }, 10_000);

  it('does not give up on a search that flashes "No options" before loading', async () => {
    Object.assign(TIMING, { open: 100, search: 4000, noResults: 600 });
    const input = asyncSelect({ flashMs: 350, loadMs: 300 });
    await fillCombobox(input, 'Computer Science', { tiers: [['Computer Science'], ['Economics']] });
    expect((input as unknown as { picked: string }).picked).toBe('Computer Science');
  }, 10_000);

  it('reads an older react-select (no roles, hashed classes) the same way', async () => {
    Object.assign(TIMING, { open: 300, search: 4000, noResults: 600 });
    const input = asyncSelect({ v3: true });
    const t0 = Date.now();
    await fillCombobox(input, 'Statistics', { tiers: [['Statistics'], ['Computer Science']] });
    expect((input as unknown as { picked: string }).picked).toBe('Computer Science');
    expect(Date.now() - t0).toBeLessThan(2500);
  }, 10_000);
});
