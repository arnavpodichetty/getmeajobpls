// Fill routines for each kind of control. Each returns an outcome; callers
// decide how to report and highlight it.
import {
  blur,
  byId,
  closestDeep,
  fire,
  isVisible,
  parentOf,
  pressKey,
  queryAllDeep,
  queryDeep,
  reactSelectControl,
  realClick,
  setNativeValue,
  sleep,
  typeInto,
  waitForElement,
} from './dom';
import { bestAvailabilityOption } from './availability';
import { optionText, splSelectedValues, textOfIds } from './labels';
import { bestLocationOption, locationSearchTerms, type LocationPreference } from './locationPreferences';
import { bestOption, bestOptionTiered, CONFIDENT_OPTION_SCORE, DECLINE, isPlaceholderOption, MIN_OPTION_SCORE, normalize, optionScore, searchTextFor } from './text';

const pickBest = <T>(options: T[], text: (o: T) => string, value: string, tiers?: string[][], locationPreference?: LocationPreference, availabilityDate?: string) =>
  availabilityDate ? bestAvailabilityOption(options, text, availabilityDate) : locationPreference ? bestLocationOption(options, text, locationPreference) : tiers?.length ? bestOptionTiered(options, text, tiers) : bestOption(options, text, value);

export interface Outcome {
  ok: boolean;
  /** Set when the field was filled but should be checked, or could not be filled. */
  review?: string;
}

const OK: Outcome = { ok: true };
const fail = (review: string): Outcome => ({ ok: false, review });
const weak = (score: number, chosen: string): Outcome =>
  score >= CONFIDENT_OPTION_SCORE ? OK : { ok: true, review: `Closest option was "${chosen}" — please check.` };

// ---------------------------------------------------------------------------
// Dates

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Format "YYYY-MM" / "YYYY-MM-DD" for a field, guided by its type and placeholder. */
export function formatDate(iso: string, el: Element, label = ''): string {
  const [y, m = '01', d = '01'] = iso.split('-');
  if (!y) return iso;
  const type = (el as HTMLInputElement).type;
  if (type === 'date') return `${y}-${m}-${d}`;
  if (type === 'month') return `${y}-${m}`;
  // A format spelled out in the placeholder or question ("MM/YYYY") beats everything else.
  // Greenhouse puts it in the help text under the box, linked by aria-describedby.
  const hint = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${label} ${textOfIds(el, 'aria-describedby')}`.toLowerCase();
  if (/dd.?mm.?yyyy/.test(hint)) return `${d}/${m}/${y}`;
  if (/mm.?dd.?yyyy/.test(hint)) return `${m}/${d}/${y}`;
  if (/mm.?yyyy/.test(hint)) return `${m}/${y}`;
  if (/yyyy.?mm/.test(hint)) return `${y}-${m}`;
  if (/^\s*yyyy\s*$/.test(hint)) return y;
  // Otherwise a question asking for "(Month/Year)" or "month and year" wants words: "May 2028".
  if (/\bmonth\s*(?:\/|and|,|&|-)?\s*year\b/i.test(label) && !/\bday\b/i.test(label)) return `${monthName(iso)} ${y}`;
  return iso.length > 7 ? `${m}/${d}/${y}` : `${m}/${y}`;
}

export const monthName = (iso: string): string => MONTHS[Number(iso.split('-')[1]) - 1] ?? '';

// ---------------------------------------------------------------------------
// Text

export function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string): Outcome {
  let text = value;
  let review: string | undefined;
  const max = el.maxLength;
  if (max > 0 && text.length > max) {
    text = text.slice(0, max);
    review = `Answer was cut to the field's ${max}-character limit.`;
  }
  if (el instanceof HTMLInputElement && el.type === 'number') {
    const n = text.replace(/[^\d.]/g, '');
    if (!n) return fail('Field expects a number.');
    text = n;
  }
  typeInto(el, text);
  blur(el);
  if (el.value !== text && !sameDigits(el.value, text)) return fail('The site did not accept the value.');
  return { ok: true, review };
}

/** Phone inputs reformat as you type: "(415) 555-0100" may become "+1 415-555-0100". */
function sameDigits(shown: string, typed: string): boolean {
  const a = shown.replace(/\D/g, '');
  const b = typed.replace(/\D/g, '');
  return b.length >= 7 && (a.endsWith(b) || b.endsWith(a)) && a.length >= 7;
}

export function fillRichText(el: HTMLElement, value: string): Outcome {
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, value);
  if (!inserted) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
  }
  blur(el);
  return OK;
}

// ---------------------------------------------------------------------------
// Native select

