import { beforeEach, describe, expect, it } from 'vitest';
import { expandSections, successfactors } from '../src/adapters/successfactors';
import { detectAdapter } from '../src/adapters';
import { resolveAnswer } from '../src/lib/engine/answers';
import { queryDeep, resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(fastTimings);

let copies = 0;

/** cloneNode drops shadow roots (the date pickers live in them); copy them too. */
function cloneWithShadow(node: Element): Element {
  const copy = node.cloneNode(false) as Element;
  if (node.shadowRoot) {
    const shadow = copy.attachShadow({ mode: 'open' });
    for (const child of node.shadowRoot.children) shadow.append(cloneWithShadow(child));
  }
  for (const child of node.childNodes) copy.append(child instanceof Element ? cloneWithShadow(child) : child.cloneNode(false));
  return copy;
}

/**
 * The capture has one row in each repeating section (added by hand). Empty the
 * sections and make "Add" insert a fresh copy of that row, like the live site.
 */
function liveRows() {
  loadFixture('successfactors-2');
  for (const section of document.querySelectorAll<HTMLElement>('.rcmFormSection')) {
    const add = section.querySelector<HTMLElement>('.addRowButton');
    const row = section.querySelector<HTMLElement>('.rcmSectionComponent');
    if (!add || !row) continue;
    const container = row.parentElement!;
    row.remove();
    container.querySelector('.rowNumTextAcc')?.remove();
    add.addEventListener('click', () => {
      const n = ++copies;
      const copy = cloneWithShadow(row) as HTMLElement;
      for (const el of [copy, ...copy.querySelectorAll('*')]) {
        for (const attr of ['id', 'for']) {
          const v = el.getAttribute(attr);
          if (v && /^\d+:/.test(v)) el.setAttribute(attr, `c${n}_${v}`);
        }
        el.removeAttribute('data-getmeajobpls');
        if (el instanceof HTMLInputElement) el.value = '';
      }
      container.append(copy);
      resetLayoutCache();
    });
  }
  resetLayoutCache();
}

const sectionNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.rcmFormSection')].find((s) => s.querySelector('.rcmFormSectionTopBar')?.textContent?.includes(name))!;
const rowInputs = (name: string) => [...sectionNamed(name).querySelectorAll<HTMLInputElement>('.rcmSectionComponent input[data-testid="sfTextField"]')];

describe('SAP SuccessFactors', () => {
  it('is detected on SuccessFactors hosts', () => {
    expect(detectAdapter(new URL('https://career5.successfactors.eu/careers?company=HOOLI'), document).id).toBe('successfactors');
    expect(detectAdapter(new URL('https://career4.successfactors.com/careers?company=acme'), document).id).toBe('successfactors');
  });

  it('opens collapsed sections but not the site header menus', async () => {
    loadFixture('successfactors-1');
    const bar = sectionNamed('Formal Education').querySelector<HTMLButtonElement>('.rcmFormSectionTopBar')!;
    bar.setAttribute('aria-expanded', 'false');
    bar.addEventListener('click', () => bar.setAttribute('aria-expanded', 'true'));
    const menus = [...document.querySelectorAll<HTMLElement>('[aria-expanded="false"]:not(.rcmFormSectionTopBar)')];
    expect(await expandSections()).toBe(1);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    expect(menus.every((m) => m.getAttribute('aria-expanded') === 'false')).toBe(true);
  });

  it('adds a row per job and school and fills each one', async () => {
    liveRows();
    const ctx = context({ resume: null });
    ctx.profile.experience.push({ id: 'x2', company: 'Difference Engines', title: 'Research Assistant', type: 'Research', location: 'London', start: '2024-05', end: '2024-07', current: false, description: 'Tables.' });
    const report = await successfactors.fill(ctx);

    const jobs = sectionNamed('Previous Employment').querySelectorAll('.rcmSectionComponent');
    expect(jobs).toHaveLength(2);
    const values = rowInputs('Previous Employment').map((i) => i.value);
    expect(values).toEqual(expect.arrayContaining(['Analytical Engines', 'Seattle, WA', 'Software Engineering Intern', 'Difference Engines', 'London', 'Research Assistant']));
    const second = jobs[1];
    const date = (row: Element, title: string) => {
      const host = row.querySelector<HTMLElement>(`[data-testid="datePicker"][title="${title}"]`)!;
      return queryDeep<HTMLInputElement>('input', host.shadowRoot!)!.value;
    };
    expect(date(second, 'Date Begin')).toBe('05/01/2024');
    expect(date(second, 'End Date')).toBe('07/01/2024');
    expect(date(jobs[0], 'End Date')).toBe(''); // current job

    const schools = sectionNamed('Formal Education').querySelectorAll('.rcmSectionComponent');
    expect(schools).toHaveLength(1);
    expect(rowInputs('Formal Education')[0].value).toBe('University of California, Los Angeles');
    expect(date(schools[0], 'Start Date')).toBe('09/01/2024');
    expect(date(schools[0], 'End Date')).toBe('06/01/2028');

    // Sections with nothing in the profile get no rows.
    expect(sectionNamed('Awards').querySelectorAll('.rcmSectionComponent')).toHaveLength(0);
    expect(sectionNamed('Professional Memberships').querySelectorAll('.rcmSectionComponent')).toHaveLength(0);
    expect(report.fields.some((f) => f.label.startsWith('Job 2'))).toBe(true);

    // Filling again doesn't add more rows.
    await successfactors.fill(ctx);
    expect(sectionNamed('Previous Employment').querySelectorAll('.rcmSectionComponent')).toHaveLength(2);
  });
});

describe('SAP SuccessFactors submits', () => {
  it('never presses Enter or submits the application form while filling', async () => {
    liveRows();
    const form = document.querySelector('form')!;
    let entered = 0;
    let submitted = 0;
    document.addEventListener('keydown', (e) => e.key === 'Enter' && entered++, true);
    form.addEventListener('submit', () => submitted++);
    // A stray submit (e.g. a button without type="button") gets blocked during the fill.
    const stray = document.createElement('button');
    form.append(stray);
    sectionNamed('Previous Employment').querySelector('.addRowButton')!.addEventListener('click', () => form.requestSubmit(stray));
    await successfactors.fill(context({ resume: null }));
    expect(entered).toBe(0);
    expect(submitted).toBe(0);
  });
});

describe('SAP SuccessFactors questions', () => {
  /** SuccessFactors radios: span[role=radio] per option, flipped by a click. */
  function liveRadios() {
    for (const radio of document.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')) {
      radio.addEventListener('click', () => {
        radio.closest('[role="radiogroup"]')!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', String(r === radio)));
      });
    }
  }
  const radioAnswer = (question: string) => {
    const label = [...document.querySelectorAll('label.rcmFormQuestionLabel')].find((l) => l.textContent!.includes(question))!;
    const group = document.getElementById(label.getAttribute('for')!)!;
    const checked = group.querySelector('[role="radio"][aria-checked="true"]');
    return checked ? document.getElementById(checked.getAttribute('aria-labelledby')!)!.textContent : null;
  };
  const textField = (label: string) => {
    const el = [...document.querySelectorAll<HTMLLabelElement>('label.rcmFormFieldLabel')].find((l) => l.textContent!.includes(label))!;
    return document.getElementById(el.htmlFor) as HTMLInputElement;
  };

  it('answers the yes/no radio questions', async () => {
    loadFixture('successfactors-1');
    liveRadios();
    await successfactors.fill(context({ resume: null }));
    expect(radioAnswer('right to work')).toBe('Yes');
    expect(radioAnswer('require sponsorship')).toBe('No');
    expect(radioAnswer('relatives currently working')).toBe('No');
  });

  it('leaves "if yes" employment follow-ups empty and answers referral/relative ones N/A', async () => {
    loadFixture('successfactors-1');
    liveRadios();
    await successfactors.fill(context({ resume: null }));
    for (const label of ['Employment Location', 'Dates of Employment', 'Name While Employed']) {
      expect(textField(label).value).toBe('');
    }
    // Referral and relative follow-ups answer N/A.
    for (const label of ['Were you referred by', 'If related, please provide name']) {
      expect(textField(label).value).toBe('N/A');
    }
  });

  it('maps Related Employee and Disabled dropdowns', () => {
    const { profile } = context();
    const ask = (label: string) => resolveAnswer(label, '', null, { profile, skills: [] }, true).answer;
    expect(ask('Related Employee: Yes/No')?.key).toBe('relatedToEmployee');
    expect(ask('Do you have any relatives currently working at Hooli?')?.key).toBe('relatedToEmployee');
    profile.eeo.disability = 'No, I do not have a disability';
    expect(ask('Disabled')?.tiers).toEqual([[profile.eeo.disability], ['No', 'Not disabled', 'I do not have a disability']]);
  });

  it('still fills a referrer name when there is one', () => {
    const { profile } = context();
    profile.answers.referrerName = 'Grace Hopper';
    expect(resolveAnswer('Were you referred by an employee? If so, please provide the employees name:', '', null, { profile, skills: [] }, false).answer?.value).toBe('Grace Hopper');
    // As a Yes/No dropdown it's still the referral question.
    expect(resolveAnswer('Were you referred by an employee? If so, who?', '', null, { profile, skills: [] }, true).answer?.key).toBe('referredByEmployee');
  });
});
