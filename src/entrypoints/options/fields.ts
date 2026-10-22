// Form controls bound directly to a property of a state object. Each edit
// mutates the object and calls onChange (which schedules an autosave).
import { h } from '../../lib/dom';

type Obj = Record<string, any>;

interface InputOpts {
  type?: string;
  placeholder?: string;
  list?: string;
  wide?: boolean;
  /** Keyboard to show on touch screens, e.g. "numeric". */
  inputMode?: string;
  /** Cleans what's typed or pasted before it's saved (and shows the cleaned value). */
  sanitize?: (value: string) => string;
}

export function textField(
  label: string,
  obj: Obj,
  key: string,
  onChange: () => void,
  opts: InputOpts = {},
): HTMLElement {
  const input = h('input', {
    type: opts.type ?? 'text',
    value: obj[key] ?? '',
    placeholder: opts.placeholder,
    list: opts.list,
    inputmode: opts.inputMode,
    onInput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      const value = opts.sanitize ? opts.sanitize(el.value) : el.value;
      if (value !== el.value) el.value = value;
      obj[key] = value;
      onChange();
    },
  });
  return h('label', { class: opts.wide ? 'field wide' : 'field' }, h('span', {}, label), input);
}

export function textArea(
  label: string,
  obj: Obj,
  key: string,
  onChange: () => void,
  opts: { rows?: number; placeholder?: string } = {},
): HTMLElement {
  const area = h('textarea', {
    rows: opts.rows ?? 3,
    placeholder: opts.placeholder,
    onInput: (e: Event) => {
      obj[key] = (e.target as HTMLTextAreaElement).value;
      onChange();
    },
  });
  area.value = obj[key] ?? '';
  return h('label', { class: 'field wide' }, h('span', {}, label), area);
}

/** options: [value, label]; value '' is the "unset" choice. */
export function selectField(
  label: string,
  obj: Obj,
  key: string,
  options: [string, string][],
  onChange: () => void,
): HTMLElement {
  const select = h(
    'select',
    {
      onChange: (e: Event) => {
        obj[key] = (e.target as HTMLSelectElement).value;
        onChange();
      },
    },
    ...options.map(([value, text]) => h('option', { value }, text)),
  );
  select.value = obj[key] ?? '';
  return h('label', { class: 'field' }, h('span', {}, label), select);
}

export function checkboxField(
  label: string,
  obj: Obj,
  key: string,
  onChange: () => void,
  hint?: string,
): HTMLElement {
  return h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: !!obj[key],
      onChange: (e: Event) => {
        obj[key] = (e.target as HTMLInputElement).checked;
        onChange();
      },
    }),
    h('span', {}, label, hint ? h('small', {}, hint) : null),
  );
}

/** Comma-separated list bound to a string[] property. */
export function listField(
  label: string,
  obj: Obj,
  key: string,
  onChange: () => void,
  opts: { placeholder?: string; multiline?: boolean; rows?: number } = {},
): HTMLElement {
  const parse = (v: string) =>
    v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  const onInput = (e: Event) => {
    obj[key] = parse((e.target as HTMLInputElement | HTMLTextAreaElement).value);
    onChange();
  };
  const control = opts.multiline
    ? h('textarea', { rows: opts.rows ?? 3, placeholder: opts.placeholder, onInput })
    : h('input', { type: 'text', placeholder: opts.placeholder, onInput });
  control.value = (obj[key] as string[]).join(', ');
  return h('label', { class: 'field wide' }, h('span', {}, label), control);
}

export const grid = (...children: HTMLElement[]) => h('div', { class: 'grid' }, ...children);