export function fillSelect(el: HTMLSelectElement, value: string | string[], tiers?: string[][], locationPreference?: LocationPreference, availabilityDate?: string): Outcome {
  const options = [...el.options].filter((o) => !o.disabled && o.value !== '' && !isPlaceholderOption(o.text));
  const wanted = Array.isArray(value) ? value : [value];
  if (el.multiple) {
    if (locationPreference) {
      const pick = bestLocationOption(options, (option) => option.text, locationPreference);
      if (!pick) return fail('No location is available for this preference rank.');
      options.forEach((option) => { option.selected = option === pick.option; });
      fire(el, 'input');
      fire(el, 'change');
      return weak(pick.score, pick.option.text);
    }
    let any = false;
    for (const w of wanted) {
      const pick = pickBest(options, (o) => o.text || o.value, w, tiers);
      if (pick && pick.score >= MIN_OPTION_SCORE) {
        pick.option.selected = true;
        any = true;
      }
    }
    if (!any) return fail('No matching options.');
    fire(el, 'input');
    fire(el, 'change');
    return OK;
  }
  const pick = pickBest(options, (o) => o.text || o.value, wanted[0], tiers, locationPreference, availabilityDate);
  if (!pick || pick.score < MIN_OPTION_SCORE) return fail(noOptionReason(wanted[0]));
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter ? setter.call(el, pick.option.value) : (el.value = pick.option.value);
  pick.option.selected = true;
  fire(el, 'input');
  fire(el, 'change');
  blur(el);
  return weak(pick.score, pick.option.text);
}

function noOptionReason(wanted: string): string {
  return wanted === DECLINE ? 'No "decline to answer" option — choose one yourself.' : `No option matched "${wanted}".`;
}

// ---------------------------------------------------------------------------
// Radio / checkbox / toggle buttons

function check(input: HTMLInputElement): void {
  if (input.checked) return;
  const label = input.closest('label') ?? (input.id ? (input.getRootNode() as Document).querySelector?.(`label[for="${CSS.escape(input.id)}"]`) : null);
  // Clicking the visible label is what a person does; it also works when the input is visually hidden.
  if (!isVisible(input) && label) realClick(label);
  else realClick(input);
  if (!input.checked) {
    input.checked = true;
    fire(input, 'input');
    fire(input, 'change');
  }
}

export function fillRadio(members: HTMLElement[], value: string, tiers?: string[][], locationPreference?: LocationPreference, availabilityDate?: string): Outcome {
  const pick = pickBest(members as HTMLInputElement[], optionText, value, tiers, locationPreference, availabilityDate);
  if (!pick || pick.score < MIN_OPTION_SCORE) return fail(noOptionReason(value));
  check(pick.option);
  return weak(pick.score, optionText(pick.option));
}

export function fillCheckboxes(members: HTMLElement[], value: string | string[], tiers?: string[][], locationPreference?: LocationPreference, availabilityDate?: string): Outcome {
  const wanted = Array.isArray(value) ? value : [value];
  const boxes = members as HTMLInputElement[];
  if ((tiers?.length || locationPreference || availabilityDate) && !Array.isArray(value)) {
    const pick = pickBest(boxes, optionText, value, tiers, locationPreference, availabilityDate);
    if (!pick || pick.score < MIN_OPTION_SCORE) return fail(noOptionReason(value));
    // A scalar answer with fallback tiers chooses one response, even when
    // the site renders Yes / No / N/A as checkboxes.
    for (const box of boxes) if (box !== pick.option && box.checked) fillCheckbox(box, 'No');
    check(pick.option);
    return weak(pick.score, optionText(pick.option));
  }
  let lowest = 1;
  let chosen = 0;
  for (const w of wanted) {
    const pick = bestOption(boxes, optionText, w);
    if (!pick || pick.score < MIN_OPTION_SCORE) continue;
    check(pick.option);
    lowest = Math.min(lowest, pick.score);
    chosen++;
  }
  if (!chosen) return fail(noOptionReason(wanted[0]));
  return lowest >= CONFIDENT_OPTION_SCORE ? OK : { ok: true, review: 'Some boxes were a loose match — please check.' };
}

/** Single checkbox: tick for a yes-ish answer, untick for no. */
export function fillCheckbox(el: HTMLInputElement, value: string): Outcome {
  const yes = /^(yes|true|checked|i agree|agree)$/i.test(value.trim());
  const no = /^(no|false|unchecked)$/i.test(value.trim());
  if (!yes && !no) return fail('Unclear whether to tick this box.');
  if (yes) check(el);
  else if (el.checked) realClick(el);
  return OK;
}

