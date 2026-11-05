// Fill routines for each kind of control. Each returns an outcome; callers
// decide how to report and highlight it.
import {
  blur,
  byId,
  closestDeep,
  renderedText,
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

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A month written out or abbreviated: "June", "Jun", "Sept." (not "Junior" or "Decline"). */
const MONTH_WORD = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?$/i;

export function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string, opts: { blur?: boolean } = {}): Outcome {
  let text = value;
  let review: string | undefined;
  // A number box asking for a month takes 6, not "June".
  if (el instanceof HTMLInputElement && el.type === 'number' && MONTH_WORD.test(value.trim())) {
    text = String(MONTH_NAMES.indexOf(value.trim().slice(0, 3).toLowerCase()) + 1);
  }
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
  if (opts.blur !== false) blur(el);
  if (el.value !== text && !sameDigits(el.value, text)) return fail('The site did not accept the value.');
  return { ok: true, review };
}

/** A read-only date box that opens a calendar (Eightfold, Ant Design pickers); typing into it does nothing. */
export function isCalendarInput(el: Element): boolean {
  if (!(el instanceof HTMLInputElement) || el.getAttribute('aria-haspopup') !== 'dialog') return false;
  return /\bdate\b/i.test(`${el.placeholder} ${el.getAttribute('aria-label') ?? ''}`);
}

/**
 * Open the calendar and click the day. Its cells carry the date as
 * title="YYYY-MM-DD"; other months are reached with the header's next/previous buttons.
 */
export async function fillCalendarDate(el: HTMLInputElement, iso: string): Promise<Outcome> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return fail('This calendar needs a full date; your profile has only month and year.');
  el.focus();
  realClick(el);
  const scope = (): ParentNode => listboxFor(el) ?? document;
  const cells = () => queryAllDeep<HTMLElement>('td[title], [role="gridcell"][title]', scope()).filter(isVisible);
  const cellFor = () => cells().find((c) => c.getAttribute('title') === iso) ?? null;
  let cell = await waitForElement(cellFor, 1500);
  for (let step = 0; !cell && step < 36; step++) {
    // The calendar shows whole weeks; the middle cell is in the month on display.
    const shown = cells().map((c) => c.getAttribute('title') ?? '').filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    if (!shown.length) break;
    const month = shown[Math.floor(shown.length / 2)].slice(0, 7);
    const forward = iso.slice(0, 7) > month;
    const button = queryAllDeep<HTMLElement>(
      forward ? '[class*="header-next-btn" i], [aria-label^="Next month" i]' : '[class*="header-prev-btn" i], [aria-label^="Previous month" i]',
      scope(),
    ).find(isVisible);
    if (!button) break;
    realClick(button);
    cell = await waitForElement(cellFor, 400);
  }
  if (!cell) {
    pressKey(el, 'Escape');
    return fail("Couldn't find that day in the calendar.");
  }
  realClick(cell.querySelector<HTMLElement>('[role="button"]') ?? cell);
  await sleep(200);
  if (el.getAttribute('aria-expanded') === 'true') pressKey(el, 'Escape');
  blur(el);
  return el.value.trim() ? OK : fail('The calendar did not take the date.');
}

/**
 * Type the value, then let the page take it before leaving the box. Forms that validate on
 * blur (Eightfold) otherwise check the old, empty value and keep "cannot be left blank" up.
 */
