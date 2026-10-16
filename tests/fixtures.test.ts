// The fill engine against real application pages captured from each ATS
// (tests/fixtures/*.html, saved with `npm run capture`). Fixtures have no live
// JavaScript, so custom dropdowns can't open here — those are covered by
// `npm run live-test` in a real browser. These tests pin down labels, text
// fields, native selects, radios, checkboxes and button groups.
import { beforeEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../src/adapters';
import type { FillReport } from '../src/lib/types';
import { context, fastTimings, loadFixture } from './helpers/fixture';

const adapterFor = (id: string) => ADAPTERS.find((a) => a.id === id)!;
const value = (selector: string) => (document.querySelector(selector) as HTMLInputElement | null)?.value;
const status = (r: FillReport, label: RegExp) => r.fields.find((f) => label.test(f.label))?.status;

async function run(fixture: string, adapterId: string): Promise<FillReport> {
  loadFixture(fixture);
  return adapterFor(adapterId).fill(context());
}

beforeEach(() => fastTimings());

describe('Greenhouse', () => {
  it('fills identity fields by id and leaves the essay for review', async () => {
    const r = await run('greenhouse-a', 'greenhouse');
    expect(value('#first_name')).toBe('Ada');
    expect(value('#last_name')).toBe('Lovelace');
    expect(value('#preferred_name')).toBe('Ada');
    expect(value('#email')).toBe('ada@example.com');
    expect(status(r, /^Resume/)).toBe('filled');
    expect(status(r, /Why do you want to work at Acme/)).toBe('review');
  });

  it('reads question labels, not option text', async () => {
    const r = await run('greenhouse-a', 'greenhouse');
    const labels = r.fields.map((f) => f.label);
    expect(labels).toContain('Are you legally authorized to work in the United States for our Company?');
    expect(labels).toContain('Are you Hispanic/Latino?');
    expect(labels.some((l) => /Afghanistan/.test(l))).toBe(false);
  });

  it('works the same inside the embed iframe page', async () => {
    await run('greenhouse-embed', 'greenhouse');
    expect(value('#first_name')).toBe('Ada');
    expect(value('#email')).toBe('ada@example.com');
  });
});

describe('Lever', () => {
  it('fills full name, links and EEO radios', async () => {
    const r = await run('lever-b', 'lever');
    expect(value('input[name="name"]')).toBe('Ada Lovelace');
    expect(value('input[name="org"]')).toBe('Analytical Engines');
    expect(value('input[name="urls[LinkedIn]"]')).toBe('https://linkedin.com/in/ada');
    expect(value('input[name="urls[GitHub]"]')).toBe('https://github.com/ada');
    expect(status(r, /previously employed by Acme/)).toBe('filled');
    expect(status(r, /describes your gender/)).toBe('filled');
  });

  it('does not tick pronoun or marketing checkboxes', async () => {
    await run('lever-b', 'lever');
    const pronouns = [...document.querySelectorAll<HTMLInputElement>('input[name="pronouns"], #customPronounsOption')];
    expect(pronouns.some((p) => p.checked)).toBe(false);
  });

  it('answers yes/no questions and flags other-country citizenship as a guess', async () => {
    const r = await run('lever-a', 'lever');
    expect(status(r, /legally authorized to work/)).toBe('filled');
    expect(status(r, /require sponsorship/)).toBe('filled');
    expect(r.fields.find((f) => /Singapore citizen/.test(f.label))?.status).toBe('review');
    // "Name Pronunciation" must not receive pronouns.
    const pronunciation = r.fields.find((f) => /pronounce/i.test(f.label));
    expect(pronunciation?.status).not.toBe('filled');
  });
});

describe('Ashby', () => {
  it('fills system fields, yes/no buttons, multi-checkbox source and EEO radios', async () => {
    const r = await run('ashby-a', 'ashby');
    expect(value('#_systemfield_name')).toBe('Ada Lovelace');
    expect(value('#_systemfield_email')).toBe('ada@example.com');
    expect(status(r, /require Acme to sponsor/)).toBe('filled');
    const noButton = [...document.querySelectorAll('button[data-option="no"]')].find((b) =>
      b.closest('[data-field-path="790b5934-74f5-46f5-897a-675b7f37f2f3"]'),
    );
    expect(noButton).toBeTruthy();
    const linkedin = document.querySelector<HTMLInputElement>('input[type=checkbox][name="LinkedIn"]');
    expect(linkedin?.checked).toBe(true);
    const glassdoor = document.querySelector<HTMLInputElement>('input[type=checkbox][name="Glassdoor"]');
    expect(glassdoor?.checked).toBe(false);
  });

  it('declines EEO questions when the profile leaves them blank', async () => {
    await run('ashby-a', 'ashby');
    const checked = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]:checked')].map(
      (r) => document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent ?? '',
    );
    expect(checked.some((t) => /decline/i.test(t))).toBe(true);
  });
});

