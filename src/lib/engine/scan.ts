// Turns a page into a list of logical fields: one entry per question, with
// radio/checkbox/button groups collapsed and widget internals ignored.
import { closestDeep, composedElements, isHoneypot, isVisible, parentOf, queryAllDeep, reactSelectControl } from './dom';
import { groupLabelFor, labelFor, optionText, splSelectedValues, type FieldLabel } from './labels';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'date'
  | 'radio'
  | 'checkboxes'
  | 'checkbox'
  | 'combobox'
  | 'buttons'
  | 'file'
  | 'richtext';

export interface Field extends FieldLabel {
  kind: FieldKind;
  /** The control to fill (first member for groups). */
  el: HTMLElement;
  /** Radios, checkboxes or buttons for group kinds; [el] otherwise. */
  members: HTMLElement[];
  required: boolean;
}

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'search']);

function isRequired(el: Element, label: FieldLabel, members: Element[] = [el]): boolean {
  if (label.marked) return true;
  return members.some(
    (m) => (m as HTMLInputElement).required || m.getAttribute('aria-required') === 'true' || m.hasAttribute('data-required'),
  );
}

function usable(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (isHoneypot(el)) return false;
  return true;
}

/** Radios/checkboxes are often visually hidden behind styled labels; check the label too. */
function choiceVisible(input: HTMLInputElement): boolean {
  if (isVisible(input)) return true;
  const label = input.closest('label') ?? (input.id ? (input.getRootNode() as Document).querySelector?.(`label[for="${CSS.escape(input.id)}"]`) : null);
  return !!label && isVisible(label);
}

function isToggleButton(b: Element): boolean {
  return b.hasAttribute('aria-pressed') || b.hasAttribute('data-option') || b.getAttribute('role') === 'radio';
}

/** Nearest ancestor holding ≥2 checkboxes and no other kind of control → one question. */
function checkboxGroupRoot(input: HTMLInputElement): Element | null {
  const set = input.closest('fieldset, [role="group"]');
  if (set && set.querySelectorAll('input[type=checkbox]').length > 1) return set;
  let cur = parentOf(input);
  for (let depth = 0; cur && depth < 5; depth++, cur = parentOf(cur)) {
    const boxes = cur.querySelectorAll('input[type=checkbox]');
    const others = cur.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), select, textarea, [role=combobox]');
    if (others.length) return null;
    if (boxes.length > 1) return cur;
  }
  return null;
}

/** Workday renders each dropdown as a button plus a bare <input> beside it; the input isn't a question. */
function isDropdownHelper(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.id || el.name || el.getAttribute('aria-label')) return false;
  const prev = el.previousElementSibling;
  return !!prev && prev.matches('button[aria-haspopup="listbox"]');
}

