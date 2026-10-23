// Oracle Recruiting (Candidate Experience) renders dropdowns as cx-select:
// an <input role="combobox" aria-haspopup="grid"> whose popup lists each
// choice as a [role="gridcell"][aria-selected], and yes/no questions as
// role="radio" pill buttons. These stand-ins mimic that markup and behaviour.
import { beforeEach, describe, expect, it } from 'vitest';
import { oracle } from '../src/adapters/oracle';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cxSelect(id: string, label: string, options: string[], opts: { required?: boolean; ignoreClicks?: boolean } = {}): string {
  return `<div class="input-row input-row--has-picker">
    <label class="input-row__label" for="${id}"><span class="input-row__label-text">${label}${opts.required ? ' <span aria-hidden="true">*</span>' : ''}</span></label>
    <div class="input-row__control-container"><div class="cx-select-container">
      <input id="${id}" name="${id.replace(/-\d+$/, '')}" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-controls="${id}-listbox" aria-expanded="false"
        ${opts.required ? 'aria-required="true"' : ''} data-options="${options.join('|')}" ${opts.ignoreClicks ? 'data-ignore="1"' : ''} class="cx-select-input">
    </div></div></div>`;
}

/** Opens a grid of matching options under the input; a click on a cell writes it into the input. */
function wireCxSelects(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[aria-haspopup="grid"]:not([data-wired])')) {
    input.dataset.wired = '1';
    const all = input.dataset.options!.split('|');
    const render = () => {
      document.getElementById(`${input.id}-listbox`)?.remove();
      const query = input.value.toLowerCase();
      const grid = document.createElement('div');
      grid.id = `${input.id}-listbox`;
      grid.className = 'cx-select__list';
      grid.setAttribute('role', 'grid');
      all.filter((o) => o.toLowerCase().includes(query)).forEach((o, i) => {
        const row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.innerHTML = `<div tabindex="-1" role="gridcell" id="${input.id}-listitem-${i}" aria-selected="false" class="cx-select__list-item"><div class="cx-select__list-item-container">${o}</div></div>`;
        row.firstElementChild!.addEventListener('click', () => {
          if (!input.dataset.ignore) input.value = o;
          grid.remove();
        });
        grid.append(row);
      });
      input.parentElement!.append(grid);
    };
    input.addEventListener('click', render);
    input.addEventListener('input', render);
  }
}

function cxSelectRaw(id: string, labelledby: string, options: string[]): string {
  return `<div class="cx-select-container"><input id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-controls="${id}-listbox" aria-labelledby="${labelledby}" data-options="${options.join('|')}" class="cx-select-input"></div>`;
}

function pills(label: string, options: string[], required = false): string {
  return `<div class="input-row input-row--has-picker">
    <label class="input-row__label"><span class="input-row__linebreak">${label}</span>${required ? '<span class="input-row__label--required-star" aria-hidden="true"></span>' : ''}</label>
    <div class="input-row__control-container"><div><ul role="radiogroup" aria-label="${label}" class="cx-select-pills-container">
      ${options.map((o) => `<li role="presentation"><button type="button" role="radio" aria-checked="false" class="cx-select-pill-section"><span class="cx-select-pill-name"> ${o}</span></button></li>`).join('')}
    </ul></div></div></div>`;
}

function wirePills(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.cx-select-pill-section')) {
    button.addEventListener('click', () => {
      button.closest('ul')!.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
    });
  }
}

const chosen = (label: string) => [...document.querySelectorAll('[role="radiogroup"]')]
  .find((g) => g.getAttribute('aria-label') === label)
  ?.querySelector('[aria-checked="true"]')?.textContent?.trim() ?? null;

