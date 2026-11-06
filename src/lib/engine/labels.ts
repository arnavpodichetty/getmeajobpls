// Works out the question a form control is asking. Takes the first useful
// source in priority order, so option text, placeholders like "Select…", and
// neighbouring questions never get mixed into a field's label.
import { byId, closestDeep, ownText, parentOf, queryAllDeep } from './dom';
import { cleanLabel, normalize } from './text';

export interface FieldLabel {
  /** Human question text, e.g. "Are you legally authorized to work in the US?" */
  label: string;
  /** Attribute soup (name, id, automation ids, placeholder…) for fallback matching. */
  hints: string;
  /** The label carried a required marker (*, ✱, "required"). */
  marked: boolean;
}

const REQUIRED_MARK = /[*✱]|\(required\)/i;
/** A class like "required" or Ashby's hashed "_required_f7cvd_91". */
const isRequiredClass = (cls: string) => /(?:^|[\s_-])required(?:$|[\s_-])/i.test(cls) && !/not[\s_-]?required/i.test(cls);

function pick(candidates: (() => string)[]): { label: string; marked: boolean } {
  for (const get of candidates) {
    const raw = get();
    const text = cleanLabel(raw);
    if (text && !isGenericLabel(text)) return { label: text, marked: REQUIRED_MARK.test(raw) };
  }
  return { label: '', marked: false };
}

/** Labels that describe the widget, not the question. */
const GENERIC = new Set(
  [
    'search', 'select', 'select an option', 'select one', 'please select', 'choose', 'choose one', 'textbox', 'type here',
    'start typing', 'choose file', 'attach', 'upload', 'enter manually', 'toggle flyout', 'select country', 'select date',
    'type to search', 'none', 'answer', 'your answer', 'response', 'input', 'text', 'mm dd yyyy', 'mm yyyy', 'dd mm yyyy',
  ].map(normalize),
);

export function isGenericLabel(text: string): boolean {
  const n = normalize(text);
  return !n || n.length < 2 || GENERIC.has(n) || /^(?:select|choose)\b.{0,12}$/.test(n);
}

/** Text of the elements an aria-labelledby/-describedby attribute points to. */
export function textOfIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? [];
  return ids.map((id) => ownText(byId(el, id))).join(' ').trim();
}

function labelElementFor(el: Element): HTMLLabelElement | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  try {
    const byId = el.id ? root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (byId) return byId;
    // RippleMatch points some labels at the field's name ("homeState") and gives the field a random id.
    const name = el.getAttribute('name');
    if (!name || root.querySelector(`[id="${CSS.escape(name)}"]`)) return null;
    const label = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(name)}"]`);
    // Only when the label sits with this field, not somewhere else on the page.
    return label && label.closest('div, fieldset, li')?.parentElement?.contains(el) ? label : null;
  } catch {
    return null;
  }
}

/** Container classes ATSs use around one question (Lever, Greenhouse, Workday, MUI…). */
const QUESTION_CONTAINER =
  '.application-question, .application-field, [data-automation-id^="formField"], [class*="formField" i], [class*="form-field" i], [class*="FormControl" i], [class*="question" i], .field, .form-group, fieldset, [role="group"], [role="radiogroup"], li';

// Hidden companion inputs (react-select's "requiredInput", Ashby's yes/no checkbox) are not separate questions.
const CONTROL_SELECTOR =
  'input:not([type=hidden]):not([aria-hidden="true"]):not([tabindex="-1"]), select, textarea, [role="combobox"], [contenteditable="true"], [data-dropdown-id] > [role="button"]';

/** A div dropdown's search and "Please specify" boxes belong to the dropdown; it counts once. */
const isWidgetInternal = (c: Element) => !c.matches('[role="button"]') && !!c.closest('[data-dropdown-id]');
const isDataDropdownBox = (el: Element) => el.matches('[data-dropdown-id] > [role="button"]');
const controlsIn = (container: Element) => [...container.querySelectorAll(CONTROL_SELECTOR)].filter((c) => !isWidgetInternal(c));

/** Distinct fields inside a container (radio/checkbox groups collapse by name). */
function fieldCount(container: Element): number {
  const keys = new Set<string>();
  controlsIn(container).forEach((c, i) => {
    const type = c.getAttribute('type');
    const name = c.getAttribute('name');
    keys.add((type === 'radio' || type === 'checkbox') && name ? `${type}:${name}` : `#${i}`);
  });
  return keys.size;
}