export function scanFields(root: ParentNode = document): Field[] {
  const fields: Field[] = [];
  const seen = new Set<Element>();
  const push = (kind: FieldKind, el: HTMLElement, members: HTMLElement[], label: FieldLabel) => {
    members.forEach((m) => seen.add(m));
    seen.add(el);
    fields.push({ kind, el, members, ...label, required: isRequired(el, label, members) });
  };

  // Toggle-button groups (Ashby yes/no): buttons with aria-pressed/data-option sharing a parent.
  for (const button of queryAllDeep<HTMLButtonElement>('button[aria-pressed], button[data-option], [role="radio"]:not(input)', root)) {
    const parent = parentOf(button);
    if (!parent || seen.has(button) || !isVisible(button)) continue;
    // SuccessFactors wraps each role="radio" in its own span; the radiogroup holds the set.
    const group = button.getAttribute('role') === 'radio' ? button.closest('[role="radiogroup"]') : null;
    const grouped = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]:not(input)')] : [];
    const members = grouped.length > 1 ? grouped : [...parent.children].filter(isToggleButton) as HTMLElement[];
    if (members.length < 2) continue;
    const hidden = [...parent.querySelectorAll<HTMLElement>('input[type=checkbox], input[type=radio]')];
    hidden.forEach((h) => seen.add(h));
    push('buttons', members[0], members, groupLabelFor([...members, ...hidden]));
  }

  const controls = queryAllDeep<HTMLElement>(
    'input, select, textarea, [role="combobox"], button[aria-haspopup="listbox"], [contenteditable="true"]',
    root,
  );
  // A dropdown's own search box shares its menu id (aria-controls) with the dropdown button.
  const menuIds = new Set(
    controls.filter((c) => !(c instanceof HTMLInputElement) && c.getAttribute('aria-controls')).map((c) => c.getAttribute('aria-controls')),
  );
  const isMenuSearch = (el: HTMLElement) =>
    (menuIds.has(el.getAttribute('aria-controls')) && el instanceof HTMLInputElement) ||
    !!el.closest('[role="listbox"], [role="menu"], .iti__dropdown-content');
  const radioGroups = new Map<unknown, HTMLInputElement[]>();
  const checkboxGroups = new Map<Element, HTMLInputElement[]>();

  for (const el of controls) {
    if (seen.has(el) || !usable(el) || isMenuSearch(el)) continue;
    if (closestDeep(el, 'header, nav, [role="banner"], [role="navigation"]')) continue; // site menus, language pickers
    if (el.getAttribute('role') === 'spinbutton') continue; // date parts; adapters fill these as dates
    if (isDropdownHelper(el)) continue;

    if (el instanceof HTMLInputElement) {
      const type = el.type.toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'password') continue;
      if (type === 'file') {
        push('file', el, [el], labelFor(el));
        continue;
      }
      if (type === 'radio') {
        if (!choiceVisible(el)) continue;
        const group = closestDeep(el, '[role="radiogroup"], fieldset');
        const key: unknown = el.name ? `name:${el.name}` : (group ?? el);
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key)!.push(el);
        continue;
      }
      if (type === 'checkbox') {
        if (!choiceVisible(el) || el.getAttribute('tabindex') === '-1') continue;
        const groupRoot = checkboxGroupRoot(el);
        if (groupRoot) {
          if (!checkboxGroups.has(groupRoot)) checkboxGroups.set(groupRoot, []);
          checkboxGroups.get(groupRoot)!.push(el);
        } else {
          push('checkbox', el, [el], labelFor(el));
        }
        continue;
      }
      if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex === -1) continue; // widget internals
      if (!isVisible(el) || el.readOnly && el.getAttribute('role') !== 'combobox') continue;
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') {
        push('combobox', el, [el], labelFor(el));
      } else if (type === 'date' || type === 'month') {
        push('date', el, [el], labelFor(el));
      } else if (TEXT_TYPES.has(type)) {
        push('text', el, [el], labelFor(el));
      }
      continue;
    }

    if (!isVisible(el)) continue;
    if (el instanceof HTMLSelectElement) push('select', el, [el], labelFor(el));
    else if (el instanceof HTMLTextAreaElement) {
      if (el.readOnly || el.name === 'g-recaptcha-response') continue;
      push('textarea', el, [el], labelFor(el));
    } else if (el.getAttribute('contenteditable') === 'true') {
      if (el.closest('[contenteditable="true"]') !== el) continue; // nested editable
      push('richtext', el, [el], labelFor(el));
    } else {
      // div[role=combobox] (Rippling, MUI) or Workday's button[aria-haspopup=listbox]
      if (el.querySelector('input')) continue; // the inner input is handled itself
      push('combobox', el, [el], labelFor(el));
    }
  }

  for (const members of radioGroups.values()) push('radio', members[0], members, groupLabelFor(members));
  for (const members of checkboxGroups.values()) push('checkboxes', members[0], members, groupLabelFor(members));

  // Rendered order (shadow roots included) so filling goes top to bottom like a person would.
  const order = new Map(composedElements(root).map((el, i) => [el, i]));
  return fields.sort((a, b) => (order.get(a.el) ?? 0) - (order.get(b.el) ?? 0));
}

/** Current value of a field, for "don't overwrite" checks and saving answers. */
export function currentValue(field: Field): string {
  const el = field.el;
  switch (field.kind) {
    case 'radio':
    case 'checkboxes':
      return field.members.filter((m) => (m as HTMLInputElement).checked).map((m) => (m as HTMLInputElement).value).join(', ');
    case 'checkbox':
      return (el as HTMLInputElement).checked ? 'checked' : '';
    case 'buttons':
      return field.members.filter((m) => m.getAttribute('aria-pressed') === 'true' || m.getAttribute('aria-checked') === 'true').map(optionText).join(', ');
    case 'file':
      return (el as HTMLInputElement).files?.length ? 'file' : '';
    case 'select': {
      const s = el as HTMLSelectElement;
      const opt = s.selectedOptions[0];
      return opt && opt.value && !/^(select|choose|please)/i.test(opt.text.trim()) ? opt.text.trim() : '';
    }
    case 'combobox': {
      const splValues = splSelectedValues(el);
      if (splValues.length) return splValues.join(', ');
      // react-select / MUI show the chosen value in a sibling element
      const container = el.closest('[class*="control" i]') ?? el.closest('[class*="container" i], [class*="select" i], [data-automation-id]') ?? parentOf(el);
      const shown = container?.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="selected" i], [data-automation-id="selectedItem"]');
      if (shown?.textContent?.trim()) return shown.textContent.trim();
      if (el instanceof HTMLInputElement) {
        // In react-select this input is a search query, never the selected
        // value. A leftover "science" must not make autofill skip the field.
        if (el.getAttribute('aria-autocomplete') === 'list' && reactSelectControl(el)) return '';
        return el.value.trim();
      }
      if (!(el instanceof HTMLInputElement)) {
        const text = el.textContent?.trim() ?? '';
        return /^(select|choose|search)/i.test(text) ? '' : text;
      }
      return '';
    }
    case 'richtext':
      return el.textContent?.trim() ?? '';
    default:
      return (el as HTMLInputElement).value?.trim() ?? '';
  }
}
