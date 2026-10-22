// Low-level DOM helpers: shadow-DOM-aware queries, visibility, native value
// setting, realistic clicks, and waiting for elements / quiet periods.

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Every element under `root` in rendered order, descending into open shadow roots where they sit. */
export function composedElements(root: ParentNode = document): Element[] {
  const out: Element[] = [];
  const visit = (node: ParentNode) => {
    for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
      out.push(child);
      if (child.shadowRoot) visit(child.shadowRoot);
      visit(child);
    }
  };
  // A scoped lookup must include the root host's own shadow tree too.
  if (root instanceof Element && root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return out;
}

/** querySelectorAll that also descends into open shadow roots (SmartRecruiters, SuccessFactors). */
export function queryAllDeep<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return composedElements(root).filter((el) => el.matches(selector)) as T[];
}

export function queryDeep<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return queryAllDeep<T>(selector, root)[0] ?? null;
}

/** getElementById that works inside the element's own (shadow) root. */
export function byId(context: Node, id: string): HTMLElement | null {
  const root = context.getRootNode() as Document | ShadowRoot;
  return (root.getElementById?.(id) as HTMLElement | null) ?? document.getElementById(id);
}

/** Parent that crosses shadow boundaries. */
export function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function closestDeep(el: Element, selector: string): Element | null {
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    if (cur.matches(selector)) return cur;
  }
  return null;
}

/**
 * react-select's control box ("select__control", "css-13cymwt-control"). A
 * class that merely contains "__control", like Oracle's
 * "input-row__control-container", is not one.
 */
export function reactSelectControl(el: Element): Element | null {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    if ([...cur.classList].some((c) => /__control(?:--[\w-]+)?$|css-\w+-control$/.test(c))) return cur;
  }
  return null;
}

/**
 * True when the page has a layout engine (false under happy-dom in tests).
 * Only a yes is remembered: a frame that is still hidden or empty when first
 * checked gets its layout later, and must not stay in no-layout mode.
 */
let layoutKnown = false;
function hasLayout(): boolean {
  if (!layoutKnown) layoutKnown = (document.body?.getBoundingClientRect().height ?? 0) > 0;
  return layoutKnown;
}
export function resetLayoutCache(): void {
  layoutKnown = false;
}

export function isVisible(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return false;
    if (cur instanceof HTMLElement && cur.hasAttribute('inert')) return false;
  }
  if (!hasLayout()) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  // No boxes means hidden; checked first because it's cheaper than every ancestor's style.
  if (!el.getClientRects().length) return false;
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    const s = getComputedStyle(cur);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Hidden "honeypot" fields exist to catch bots; filling one can get an
 * application silently discarded. Breezy uses e.g. name="hp_7f2b".
 */
export function isHoneypot(el: Element): boolean {
  const attrs = ['name', 'id', 'autocomplete', 'class'].map((a) => el.getAttribute(a) ?? '').join(' ');
  if (/(^|[\s_-])(hp|honeypot|honey|bot[-_]?trap|leave[-_]?blank)([\s_-]|$)|^hp_|\bhp-/i.test(attrs)) return true;
  if (el.getAttribute('tabindex') === '-1' && el instanceof HTMLInputElement && el.type === 'text') {
    if (!hasLayout()) return false;
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.bottom < 0 || r.width <= 1 || r.height <= 1) return true;
  }
  return false;
}

export function fire(el: Element, type: string, init: EventInit = {}): void {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

/** Set value via the prototype setter so React/Vue/Angular see the change. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  // React tracks the last value on the element; reset it so the change registers.
  const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  tracker?.setValue(value === '' ? ' ' : '');
  if (setter) setter.call(el, value);
  else el.value = value;
}

export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus();
  const last = value.slice(-1) || ' ';
  const key = { key: last, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent('keydown', key));
  setNativeValue(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
  // Some search boxes (Lever's location) only react to key events.
  el.dispatchEvent(new KeyboardEvent('keyup', key));
  fire(el, 'change');
}

export function blur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  el.dispatchEvent(new FocusEvent('blur', { composed: true }));
  el.blur?.();
}

/** Full pointer/mouse sequence; many custom dropdowns listen to mousedown, not click. */
export function realClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  (el as HTMLElement).click?.();
}

export function pressKey(el: Element, key: string): void {
  const code = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'ArrowDown' ? 40 : key === 'Tab' ? 9 : 0;
  const init = { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** Resolve with the first match (deep), or null after `timeout` ms. */
export function waitForElement<T extends Element = HTMLElement>(
  find: () => T | null | undefined,
  timeout = 3000,
): Promise<T | null> {
  const found = find();
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      const el = find();
      if (el) finish(el);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    // Shadow-DOM changes don't reach a document observer, so poll as well.
    const poll = setInterval(check, 150);
    const timer = setTimeout(() => finish(find() ?? null), timeout);
  });
}

/**
 * Resolve once `root` has had no DOM mutations for `quiet` ms (or after
 * `timeout`). Used after resume upload, while the ATS parses and refills.
 */
export function waitForStable(root: Node = document.body, quiet = 800, timeout = 10_000): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer = setTimeout(done, quiet);
    const hardTimer = setTimeout(done, timeout);
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(done, quiet);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    function done() {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve();
    }
  });
}

/** Text of an element without the text of form controls and option lists inside it. */
export function ownText(el: Element | null): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      'input, select, textarea, option, button, [role="listbox"], [role="option"], [role="radiogroup"] label, script, style, svg, [aria-hidden="true"], [hidden], .ng-hide, [role="combobox"], [role="alert"], [class*="error" i]',
    )
    .forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