export function fillButtons(members: HTMLElement[], value: string, tiers?: string[][], locationPreference?: LocationPreference, availabilityDate?: string): Outcome {
  const pick = pickBest(members, optionText, value, tiers, locationPreference, availabilityDate);
  if (!pick || pick.score < MIN_OPTION_SCORE) return fail(noOptionReason(value));
  const option = pick.option;
  const chosen = () => option.getAttribute('aria-pressed') === 'true' || option.getAttribute('aria-checked') === 'true';
  if (!chosen()) {
    realClick(option);
    // Web-component radios (SmartRecruiters spl-radio) may only react to their inner control or the keyboard.
    if (option.shadowRoot && option.hasAttribute('aria-checked') && !chosen()) {
      for (const inner of option.shadowRoot.querySelectorAll<HTMLElement>('input, .c-spl-radio, [class*="radio" i], label')) {
        realClick(inner);
        if (chosen()) break;
      }
      if (!chosen()) pressKey(option, ' ');
      if (!chosen()) return fail(`Clicked "${optionText(option)}" but the site did not select it.`);
    }
  }
  return weak(pick.score, optionText(option));
}

// ---------------------------------------------------------------------------
// Custom dropdowns (react-select, MUI, Workday, Ashby, Rippling…)

/** Waits for dropdown options, in ms. Tests shorten these (fixtures have no live JS). */
export const TIMING = { open: 1200, search: 4000, multi: 5000 };

// Grid popups (Oracle Recruiting's cx-select, aria-haspopup="grid") list each choice as a selectable gridcell.
const OPTION_SELECTOR =
  '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], .select__option, li[class*="option" i], spl-select-option, [role="gridcell"][aria-selected]';
const NON_OPTIONS = /^(no (results|options|matches)|loading|searching|type to search|start typing|no items)/i;

function listboxFor(el: Element): Element | null {
  for (const attr of ['aria-controls', 'aria-owns']) {
    const id = el.getAttribute(attr);
    const box = id ? byId(el, id) : null;
    if (box) return box;
  }
  return null;
}

function allVisibleOptions(scope: ParentNode): HTMLElement[] {
  return queryAllDeep<HTMLElement>(OPTION_SELECTOR, scope).filter((o) => {
    const text = optionText(o);
    return text && !NON_OPTIONS.test(text) && o.getAttribute('aria-disabled') !== 'true' && isVisible(o);
  });
}

/** Options already on screen before a dropdown opens belong to something else (e.g. a phone country list). */
let staleOptions = new Set<HTMLElement>();

function visibleOptions(el: Element): HTMLElement[] {
  const spl = closestDeep(el, 'spl-autocomplete, spl-multiselect-autocomplete');
  if (spl) return allVisibleOptions(spl);
  const box = listboxFor(el);
  const inBox = box ? allVisibleOptions(box) : [];
  // Web-component menus (SmartRecruiters) slot their options outside the menu element.
  return inBox.length ? inBox : allVisibleOptions(document).filter((o) => !staleOptions.has(o));
}

async function waitForOptions(el: Element, timeout: number, previous: HTMLElement[] = [], previousText = previous.map(optionText).join('\n')): Promise<HTMLElement[]> {
  const before = new Set(previous);
  const result = await waitForElement(() => {
    const opts = visibleOptions(el);
    // When re-searching, wait until the list actually changes.
    return opts.length && (opts.some((o) => !before.has(o)) || !previous.length || opts.map(optionText).join('\n') !== previousText) ? opts[0] : null;
  }, timeout);
  return result ? visibleOptions(el) : [];
}

function searchInput(el: HTMLElement): HTMLInputElement | null {
  if (el instanceof HTMLInputElement) return el;
  const inner = el.querySelector<HTMLInputElement>('input:not([type=hidden])');
  if (inner) return inner;
  // Workday/MUI open a separate search box inside the popup.
  const box = listboxFor(el);
  return (box ? box.querySelector<HTMLInputElement>('input') : null) ?? null;
}

function open(el: HTMLElement): void {
  el.focus();
  realClick(el);
  // react-select opens on mousedown of its control container.
  const control = el.closest('[class*="control" i]');
  if (control && control !== el) control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  pressKey(el, 'ArrowDown');
}

function close(el: HTMLElement, typed: HTMLInputElement | null): void {
  pressKey(typed ?? el, 'Escape');
  if (typed && typed.value) {
    setNativeValue(typed, '');
    fire(typed, 'input');
  }
  blur(el);
}

