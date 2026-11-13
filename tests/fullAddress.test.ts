// Address boxes: the street alone when the form asks for City, State and Zip separately; the
// whole address on one line when the box is the only place for it.
import { beforeEach, describe, expect, it } from 'vitest';
import { generic } from '../src/adapters/generic';
import { fullAddress } from '../src/lib/engine/answers';
import { addressForm } from '../src/lib/engine/fill';
import { context, fastTimings, testProfile } from './helpers/fixture';

const profile = () => {
  const p = testProfile();
  Object.assign(p.personal, { street: '1 Analytical Way', addressLine2: '', city: 'Los Angeles', state: 'California', zip: '90024', country: 'United States' });
  return p;
};

const box = (id: string, label: string, tag: 'input' | 'textarea' = 'input', help = '') => `
  <div class="field"><label for="${id}">${label}</label><${tag} id="${id}" type="text"${help ? ` aria-describedby="${id}-help"` : ''}></${tag}>
  ${help ? `<p id="${id}-help">${help}</p>` : ''}</div>`;

async function fill(html: string): Promise<(id: string) => string> {
  document.body.innerHTML = `<form>${html}</form>`;
  await generic.fill(context({ profile: profile() }));
  return (id) => (document.getElementById(id) as HTMLInputElement).value;
}

beforeEach(() => fastTimings());

describe('full address', () => {
  it('writes street, city, state abbreviation and zip on one line', () => {
    expect(fullAddress(profile())).toBe('1 Analytical Way, Los Angeles, CA, 90024');
    const p = profile();
    Object.assign(p.personal, { addressLine2: 'Apt 4', state: 'CA' });
    expect(fullAddress(p)).toBe('1 Analytical Way, Apt 4, Los Angeles, CA, 90024');
    Object.assign(p.personal, { street: '' });
    expect(fullAddress(p)).toBe('');
  });

  it.each([
    ['Complete current mailing address', true, false, 'full'],
    ['Mailing address', false, false, 'full'],
    ['Mailing address', false, true, 'street'],
    ['Address', false, true, 'street'],
    ['Home address', false, false, 'full'],
    ['Full address', false, true, 'full'],
    ['Current address (street, city, state, zip)', false, true, 'full'],
    ['Mailing address Full address including City, State, Zip', false, true, 'full'],
    ['Street address', false, false, 'street'],
    ['Address Line 1', false, false, 'street'],
    ['Address (City, State)', false, false, 'cityState'],
  ] as const)('%s (multi-line %s, City box %s) → %s', (text, multiline, cityBox, expected) => {
    expect(addressForm(text, multiline, cityBox)).toBe(expected);
  });

  it('fills a lone address box with the whole address, help text included', async () => {
    const value = await fill(
      box('first', 'First Name') + box('addr', 'Complete current mailing address', 'textarea', 'Full address including City, State, Zip'),
    );
    expect(value('addr')).toBe('1 Analytical Way, Los Angeles, CA, 90024');
  });

  it('keeps the street alone when the form has City, State and Zip boxes', async () => {
    const value = await fill(box('addr', 'Mailing address') + box('city', 'City') + box('state', 'State') + box('zip', 'Zip code'));
    expect(value('addr')).toBe('1 Analytical Way');
    expect(value('city')).toBe('Los Angeles');
    expect(value('zip')).toBe('90024');
  });

  it('answers "If no, enter N/A" under the other-citizenship box with N/A', async () => {
    const value = await fill(box('dual', 'In addition to U.S. citizenship, do you currently hold citizenship in any other country (including dual or multiple citizenship)?', 'input', 'If yes, please list all additional countries of citizenship. If no, please enter “N/A.”'));
    expect(value('dual')).toBe('N/A');
  });
});