/** Container text without the option labels of radio/checkbox groups. */
function questionText(container: Element): string {
  const clone = container.cloneNode(true) as Element;
  // Styled options (Rippling's div role="radio" rows) are answers, not the question.
  clone.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]').forEach((option) => option.remove());
  clone.querySelectorAll('label').forEach((label) => {
    if (label.querySelector('input[type=radio], input[type=checkbox]')) label.remove();
    const target = label.getAttribute('for');
    if (target) {
      const original = byId(container, target);
      if (original instanceof HTMLInputElement && (original.type === 'radio' || original.type === 'checkbox')) label.remove();
    }
  });
  return ownText(clone);
}

const LABELISH =
  'label, legend, h1, h2, h3, h4, h5, h6, [class*="label" i], [class*="title" i], [class*="question" i], [class*="header" i], [class*="prompt" i]';

const isOptionLabel = (el: Element) => el.matches('label') && !!el.querySelector('input[type=radio], input[type=checkbox]');

/**
 * Help text under a question that only matched LABELISH by class name, like
 * Ashby's "ashby-application-form-question-description" ("(If hired,
 * verification will be required…)"). It comes after the title, so it would
 * otherwise win as the nearest heading. Breezy's is "question-body".
 */
const isHelpText = (el: Element) =>
  !el.matches('label, legend, h1, h2, h3, h4, h5, h6') && /descri|help|hint|instruction|subtitle|caption|question-body/i.test(el.getAttribute('class') ?? '');