/** Words to type into an async search box (cities, schools): the most distinctive part first. */
function queries(tierValue: string): string[] {
  const value = searchTextFor(tierValue);
  const out = [value];
  const first = value.split(/[,(]/)[0].trim();
  if (first && first !== value) out.push(first);
  return out;
}

export async function fillCombobox(
  el: HTMLElement,
  value: string,
  opts: { searchTimeout?: number; tiers?: string[][]; locationPreference?: LocationPreference; availabilityDate?: string } = {},
): Promise<Outcome> {
  const pickFrom = (options: HTMLElement[], tier: string[]) => {
    const pick = opts.availabilityDate ? bestAvailabilityOption(options, optionText, opts.availabilityDate) : opts.locationPreference
      ? bestLocationOption(options, optionText, { ...opts.locationPreference, places: tier }, false)
      : pickBest(options, optionText, tier[0], [tier]);
    return pick && pick.score >= MIN_OPTION_SCORE ? pick : null;
  };
  const tiers = opts.locationPreference ? opts.locationPreference.places.map((place) => [place]) : opts.tiers?.length ? opts.tiers : [[value]];

  staleOptions = new Set(allVisibleOptions(document));
  open(el);
  let options = await waitForOptions(el, TIMING.open);
  let pick: ReturnType<typeof pickFrom> = null;
  const input = searchInput(el);

  // Finish searching an earlier preference before considering the next one.
  // Searching a major must not accept a generic "Science" result, nor a
  // fallback that happened to be visible before the search completed.
  for (const tier of tiers) {
    pick = pickFrom(options, tier);
    if (pick) break;
    if (input && value !== DECLINE) {
      for (const query of [...new Set(tier.flatMap(opts.locationPreference ? locationSearchTerms : queries))]) {
        const previousText = options.map(optionText).join('\n');
        typeInto(input, query);
        options = await waitForOptions(el, opts.searchTimeout ?? TIMING.search, options, previousText);
        pick = pickFrom(options, tier);
        if (pick) break;
      }
    }
    if (pick) break;
  }

  if (!pick && opts.locationPreference) {
    // No preferred match: restore the full list and rank the available offices.
    if (input) {
      const previousText = options.map(optionText).join('\n');
      typeInto(input, '');
      const restored = await waitForOptions(el, opts.searchTimeout ?? TIMING.search, options, previousText);
      options = restored.length ? restored : visibleOptions(el);
    }
    pick = bestLocationOption(options, optionText, opts.locationPreference);
  }

  if (!pick) {
    const seen = options.slice(0, 4).map((o) => `"${o.textContent?.trim()}"`).join(', ');
    close(el, input);
    return fail(options.length ? `${noOptionReason(value)} Options included ${seen}.` : 'The dropdown showed no options.');
  }
  const chosenText = optionText(pick.option);
  realClick(clickTarget(pick.option));
  await sleep(120);
  blur(el);
  if (closestDeep(el, 'spl-autocomplete, spl-multiselect-autocomplete') && el instanceof HTMLInputElement
    && optionScore(el.value, chosenText) < CONFIDENT_OPTION_SCORE
    && !splSelectedValues(el).some((value) => optionScore(value, chosenText) >= CONFIDENT_OPTION_SCORE)) {
    close(el, input);
    return fail('The dropdown did not accept the selected option.');
  }
  // Oracle's cx-select writes the chosen option (or its short name, like a
  // city without its county) into its own input; anything else means the click was ignored.
  const shown = el instanceof HTMLInputElement ? normalize(el.value) : '';
  if (el instanceof HTMLInputElement && el.getAttribute('aria-haspopup') === 'grid'
    && !(shown && normalize(chosenText).includes(shown)) && optionScore(el.value, chosenText) < CONFIDENT_OPTION_SCORE) {
    close(el, null);
    return fail('The dropdown did not accept the selected option.');
  }
  if (el.matches('button[aria-haspopup="listbox"]') && isPlaceholderOption(el.textContent ?? '')) {
    close(el, input);
    return fail('The dropdown did not accept the selected option.');
  }
  const reactControl = el instanceof HTMLInputElement && el.getAttribute('aria-autocomplete') === 'list'
    ? reactSelectControl(el) : null;
  const selected = reactControl?.querySelectorAll('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="multiValue" i], [data-automation-id="selectedItem"]');
  // Some selects show a short form of the pick: Greenhouse's phone country shows "+1" for "United States +1".
  const showsPick = (shownText: string) => {
    const item = normalize(shownText);
    const chosen = normalize(chosenText);
    return optionScore(shownText, chosenText) >= CONFIDENT_OPTION_SCORE || (!!item && (chosen.endsWith(` ${item}`) || chosen.startsWith(`${item} `)));
  };
  if (reactControl && ![...(selected ?? [])].some((item) => showsPick(item.textContent ?? ''))) {
    close(el, input);
    return fail('The dropdown did not accept the selected option.');
  }
  return weak(pick.score, chosenText);
}

/** The part of an option that takes the click (Workday puts it on an inner promptOption / radio). */
function clickTarget(option: HTMLElement): HTMLElement {
  if (option.matches('spl-select-option')) return queryDeep<HTMLElement>('[role="option"]', option) ?? option;
  return option.querySelector<HTMLElement>('[data-automation-id="promptOption"]') ?? option;
}

/** Has a pick registered? Workday shows selected items as pills; other widgets flip aria-selected/checked. */
function looksSelected(el: HTMLElement, option: HTMLElement, value: string): boolean {
  const container = el.closest('[data-automation-id^="formField"], [data-automation-id="multiSelectContainer"]') ?? el.parentElement;
  const pills = container?.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] li, [class*="chip" i], [class*="tag" i], [class*="pill" i]') ?? [];
  const wanted = value.toLowerCase();
  if ([...pills].some((p) => (p.textContent ?? '').toLowerCase().includes(wanted))) return true;
  if (option.isConnected && (option.getAttribute('aria-selected') === 'true' || option.getAttribute('aria-checked') === 'true')) return true;
  const radio = option.querySelector<HTMLInputElement>('input[type=radio], input[type=checkbox]');
  return !!radio?.checked || radio?.getAttribute('aria-checked') === 'true';
}