export async function typeText(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<Outcome> {
  const outcome = fillText(el, value, { blur: false });
  await sleep(50);
  blur(el);
  return outcome;
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
    // Styled options (pronoun pickers) listen on an inner "clickable" part, not the row.
    realClick(option.querySelector<HTMLElement>('[class*="clickable" i]') ?? option);
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
export const TIMING = { open: 1200, search: 4000, multi: 5000, noResults: 600 };

// Grid popups (Oracle Recruiting's cx-select, aria-haspopup="grid") list each choice as a selectable gridcell.
const OPTION_SELECTOR =
  '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], .select__option, li[class*="option" i], spl-select-option, [role="gridcell"][aria-selected], ' +
  // Older react-select (v3/v4) options have no role, only an id like "react-select-3-option-0".
  '[id^="react-select-"][id*="-option-"], ' +
  // Sites' own div dropdowns: <li data-dropdown-selection="Statistics">.
  '[data-dropdown-selection]';
const NON_OPTIONS = /^(no (results|options|matches)|loading|searching|type to search|start typing|no items)/i;

function listboxFor(el: Element): Element | null {
  for (const attr of ['aria-controls', 'aria-owns']) {
    const id = el.getAttribute(attr);
    const box = id ? byId(el, id) : null;
    if (box) return box;
  }
  // iCIMS: <a id="X_icimsDropdown"> opens <div id="X_icimsDropdown_ctnr">.
  return el.id ? byId(el, `${el.id}_ctnr`) : null;
}

function allVisibleOptions(scope: ParentNode): HTMLElement[] {
  return queryAllDeep<HTMLElement>(OPTION_SELECTOR, scope).filter((o) => {
    const text = optionText(o);
    // A div dropdown's rows are all real choices, even ones folded under a closed category.
    return text && !NON_OPTIONS.test(text) && o.getAttribute('aria-disabled') !== 'true' && (isVisible(o) || o.hasAttribute('data-dropdown-selection'));
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
  if (inBox.length) return inBox;
  const owners = new Map<Element, Element | null>();
  return allVisibleOptions(document).filter((o) => !staleOptions.has(o) && !ownedByOther(o, el, owners));
}

/**
 * The option sits in a list another control opens (aria-controls / aria-owns). A list
 * that's still closing after the last dropdown (Eightfold re-renders it as it fades)
 * isn't this dropdown's, even though its rows are new on the page.
 */
function ownedByOther(option: Element, el: Element, owners: Map<Element, Element | null>): boolean {
  for (let list = option.closest('[id]'); list; list = list.parentElement?.closest('[id]') ?? null) {
    if (!owners.has(list)) {
      const id = CSS.escape(list.id);
      owners.set(list, list.ownerDocument.querySelector(`[aria-controls~="${id}"], [aria-owns~="${id}"]`));
    }
    const owner = owners.get(list);
    if (owner) return owner !== el && !owner.contains(el) && !el.contains(owner);
  }
  return false;
}

const NO_RESULTS = /^(?:no (?:results|options|matches|items)|nothing found)\b/i;
const STILL_SEARCHING = /^(?:loading|searching)\b/i;
const NOTICES = '[class*="menu-notice" i], [class*="no-options" i], [class*="noOptions" i], [class*="no-results" i], [class*="noResults" i], [class*="loadingMessage" i], ' + OPTION_SELECTOR;

/**
 * The dropdown's own "No options" / "Loading…" message. react-select (Greenhouse) puts it
 * in the menu beside the control; other widgets show it as a disabled option.
 */
function searchNotice(el: Element): 'none' | 'loading' | null {
  // The menu around the listbox, unless it sits straight on the page (then just the listbox).
  const box = listboxFor(el);
  const menu = box?.parentElement && box.parentElement !== document.body && box.parentElement !== document.documentElement ? box.parentElement : box;
  const scopes = [menu, reactSelectControl(el)?.parentElement].filter((x): x is Element => !!x);
  let none = false;
  for (const scope of new Set(scopes)) {
    for (const n of queryAllDeep<HTMLElement>(NOTICES, scope as HTMLElement)) {
      if (!isVisible(n)) continue;
      const text = (n.textContent ?? '').trim();
      if (STILL_SEARCHING.test(text)) return 'loading';
      if (NO_RESULTS.test(text)) none = true;
    }
  }
  return none ? 'none' : null;
}

async function waitForOptions(el: Element, timeout: number, previous: HTMLElement[] = [], previousText = previous.map(optionText).join('\n')): Promise<HTMLElement[]> {
  const before = new Set(previous);
  // A search that settles on "No options" is finished: don't wait out the whole timeout
  // before trying the next major or school name. It has to stay that way (no "Loading…")
  // for a moment, since some lists flash "No options" before their results arrive.
  let noneSince: number | null = null;
  let settledEmpty = false;
  const result = await waitForElement(() => {
    const opts = visibleOptions(el);
    if (!opts.length) {
      const notice = searchNotice(el);
      if (notice === 'none') {
        noneSince ??= Date.now();
        if (Date.now() - noneSince >= TIMING.noResults) {
          settledEmpty = true;
          return el as HTMLElement;
        }
      } else noneSince = null;
    } else noneSince = null;
    // When re-searching, wait until the list actually changes.
    return opts.length && (opts.some((o) => !before.has(o)) || !previous.length || opts.map(optionText).join('\n') !== previousText) ? opts[0] : null;
  }, timeout);
  return result && !settledEmpty ? visibleOptions(el) : [];
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
  // The page can re-render as the previous field is left (Eightfold) and swallow the
  // first open. A closed dropdown gets one more try.
  if (!options.length && el.isConnected && el.getAttribute('aria-expanded') !== 'true') {
    open(el);
    options = await waitForOptions(el, TIMING.open);
  }
  // What the list offered before any search, for the review note when nothing fits.
  const offered = options;
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
    const shown = options.length ? options : offered;
    const seen = shown.slice(0, 4).map((o) => `"${o.textContent?.trim()}"`).join(', ');
    close(el, input);
    return fail(shown.length ? `${noOptionReason(value)} Options included ${seen}.` : 'The dropdown showed no options.');
  }
  const chosenText = optionText(pick.option);
  // A row folded under a category ("Social media › LinkedIn") needs its category opened first.
  if (!isVisible(pick.option)) {
    const header = pick.option.closest('[class*="category" i]')?.querySelector<HTMLElement>('[class*="category-name" i], [class*="category-header" i]');
    if (header) {
      realClick(header);
      await sleep(80);
    }
  }
  realClick(clickTarget(pick.option));
  await sleep(120);
  blur(el);
  // Div dropdowns keep the pick in a hidden input; empty means the click was ignored.
  const stored = pick.option.hasAttribute('data-dropdown-selection') ? el.querySelector<HTMLInputElement>('input[type=hidden]') : null;
  if (stored && !stored.value) {
    close(el, input);
    return fail('The dropdown did not accept the selected option.');
  }
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
  // Some selects show a short form of the pick: Greenhouse's and SmartRecruiters' phone country show "+1" for "United States +1".
  const showsPick = (shownText: string) => {
    const item = normalize(shownText);
    const chosen = normalize(chosenText);
    return optionScore(shownText, chosenText) >= CONFIDENT_OPTION_SCORE || (!!item && (chosen.endsWith(` ${item}`) || chosen.startsWith(`${item} `)));
  };
  if (el.matches('button[aria-haspopup="listbox"]')) {
    const shownValue = renderedText(el);
    if (isPlaceholderOption(shownValue) || (closestDeep(el, 'spl-select') && !showsPick(shownValue))) {
      close(el, input);
      return fail('The dropdown did not accept the selected option.');
    }
  }
  const reactControl = el instanceof HTMLInputElement && el.getAttribute('aria-autocomplete') === 'list'
    ? reactSelectControl(el) : null;
  const selected = reactControl?.querySelectorAll('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="multiValue" i], [data-automation-id="selectedItem"]');
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
  if (splSelectedValues(el).some((selected) => normalize(selected) === normalize(value))) return true;
  const container = reactSelectControl(el) ?? el.closest('[data-automation-id^="formField"], [data-automation-id="multiSelectContainer"]') ?? el.parentElement;
  const pills = container?.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] li, [class*="chip" i], [class*="tag" i], [class*="pill" i], [class*="multi-value" i], [class*="multiValue" i]') ?? [];
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
      if (looksSelected(el, pick.option, optionText)) added.push(value);
      else skipped.push(value);
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