describe('Oracle Recruiting', () => {
  it('fills cx-select dropdowns and pill questions', async () => {
    document.body.innerHTML = `<form>
      ${pills('Title', ['Doctor', 'Miss', 'Mr.', 'Mrs.', 'Ms.'])}
      ${cxSelect('country-20', 'Country', ['Canada', 'United Kingdom', 'United States'], { required: true })}
      ${cxSelect('city-69', 'City', ['Los Alamos, Los Alamos, NM', 'Los Angeles, Los Angeles, CA', 'Seattle, King, WA'], { required: true })}
      ${cxSelect('region2-72', 'State', ['Arizona', 'California', 'Washington'], { required: true })}
      ${cxSelect('postalCode-73', 'Postal Code', ['90024', '90025', '98101'], { required: true })}
      ${pills('Are you at least 18 years of age?', ['Yes', 'No'], true)}
      ${pills('Will you now or in the future require sponsorship for an employment-based visa status?', ['Yes', 'No'], true)}
      ${cxSelect('grad-month', 'Please select your expected graduation month of your current studies, or if you have already graduated select the month you graduated from your most recent studies.', MONTHS)}
      ${cxSelect('grad-year', 'Please select your expected graduation year of your current studies, or if you have already graduated select the year you graduated from your most recent studies.', ['2026', '2027', '2028', '2029'])}
      ${pills('What is the type of degree program are you currently enrolled in?', ['High School Diploma', 'Associate Degree', 'Bachelor’s Degree', 'Master’s Degree (non-MBA)', 'Doctorate (PhD, EdD, etc.)', 'None'], true)}
    </form>`;
    wireCxSelects();
    wirePills();
    resetLayoutCache();

    const report = await fillPage(context({ resume: null }), { ats: 'Oracle Recruiting' });
    const value = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value;
    expect(value('country-20')).toBe('United States');
    expect(value('city-69')).toBe('Los Angeles, Los Angeles, CA');
    expect(value('region2-72')).toBe('California');
    expect(value('postalCode-73')).toBe('90024');
    expect(value('grad-month')).toBe('June');
    expect(value('grad-year')).toBe('2028');
    expect(chosen('Are you at least 18 years of age?')).toBe('Yes');
    expect(chosen('Will you now or in the future require sponsorship for an employment-based visa status?')).toBe('No');
    expect(chosen('What is the type of degree program are you currently enrolled in?')).toBe('Bachelor’s Degree');
    // "Title" here is an honorific, not your job title: leave it alone.
    expect(chosen('Title')).toBeNull();
    expect(report.fields.find((f) => f.label === 'Title')).toBeUndefined();
    expect(report.needsReview).toBe(0);
  });

  it('flags required pill questions it cannot answer and leaves optional extras alone', async () => {
    // As on the real page: the required star is a class on the label, the question is the radiogroup's aria-label.
    const requiredPills = (label: string) => pills(label, ['Yes', 'No']).replace('class="input-row__label"', 'class="input-row__label input-row__label--required"');
    document.body.innerHTML = `<form>
      ${requiredPills('Do you currently have any professional certifications that apply to the role?')}
      ${requiredPills('Would you be subject to any restrictions from a former employer upon joining Example Group?')}
      ${cxSelect('month-US-DDF-militaryDischargeDate-18', 'Newly Separated Veteran Discharge Date Month', MONTHS)}
      <div class="apply-flow-block"><p class="apply-flow-block__instructions">By clicking I agree below, I confirm that I would like my personal data to be kept for 24 months so that Example Group can notify me of future job opportunities.</p>
        <div class="input-row input-row--checkbox"><input type="checkbox" class="input-row__hidden-control" id="af-checkbox-dataRetention-40" aria-labelledby="dataRetention-40-label">
          <label for="af-checkbox-dataRetention-40"><span id="dataRetention-40-label">I Agree</span></label></div></div>
      <oj-dialog><label for="summary">Work Summary</label><textarea id="summary" aria-required="true"></textarea></oj-dialog>
    </form>`;
    wireCxSelects();
    wirePills();
    resetLayoutCache();

    const report = await oracle.fill(context({ resume: null }));
    expect(report.fields.find((f) => /certifications/.test(f.label))).toEqual(expect.objectContaining({ status: 'review' }));
    expect(chosen('Would you be subject to any restrictions from a former employer upon joining Example Group?')).toBe('No');
    expect(document.querySelector<HTMLInputElement>('#month-US-DDF-militaryDischargeDate-18')!.value).toBe('');
    expect(report.fields.find((f) => /Discharge/.test(f.label))).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>('#af-checkbox-dataRetention-40')!.checked).toBe(false);
    expect(report.fields.find((f) => /Work Summary/.test(f.label))).toBeUndefined();
  });

  it('flags a dropdown that ignores the click instead of marking it filled', async () => {
    document.body.innerHTML = cxSelect('country-20', 'Country', ['Canada', 'United States'], { required: true, ignoreClicks: true });
    wireCxSelects();
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Oracle Recruiting' });
    expect(report.fields).toEqual([expect.objectContaining({ label: 'Country', status: 'review' })]);
  });
});

// --- Education and Experience entries ------------------------------------------
// Each entry is a tile; "Add …" opens an inline form and the form's save button
// turns it into a tile. The date pickers' aria-labelledby points at a stale
// label id, as on the real page, so their only label is "Month" / "Year".