/** Multi-select typeahead (skills): type each value, pick it from the results, skip the rest. */
export async function fillMultiCombobox(
  el: HTMLElement,
  values: string[],
  opts: { enterToSearch?: boolean } = {},
): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  const input = searchInput(el);
  if (!input) return { added, skipped: values };
  for (const value of values) {
    staleOptions = new Set(allVisibleOptions(document));
    open(el);
    typeInto(input, value);
    // Workday prompts only search when Enter is pressed.
    if (opts.enterToSearch) pressKey(input, 'Enter');
    const options = await waitForOptions(el, TIMING.multi);
    const pick = bestOption(options, (o) => o.textContent ?? '', value);
    if (pick && pick.score >= 0.8) {
      const optionText = pick.option.textContent?.trim() ?? value;
      realClick(clickTarget(pick.option));
      await sleep(250);
      if (!looksSelected(el, pick.option, optionText)) {
        // Some prompts only register a click on the option's own radio/checkbox, or on Enter.
        const radio = pick.option.querySelector<HTMLElement>('input[type=radio], input[type=checkbox]');
        if (radio) realClick(radio);
        else pressKey(input, 'Enter');
        await sleep(250);
      }
      added.push(value);
    } else {
      skipped.push(value);
    }
    setNativeValue(input, '');
    fire(input, 'input');
    await sleep(150);
  }
  pressKey(input, 'Escape');
  blur(el);
  return { added, skipped };
}

// ---------------------------------------------------------------------------
// Files

export function attachFile(target: HTMLInputElement | HTMLElement, file: File, what = 'resume'): Outcome {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  if (target instanceof HTMLInputElement) {
    const accept = target.accept.toLowerCase();
    if (accept && !/pdf|application\/\*|\*\/\*/.test(accept)) return fail(`This upload accepts ${accept}, not PDF.`);
    try {
      target.files = transfer.files;
    } catch {
      return fail('The site blocked automatic file attachment.');
    }
    fire(target, 'input');
    fire(target, 'change');
    // Some upload widgets read the file and then clear the input; that's still a success.
    return target.files?.length ? OK : { ok: true, review: `Check that the ${what} shows as attached.` };
  }
  // Drop zones without a usable <input type=file>.
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
  }
  return { ok: true, review: `${what[0].toUpperCase()}${what.slice(1)} was dropped onto the upload area — check it attached.` };
}

/** Nearest container worth outlining for a field (group wrapper or the control). */
export function highlightTarget(el: HTMLElement, isGroup: boolean): HTMLElement {
  if (isGroup) {
    const group = el.closest('fieldset, [role="radiogroup"], [role="group"]') as HTMLElement | null;
    if (group) return group;
    return (parentOf(parentOf(el) ?? el) as HTMLElement) ?? el;
  }
  // react-select and friends render a tiny <input> inside a styled box; outline the box.
  let cur: HTMLElement = el;
  for (let i = 0; i < 3 && !isVisible(cur); i++) cur = (parentOf(cur) as HTMLElement) ?? cur;
  const box = el.getAttribute('role') === 'combobox' ? (el.closest('[class*="control" i]') as HTMLElement | null) : null;
  return box ?? cur;
}