/** Last label-like element inside `container` that comes before `el` in the page. */
function headingBefore(container: Element, el: Element): string {
  // Walk backwards so the last match is found without reading every earlier candidate.
  const candidates = container.querySelectorAll(LABELISH);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cand = candidates[i];
    if (cand.contains(el) || isOptionLabel(cand) || isHelpText(cand)) continue;
    if (!(cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const text = ownText(cand);
    // Ashby marks required questions with a class (its asterisk is CSS), not a "*" in the text.
    if (text && text.length <= 600 && !isGenericLabel(cleanLabel(text))) return isRequiredClass(cand.getAttribute('class') ?? '') ? `${text} *` : text;
  }
  return '';
}

/**
 * Walk up from the control (or group) while the ancestor still holds only this
 * one question. The nearest heading/label before the control wins; otherwise
 * the ancestor's own text is used.
 */
function containerLabel(el: Element, group: Element[] = [el]): string {
  const own = new Set(group);
  let fallback = '';
  let cur = parentOf(el);
  // Deep enough for react-select inputs ~10 levels under their label; the walk
  // still stops at the first ancestor that holds another question.
  for (let depth = 0; cur && depth < 12; depth++, cur = parentOf(cur)) {
    if (cur === document.body || cur === document.documentElement) break;
    const controls = controlsIn(cur);
    const foreign = controls.filter((c) => !own.has(c) && !(group.length > 1 && c.getAttribute('name') === group[0].getAttribute('name')));
    if (foreign.length && fieldCount(cur) > 1) {
      // A div dropdown with a follow-up checkbox under it ("I have a secondary major"):
      // the heading above the dropdown is still its own when no other question comes first.
      if (isDataDropdownBox(el) && foreign.every((c) => el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        const heading = headingBefore(cur, el);
        if (heading) return heading;
      }
      break;
    }
    const heading = headingBefore(cur, el);
    if (heading) return heading;
    // A dropdown's option list is not its question.
    if (!fallback && !isOptionLabel(cur) && !cur.querySelector('[data-dropdown-selection]')) {
      const text = questionText(cur);
      if (text && text.length <= 1500 && !isGenericLabel(cleanLabel(text))) fallback = text;
    }
  }
  return fallback;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-[\].]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Widget-part test ids that say nothing about the question. */
const GENERIC_TESTID = /^(?:input-.*|select-.*|field|screen-reader-only|chip|overlay|VStack|ButtonGroup)$/i;

/**
 * The nearest wrapper's data-testid that names the field ("phone_number-code" around
 * Rippling's unlabeled country-code picker).
 */
function wrapperTestId(el: Element): string {
  let cur = el.parentElement;
  for (let depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
    const id = cur.getAttribute('data-testid');
    if (id && !GENERIC_TESTID.test(id)) return id;
  }
  return '';
}

function hintsFor(el: Element): string {
  return [...['name', 'id', 'data-automation-id', 'data-qa', 'data-testid', 'autocomplete', 'placeholder', 'aria-label']
    .map((a) => el.getAttribute(a) ?? ''), wrapperTestId(el)]
    .filter((v) => v && !/^[:\-\w]{0,3}\d+:?$/.test(v) && !/^[0-9a-f-]{20,}$/i.test(v))
    .map(humanize)
    .join(' | ');
}

/** aria-label without the control's own current value and "Required" (Workday buttons). */
function ariaLabelMinusValue(el: Element): string {
  let label = el.getAttribute('aria-label') ?? '';
  const value = (el.textContent ?? '').trim();
  if (value && el.matches('button, [role="combobox"]')) label = label.split(value).join(' ');
  return label.replace(/\brequired\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Label for a single control. */
export function labelFor(el: Element): FieldLabel {
  const { label, marked } = pick([
    () => textOfIds(el, 'aria-labelledby'),
    () => ownText(labelElementFor(el)),
    () => ownText(el.closest('label')),
    () => ariaLabelMinusValue(el),
    // SPL puts the question on the autocomplete host, several shadow roots
    // away from its input. The input's own label is an empty slot.
    () => {
      const host = closestDeep(el, 'spl-autocomplete, spl-multiselect-autocomplete');
      return ownText(host?.querySelector(':scope > [slot="label-content"]') ?? null)
        || (host?.getAttribute('aria-label') ?? '').replace(/^Select\s+/i, '');
    },
    // Workday's questionnaire uses legends, including long consent text.
    // Read the legend directly so validation errors cannot hide the question
    // or push it past the container-label length limit.
    () => ownText(el.closest('fieldset')?.querySelector(':scope > legend') ?? null),
    () => containerLabel(el),
    () => el.getAttribute('placeholder') ?? '',
    () => el.getAttribute('title') ?? '',
  ]);
  return { label, hints: hintsFor(el), marked };
}

/** Label for a radio/checkbox/button group: the question, not any one option. */
export function groupLabelFor(members: Element[]): FieldLabel {
  const first = members[0];
  const group = first.closest('fieldset, [role="radiogroup"], [role="group"]');
  const { label, marked } = pick([
    // SPL radio groups slot the question into the host; its radiogroup fieldset is in a shadow root.
    () => ownText(first.closest('spl-radio-group')?.querySelector(':scope > [slot="label-content"]') ?? null),
    () => (group ? textOfIds(group, 'aria-labelledby') : ''),
    () => group?.querySelector(':scope > legend')?.textContent ?? '',
    () => group?.getAttribute('aria-label') ?? '',
    () => containerLabel(first, members),
  ]);
  return { label, hints: hintsFor(first), marked };
}

/** Visible text of one option (radio, checkbox, listbox option, button). */
export function optionText(el: Element): string {
  if (el.matches('spl-radio')) return cleanLabel(el.getAttribute('label'));
  if (el.getAttribute('role') === 'option') {
    const host = closestDeep(el, 'spl-select-option');
    if (host) return cleanLabel(ownText(host));
  }
  if (el instanceof HTMLInputElement) {
    const viaFor = labelElementFor(el);
    const text =
      textOfIds(el, 'aria-labelledby') ||
      cleanLabel(viaFor?.textContent) ||
      cleanLabel(el.closest('label')?.textContent) ||
      cleanLabel(el.getAttribute('aria-label')) ||
      cleanLabel(el.nextElementSibling?.textContent);
    return text || el.value;
  }
  // SuccessFactors radios are empty spans named by a separate label.
  if (el.getAttribute('role') === 'radio' && el.hasAttribute('aria-labelledby') && !cleanLabel(el.textContent)) {
    const text = textOfIds(el, 'aria-labelledby');
    if (text) return text;
  }
  return cleanLabel(el.getAttribute('aria-label') || el.textContent);
}

export function splSelectedValues(el: Element): string[] {
  const host = closestDeep(el, 'spl-multiselect-autocomplete');
  return host ? queryAllDeep('spl-tag', host).map((tag) => cleanLabel(tag.getAttribute('label') || ownText(tag))).filter(Boolean) : [];
}
