// Workday: stop "Save and Continue" / "Next" while a required field on the step is empty.
// Required fields carry an asterisk in their label (an <abbr>*</abbr> or a trailing "*"),
// aria-required="true", or a dropdown button whose aria-label ends in "Required".
import { isVisible, queryAllDeep } from './engine/dom';

export const NEXT_BUTTON = 'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="pageFooterNextButton"]';
const FIELD = '[data-automation-id^="formField"]';
const MARK_ATTR = 'data-getmeajobpls-required';

export interface MissingField {
  el: HTMLElement;
  label: string;
}

/** Label text of a form field, asterisk removed, from its own legend/label only. */
function fieldLabel(field: HTMLElement): string {
  const label = [...field.querySelectorAll('legend, label')].find((l) => l.closest(FIELD) === field);
  return (label?.textContent ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Elements inside `field` that belong to it, not to a form field nested inside it. */
function own<T extends Element>(field: HTMLElement, selector: string): T[] {
  return [...field.querySelectorAll<T>(selector)].filter((el) => el.closest(FIELD) === field);
}

function isRequired(field: HTMLElement): boolean {
  for (const l of own(field, 'legend, label')) {
    if ([...l.querySelectorAll('abbr')].some((a) => a.textContent?.trim() === '*')) return true;
    if (/\*\s*$/.test(l.textContent ?? '')) return true;
  }
  if (own(field, '[aria-required="true"]').length) return true;
  return own(field, 'button[aria-haspopup="listbox"]').some((b) => /\brequired\s*$/i.test(b.getAttribute('aria-label') ?? ''));
}

function isEmpty(field: HTMLElement): boolean {
  const radios = own<HTMLInputElement>(field, 'input[type="radio"]');
  if (radios.length) return !radios.some((r) => r.checked);
  const checkboxes = own<HTMLInputElement>(field, 'input[type="checkbox"]');
  if (checkboxes.length) return !checkboxes.some((c) => c.checked || c.getAttribute('aria-checked') === 'true');
  const dateParts = own<HTMLInputElement>(field, 'input[data-automation-id^="dateSection"]');
  if (dateParts.length) return dateParts.some((d) => !d.value.trim() && !d.getAttribute('aria-valuenow'));
  // Multi-select prompts (How did you hear, Skills, Field of study) show picks as selectedItem chips.
  if (own(field, '[data-automation-id="multiselectInputContainer"]').length) return !own(field, '[data-automation-id="selectedItem"]').length;
  const listbox = own<HTMLButtonElement>(field, 'button[aria-haspopup="listbox"]')[0];
  if (listbox) {
    const text = (listbox.textContent ?? '').trim();
    return !text || /^select one$/i.test(text);
  }
  // File uploads: Workday checks those itself, and an uploaded file has no simple marker.
  if (own(field, 'input[type="file"]').length) return false;
  const boxes = own<HTMLInputElement | HTMLTextAreaElement>(field, 'textarea, input:not([type="hidden"]):not([type="file"])');
  if (boxes.length) return boxes.every((b) => !b.value.trim());
  return false;
}

/** Visible required fields on the current Workday step that are still empty. */
export function emptyRequiredFields(root: ParentNode = document): MissingField[] {
  return queryAllDeep<HTMLElement>(FIELD, root)
    .filter((f) => !f.parentElement?.closest(FIELD) && isVisible(f) && isRequired(f) && isEmpty(f))
    .map((el) => ({ el, label: fieldLabel(el) || 'A required field' }));
}

function mark(missing: MissingField[]): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`)) {
    el.style.outline = el.getAttribute(MARK_ATTR) ?? '';
    el.removeAttribute(MARK_ATTR);
  }
  for (const { el } of missing) {
    el.setAttribute(MARK_ATTR, el.style.outline);
    el.style.outline = '2px solid #d93025';
    el.style.outlineOffset = '4px';
  }
}

/**
 * Blocks clicks on Workday's Next button while required fields are empty. `enabled` is read on
 * every click so the setting applies without a reload. Returns a function that removes the guard.
 */
export function installWorkdayGate(opts: { enabled: () => boolean; onBlocked: (missing: MissingField[]) => void }): () => void {
  const onClick = (event: Event) => {
    if (!opts.enabled()) return;
    const target = event.composedPath()[0];
    const button = target instanceof Element ? target.closest<HTMLButtonElement>(NEXT_BUTTON) : null;
    if (!button || /submit/i.test(button.textContent ?? '')) return;
    const missing = emptyRequiredFields();
    mark(missing);
    if (!missing.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    missing[0].el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    opts.onBlocked(missing);
  };
  window.addEventListener('click', onClick, { capture: true });
  return () => window.removeEventListener('click', onClick, { capture: true });
}
