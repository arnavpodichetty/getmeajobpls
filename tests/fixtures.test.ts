// The fill engine against real application pages captured from each ATS
// (tests/fixtures/*.html, saved with `npm run capture`). Fixtures have no live
// JavaScript, so custom dropdowns can't open here — those are covered by
// `npm run live-test` in a real browser. These tests pin down labels, text
// fields, native selects, radios, checkboxes and button groups.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('Breezy rows and on-site question', () => {
  const setUrl = (url: string) => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  afterEach(() => setUrl('http://localhost/'));

  async function fill(city: string, state: string, jobs = 1) {
    setUrl('https://acme.breezy.hr/p/0-intern/apply');
    loadFixture('breezy-b');
    const ctx = context();
    Object.assign(ctx.profile.personal, { city, state });
    if (jobs > 1) ctx.profile.experience.push({ ...ctx.profile.experience[0], id: 'x2', company: 'Difference Engines', title: 'Tutor', current: false, start: '2025-06', end: '2025-08' });
    const r = await adapterFor('breezy').fill(ctx);
    const picked = [...document.querySelectorAll<HTMLInputElement>('input[name$="question_0"]')].find((e) => e.checked)?.parentElement?.textContent?.trim();
    return { r, picked };
  }
  const rowValue = (i: number, model: string) => document.querySelectorAll<HTMLInputElement>('li[ng-repeat*="work_history"]')[i].querySelector<HTMLInputElement>(`[ng-model="${model}"]`)!.value;

  it('puts one job in each work row, with dates in the date boxes', async () => {
    await fill('Los Angeles', 'CA', 2);
    expect(rowValue(0, 'candidatePosition.company_name')).toBe('Analytical Engines');
    expect(rowValue(1, 'candidatePosition.company_name')).toBe('Difference Engines');
    expect(rowValue(1, 'candidatePosition.date_end')).toBe('2025-08-01');
    expect(rowValue(2, 'candidatePosition.company_name')).toBe('');
  });

  it('labels questions by their heading, not the note under it', async () => {
    const { r } = await fill('Los Angeles', 'CA');
    expect(r.fields.some((f) => /^Give an example where you had to make a decision/.test(f.label))).toBe(true);
    expect(r.fields.some((f) => /expected length/.test(f.label))).toBe(false);
  });

  it('answers the on-site question from where you live', async () => {
    expect((await fill('Springfield', 'CA')).picked).toBe('YES, and I already live locally.');
    expect((await fill('Seattle', 'WA')).picked).toBe('YES, and I would relocate to work at Acme.');
    // Another city in the same state may or may not be commutable: left for you.
    expect((await fill('Los Angeles', 'CA')).picked).toBeUndefined();
  });
});

describe('RippleMatch', () => {
  const picked = (name: string) => {
    const el = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((e) => e.checked);
    return el ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : undefined;
  };
  const checkedLabels = () => [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter((e) => e.checked).map((e) => document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim());

  it('answers radio and checkbox groups the site marks role="listbox"', async () => {
    await run('ripplematch', 'ripplematch');
    expect(picked('currentlyEnrolled')).toBe('Yes');
    expect(picked('authorized')).toBe('Yes, I am authorized');
    expect(picked('futureSponsorship')).toBe('No, I will not require sponsorship');
    expect(picked('question-565639')).toBe('I am currently a “U.S. Person”');
    expect(checkedLabels()).toContain('LinkedIn');
    // The lone consent box under "Recruiter Questions".
    expect(checkedLabels().some((l) => /^By checking this box, I confirm/.test(l ?? ''))).toBe(true);
    // Never "I reside outside of the United States".
    expect(checkedLabels().some((l) => /reside outside/.test(l ?? ''))).toBe(false);
  });

  it('labels the home state box by its own label', async () => {
    const r = await run('ripplematch', 'ripplematch');
    expect(r.fields.some((f) => f.label === 'Your home state')).toBe(true);
    expect(r.fields.some((f) => f.label === 'Your Info')).toBe(false);
  });

  it('leaves first-generation and Pell Grant questions for you', async () => {
    await run('ripplematch', 'ripplematch');
    expect(picked('firstGenCollege')).toBeUndefined();
    expect(picked('eligiblePellGrant')).toBeUndefined();
  });
});

describe('iCIMS', () => {
  const field = (r: FillReport, label: RegExp) => r.fields.filter((f) => label.test(f.label));

  it('reads each styled dropdown once, as the dropdown, not its hidden select or search box', async () => {
    const r = await run('icims-a', 'icims');
    expect(field(r, /^State\/Province$/)).toHaveLength(1);
    expect(field(r, /^Degree Completed\?$/)).toHaveLength(1);
    expect(r.fields.some((f) => /^(?:Address|Education) \(1\)/.test(f.label))).toBe(false);
    // "— Make a Selection —" is a placeholder, not an answer.
    expect(r.fields.some((f) => f.status === 'skipped' && /Pronouns|School|Degree/.test(f.label))).toBe(false);
  });

  it('leaves Address 2 empty and drops the "Error:" label prefix', async () => {
    const r = await run('icims-a', 'icims');
    expect(value('[id="-1_PersonProfileFields.AddressStreet1"]')).toBe('1 Analytical Way');
    expect(value('[id="-1_PersonProfileFields.AddressStreet2"]')).toBe('');
    expect(r.fields.some((f) => /^How did you hear about Acme\?$/.test(f.label))).toBe(true);
  });

  it('splits the completion date into month, the 1st, and year', async () => {
    await run('icims-a', 'icims');
    expect(value('[id="-1_PersonProfileFields.rcf2140_Month"]')).toBe('06');
    expect(value('[id="-1_PersonProfileFields.rcf2140_Date"]')).toBe('1');
    expect(value('[id="-1_PersonProfileFields.rcf2140_Year"]')).toBe('2028');
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
    expect(document.querySelector<HTMLInputElement>('input[type=tel]')?.value).toBe('1-415-555-0100');
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