const YEARS = ['2023', '2024', '2025', '2026', '2027', '2028'];

function dateRow(name: 'startDate' | 'endDate', n: number): string {
  return `<div class="input-row"><label><span id="labelText-${name}-${n}">${name === 'startDate' ? 'Start Date' : 'End Date'}</span></label>
    <div class="input-row__control-container">
      <span id="inputFieldLabel-month-${name}-${n}">Month</span>${cxSelectRaw(`month-${name}-${n}`, `labelText-${name}-${n - 18} inputFieldLabel-month-${name}-${n}`, MONTHS)}
      <span id="inputFieldLabel-year-${name}-${n}">Year</span>${cxSelectRaw(`year-${name}-${n}`, `labelText-${name}-${n - 18} inputFieldLabel-year-${name}-${n}`, YEARS)}
    </div></div>`;
}

const text = (name: string, label: string, n: number) =>
  `<div class="input-row"><label for="${name}-${n}"><span>${label}</span></label><div class="input-row__control-container"><input class="input-row__control" id="${name}-${n}" name="${name}"></div></div>`;

const FORMS = {
  Experience: (n: number) => `${text('employerName', 'Employer Name', n)}${text('jobTitle', 'Job Title', n + 1)}
    ${dateRow('startDate', n + 2)}${dateRow('endDate', n + 3)}
    <div class="input-row input-row--checkbox"><input type="checkbox" class="input-row__hidden-control" id="af-checkbox-currentJobFlag-${n}" aria-labelledby="currentJobFlag-${n}-label">
      <label for="af-checkbox-currentJobFlag-${n}"><span id="currentJobFlag-${n}-label">Current Job</span></label></div>
    ${cxSelect(`countryCode-${n}`, 'Employer Country', ['Canada', 'United States'])}
    ${text('employerCity', 'Employer City', n + 4)}
    ${pills('Internal', ['No', 'Yes'])}
    <div class="input-row"><label for="achievements-${n}">Achievements</label><textarea id="achievements-${n}" name="achievements"></textarea></div>`,
  Education: (n: number) => `${cxSelect(`contentItemId-${n}`, 'Degree', ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], { required: true })}
    ${cxSelect(`educationalEstablishmentId-${n}`, 'School', ['University of California - Davis', 'University of California - Los Angeles', 'Other'], { required: true })}
    ${dateRow('endDate', n + 1)}
    ${text('areaOfStudy', 'Area of Study', n + 2)}`,
};

type Saved = Record<string, string | boolean>;

/** One Education or Experience block that behaves like Oracle's. Returns what each save stored. */
function entryBlock(kind: 'Experience' | 'Education', tiles: { title: string; subtitle: string; invalid?: boolean }[] = []): Saved[] {
  const saved: Saved[] = [];
  const block = document.createElement('div');
  block.className = 'apply-flow-block apply-flow-block--tile-profile-items';
  block.innerHTML = `<h2 class="apply-flow-block__title"><span>${kind}</span></h2><div class="profile-item-list"></div>
    <div class="profile-add-item"><button type="button" class="button apply-flow-profile-item-tile__new-tile"><span class="button__label">Add ${kind}</span></button></div>`;
  document.querySelector('form')!.append(block);
  const list = block.querySelector('.profile-item-list')!;
  let n = 100;

  const tile = (title: string, subtitle: string, invalid = false) => {
    const article = document.createElement('article');
    article.className = `apply-flow-profile-item-tile${invalid ? ' apply-flow-profile-item-tile--invalid' : ''}`;
    article.innerHTML = `<div data-profile-item-tile="true" role="group" aria-label="${title} ${subtitle}">
      <div class="apply-flow-profile-item-tile__summary-title"><span>${title}</span></div>
      <div class="apply-flow-profile-item-tile__summary-subtitle">${subtitle}</div>
      <button class="apply-flow-profile-item-tile__edit-item-icon" title="Edit"></button></div>`;
    article.querySelector('button')!.addEventListener('click', () => openForm(article));
    list.append(article);
    return article;
  };

  const openForm = (article: HTMLElement) => {
    article.classList.add('apply-flow-profile-item-tile--active');
    n += 20;
    const content = document.createElement('div');
    content.innerHTML = `<div class="profile-item-content"><div class="profile-item-content--form">${FORMS[kind](n)}</div></div>
      <div class="profile-item-footer"><button type="button" class="button save-btn">Save</button></div>`;
    block.append(content);
    wireCxSelects();
    wirePills();
    content.querySelector('.save-btn')!.addEventListener('click', () => {
      const values: Saved = {};
      content.querySelectorAll<HTMLInputElement>('input, textarea').forEach((input) => {
        const key = (input.name || input.id).replace(/-\d+$/, '');
        values[key] = input.type === 'checkbox' ? input.checked : input.value;
      });
      values.internal = content.querySelector('[aria-checked="true"]')?.textContent?.trim() ?? '';
      saved.push(values);
      const title = String(kind === 'Experience' ? values.jobTitle : values.areaOfStudy);
      const subtitle = String(kind === 'Experience' ? values.employerName : values['educationalEstablishmentId']);
      article.remove();
      content.remove();
      tile(title, subtitle);
    });
  };

  for (const t of tiles) tile(t.title, t.subtitle, t.invalid);
  block.querySelector('.apply-flow-profile-item-tile__new-tile')!.addEventListener('click', () => openForm(tile('', '')));
  return saved;
}

