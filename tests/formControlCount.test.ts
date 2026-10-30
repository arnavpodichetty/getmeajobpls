// The panel looks again for a form when the field count changes. SmartRecruiters
// puts every input inside a shadow root, so the count must see into them.
import { expect, it } from 'vitest';
import { formControlCount } from '../src/lib/engine/dom';

it('counts form controls inside open shadow roots', () => {
  document.body.innerHTML = '<input type="hidden"><input type="text"><spl-input></spl-input>';
  const host = document.querySelector('spl-input')!;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div><input type="text"></div><spl-inner></spl-inner>';
  shadow.querySelector('spl-inner')!.attachShadow({ mode: 'open' }).innerHTML = '<textarea></textarea><input type="search">';
  expect(formControlCount()).toBe(3);
});