describe('Other boards (shared engine)', () => {
  it('Workable: aria-labelledby labels and radio fieldsets', async () => {
    const r = await run('workable', 'workable');
    expect(value('#firstname')).toBe('Ada');
    expect(value('#email')).toBe('ada@example.com');
    expect(status(r, /eligible to work/)).toBe('filled');
    // A long question that mentions GitHub is not a GitHub-URL field.
    expect(status(r, /open-source contributions with links/)).toBe('review');
  });

  it('Dover: MUI fields and the question heading above a radio group', async () => {
    const r = await run('dover', 'dover');
    expect(value('input[name="firstName"]')).toBe('Ada');
    expect(value('input[name="linkedinUrl"]')).toBe('https://linkedin.com/in/ada');
    expect(r.fields.some((f) => /reporting directly to a founder/.test(f.label))).toBe(true);
  });

  it('Breezy: fills fields and never the honeypot', async () => {
    await run('breezy', 'breezy');
    expect(value('input[name="cName"]')).toBe('Ada Lovelace');
    expect(value('input[name="hp_7f2b"]')).toBe('');
    expect(document.querySelector<HTMLInputElement>('input[name="smsConsent"]')?.checked).toBe(false);
  });

  it('Jobvite: native selects and address parts', async () => {
    const r = await run('jobvite', 'jobvite');
    expect(status(r, /^First Name$/)).toBe('filled');
    expect(status(r, /^City$/)).toBe('filled');
    expect(status(r, /^Zip$/)).toBe('filled');
  });

  it('Teamtailor: strips "Required" from labels', async () => {
    const r = await run('teamtailor', 'teamtailor');
    expect(r.fields.map((f) => f.label)).toContain('First name');
  });

  it('SmartRecruiters: fields inside shadow DOM, in on-screen order', async () => {
    const r = await run('smartrecruiters-b', 'smartrecruiters');
    const filled = r.fields.filter((f) => f.status === 'filled').map((f) => f.label);
    expect(filled).toEqual(expect.arrayContaining(['First name', 'Last name', 'Email', 'LinkedIn']));
    expect(filled.indexOf('First name')).toBeLessThan(filled.indexOf('LinkedIn'));
  });

  it('Recruitee: question-style labels', async () => {
    const r = await run('recruitee', 'recruitee');
    expect(status(r, /full name/i)).toBe('filled');
    expect(status(r, /email/i)).toBe('filled');
  });
});

describe('safety', () => {
  it('does not overwrite values unless the setting is on', async () => {
    loadFixture('greenhouse-a');
    (document.querySelector('#first_name') as HTMLInputElement).value = 'Grace';
    await adapterFor('greenhouse').fill(context());
    expect(value('#first_name')).toBe('Grace');

    loadFixture('greenhouse-a');
    (document.querySelector('#first_name') as HTMLInputElement).value = 'Grace';
    const ctx = context();
    ctx.settings.overwriteExisting = true;
    await adapterFor('greenhouse').fill(ctx);
    expect(value('#first_name')).toBe('Ada');
  });

  it('never clicks submit', async () => {
    loadFixture('lever-b');
    let submitted = false;
    document.addEventListener('submit', () => (submitted = true), true);
    document.querySelector('#btn-submit')?.addEventListener('click', () => (submitted = true));
    await adapterFor('lever').fill(context());
    expect(submitted).toBe(false);
  });
});