function withSecondJob() {
  const ctx = context({ resume: null });
  ctx.profile.experience.push({ id: 'x2', company: 'Babbage Works', title: 'Research Assistant', type: 'Internship', location: 'Boston, MA', start: '2025-06', end: '2025-08', current: false, description: '' });
  return ctx;
}

describe('Oracle Recruiting entries', () => {
  beforeEach(() => {
    document.body.innerHTML = '<form></form>';
    resetLayoutCache();
  });

  it('adds one experience per job, each from its own job', async () => {
    const saved = entryBlock('Experience');
    await oracle.fill(withSecondJob());
    expect(saved).toEqual([
      expect.objectContaining({ employerName: 'Analytical Engines', jobTitle: 'Software Engineering Intern', 'month-startDate': 'September', 'year-startDate': '2026', 'month-endDate': '', 'year-endDate': '', 'af-checkbox-currentJobFlag': true, employerCity: 'Seattle' }),
      expect.objectContaining({ employerName: 'Babbage Works', jobTitle: 'Research Assistant', 'month-startDate': 'June', 'year-startDate': '2025', 'month-endDate': 'August', 'year-endDate': '2025', 'af-checkbox-currentJobFlag': false, employerCity: 'Boston' }),
    ]);
    // Your address is not the employer's, and "Internal" / "Achievements" are left to you.
    for (const entry of saved) {
      expect(entry).toEqual(expect.objectContaining({ countryCode: '', achievements: '', internal: '' }));
    }
    expect(document.querySelectorAll('article')).toHaveLength(2);
  });

  it('skips jobs already listed and fills a form you opened with the next job', async () => {
    const saved = entryBlock('Experience', [{ title: 'Software Engineering Intern', subtitle: 'Analytical Engines\n09/2026 - Present' }]);
    await oracle.fill(withSecondJob());
    expect(saved.map((s) => s.employerName)).toEqual(['Babbage Works']);

    // Opening another entry by hand while new fields are watched: it gets a job not listed yet, not your latest one.
    document.body.innerHTML = '<form></form>';
    const savedByHand = entryBlock('Experience', [{ title: 'Software Engineering Intern', subtitle: 'Analytical Engines\n09/2026 - Present' }]);
    document.querySelector<HTMLElement>('.apply-flow-profile-item-tile__new-tile')!.click();
    await oracle.fill({ ...withSecondJob(), incremental: true });
    expect(document.querySelector<HTMLInputElement>('input[name="employerName"]')!.value).toBe('Babbage Works');
    expect(savedByHand).toEqual([]); // saving a form you opened is left to you
  });

  it('completes an incomplete education entry instead of adding another', async () => {
    const saved = entryBlock('Education', [{ title: 'Unnamed Major', subtitle: 'University of California\n05/2028', invalid: true }]);
    await oracle.fill(context({ resume: null }));
    expect(saved).toEqual([expect.objectContaining({
      contentItemId: "Bachelor's Degree", educationalEstablishmentId: 'University of California - Los Angeles',
      'month-endDate': 'June', 'year-endDate': '2028', areaOfStudy: 'Computer Science',
    })]);
    expect(document.querySelectorAll('article')).toHaveLength(1);
  });

  it('adds your school when none is listed', async () => {
    const saved = entryBlock('Education');
    await oracle.fill(context({ resume: null }));
    expect(saved.map((s) => s.educationalEstablishmentId)).toEqual(['University of California - Los Angeles']);
  });
});
