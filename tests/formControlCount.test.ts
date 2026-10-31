// The panel looks again for a form when the field count changes. SmartRecruiters
// puts every input inside a shadow root, so the count must see into them.
import { describe, expect, it } from 'vitest';
import { formControlCount } from '../src/lib/engine/dom';

it('counts form controls inside open shadow roots', () => {
  document.body.innerHTML = '<input type="hidden"><input type="text"><spl-input></spl-input>';
  const host = document.querySelector('spl-input')!;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div><input type="text"></div><spl-inner></spl-inner>';
  shadow.querySelector('spl-inner')!.attachShadow({ mode: 'open' }).innerHTML = '<textarea></textarea><input type="search">';
  expect(formControlCount()).toBe(3);
});

describe('cookie preference panels', () => {
  it('skips cookie switches but not a page marked as cookie-accepting', async () => {
    const { scanFields } = await import('../src/lib/engine/scan');
    const { resetLayoutCache } = await import('../src/lib/engine/dom');
    document.body.className = 'cookies-accepted';
    document.body.innerHTML = `<form><label>First name <input name="first"></label></form>
      <div class="cookiemanager"><label>Analytics cookies <input type="checkbox" role="switch"></label></div>`;
    resetLayoutCache();
    expect(scanFields().map((f) => f.label)).toEqual(['First name']);
    document.body.className = '';
  });
});
