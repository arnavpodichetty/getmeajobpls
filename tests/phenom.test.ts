// Phenom apply flows ("phff-field-*" boxes, e.g. a company's own careers site's hvhapply page).
// Phenom's resume parser pre-fills Work Experience and Education rows, often wrongly; the
// adapter rewrites each row from the profile. Dates are PrimeVue month/year pickers: a
// read-only box whose popup (by aria-controls) has month cells under a year header, or a
// decade of year cells. The stand-ins below mimic that markup and behaviour.
import { beforeEach, describe, expect, it } from 'vitest';
import { phenom } from '../src/adapters/phenom';
import { resolveAnswer } from '../src/lib/engine/answers';
import { showsMonthYear } from '../src/lib/engine/controls';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let calendars = 0;

function calendar(name: string, label: string, view: 'month' | 'year', value = '', disabled = false): string {
  const id = `pv_id_${++calendars}`;
  return `<div identifier="${name}" class="phff-form-group"><label for="phff-field-${name}-${id}" class="phff-form-field-label"><span>${label}</span></label>
    <span class="p-calendar p-component phff-calendar" data-pc-name="calendar" id="${id}">
      <input id="phff-field-${name}-${id}" name="${name}" type="text" role="combobox" class="p-inputtext phff-calendar-input" placeholder="${view === 'year' ? 'Select Year' : 'Select Date'}"
        aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}_panel" readonly data-view="${view}" value="${value}" ${disabled ? 'disabled' : ''}>
    </span></div>`;
}

/** Click opens the panel; prev/next page by year (months) or decade (years); a cell writes the box. */
function wireCalendars(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-pc-name="calendar"] input:not([data-wired])')) {
    input.dataset.wired = '1';
    const panelId = input.getAttribute('aria-controls')!;
    let year = Number(input.value.slice(-4)) || 2026;
    const render = () => {
      document.getElementById(panelId)?.remove();
      const panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'p-datepicker p-component';
      const close = () => panel.remove();
      const prev = document.createElement('button');
      prev.className = 'p-datepicker-prev';
      const next = document.createElement('button');
      next.className = 'p-datepicker-next';
      panel.append(prev);
      if (input.dataset.view === 'month') {
        const title = document.createElement('button');
        title.className = 'p-datepicker-year';
        title.textContent = String(year);
        panel.append(title, next);
        prev.onclick = () => { year--; render(); };
        next.onclick = () => { year++; render(); };
        MON.forEach((m, i) => {
          const cell = document.createElement('span');
          cell.className = 'p-monthpicker-month';
          cell.textContent = m;
          cell.onclick = () => { input.value = `${String(i + 1).padStart(2, '0')}/${year}`; close(); };
          panel.append(cell);
        });
      } else {
        const start = Math.floor(year / 10) * 10;
        panel.append(next);
        prev.onclick = () => { year -= 10; render(); };
        next.onclick = () => { year += 10; render(); };
        for (let y = start; y < start + 10; y++) {
          const cell = document.createElement('span');
          cell.className = 'p-yearpicker-year';
          cell.textContent = String(y);
          cell.onclick = () => { input.value = String(y); close(); };
          panel.append(cell);
        }
      }
      document.body.append(panel);
    };
    input.addEventListener('click', () => { if (!input.disabled) render(); });
  }
}

/** PrimeVue checkbox: state on the wrapper's data-p-highlight; the To date turns off while ticked. */
function wireCheckboxes(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('[identifier="currentlyWorkHere"] input')) {
    input.addEventListener('change', () => {
      input.closest('[data-pc-name="checkbox"]')!.setAttribute('data-p-highlight', String(input.checked));
      const end = input.closest('li')!.querySelector<HTMLInputElement>('[identifier="endDate"] input')!;
      end.disabled = input.checked;
    });
  }
}

const text = (name: string, label: string, value = '') =>
  `<div identifier="${name}" class="phff-form-group"><label class="phff-form-field-label"><span>${label}</span></label><input name="${name}" type="text" class="phff-input-text" value="${value}"></div>`;

function jobRow(j: { title: string; company: string; location: string; from: string; to: string; current: boolean; description: string }): string {
  return `<li><div role="group">${text('title', 'Job Title', j.title)}${text('companyName', 'Company Name', j.company)}${text('location', 'Location', j.location)}
    <fieldset>${calendar('startDate', 'From', 'month', j.from)}${calendar('endDate', 'To', 'month', j.to, j.current)}
      <div identifier="currentlyWorkHere" class="phff-form-group"><div class="phff-checkbox" data-pc-name="checkbox" data-p-highlight="${j.current}">
        <input type="checkbox" name="currentlyWorkHere" ${j.current ? 'checked' : ''}></div><label><span>I currently work here</span></label></div></fieldset>
    <div identifier="description" class="phff-form-group"><label><span>Role Description</span></label><textarea class="phff-textarea">${j.description}</textarea></div>
  </div><div><button type="button" class="remove-button">Remove Experience</button></div></li>`;
}

function page(): void {
  calendars = 0;
  document.body.innerHTML = `<form class="phff-form-field-group">
    <div id="phff-field-experienceData" identifier="experienceData"><label><span><b>Work Experience :</b></span></label><ol>
      ${jobRow({ title: 'Software Engineeri', company: 'Example Group', location: 'Remote', from: '10/2026', to: '', current: true, description: 'Built things.\nExample Group  May 2025 - Aug 2025' })}
      ${jobRow({ title: 'Research Assistant', company: 'Acme Lab', location: 'Los Angeles', from: '02/2025', to: '05/2025', current: false, description: 'Wrote questions.' })}
      ${jobRow({ title: 'Tutor', company: 'Acme Tutoring', location: '', from: '01/2024', to: '03/2024', current: false, description: '' })}
    </ol></div>
    <div id="phff-field-educationData" identifier="educationData"><label><span><b>Education</b></span></label><ol><li><div role="group">
      ${text('schoolName', 'School or University', 'University of California')}${text('degree', 'Degree', "Bachelor's")}${text('fieldOfStudy', 'Field of Study')}
      <fieldset>${calendar('startDate', 'Start Year(YYYY)', 'year')}${calendar('endDate', 'End Year(YYYY)', 'year', '2028')}</fieldset>
    </div></li></ol><div class="phff-add-button-container"><button type="button" class="add-button">+ Add Education</button></div></div>
    <div identifier="skillObject"><div identifier="skills" class="phff-form-group"><label><span>Skills (Comma separated)</span></label><textarea input-id="phff-field-skills-skillObject" class="phff-textarea">Cli, Modeling, Quality</textarea></div></div>
    <div identifier="website" class="phff-form-group"><label for="phff-field-website"><span>If you have a Demo Reel, please provide the URL below:</span></label><input id="phff-field-website" name="website" type="text"></div>
    <div identifier="portfolioPasswordQuestion" class="phff-form-group"><label for="phff-field-portfolioPasswordQuestion"><span>If your URL or Demo Reel requires a password, please enter it here:</span></label><input id="phff-field-portfolioPasswordQuestion" name="portfolioPasswordQuestion" type="text"></div>
  </form>`;
  wireCalendars();
  wireCheckboxes();
  resetLayoutCache();
}

function ctx() {
  const c = context({ resume: null });
  c.profile.experience = [
    { id: 'x1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: 'Seattle, WA', start: '2026-09', end: '', current: true, description: 'Built the engine.' },
    { id: 'x2', company: 'Example Group', title: 'Data Intern', type: 'Internship', location: 'Remote', start: '2025-05', end: '2025-08', current: false, description: 'Moved data.' },
  ];
  return c;
}

const row = (section: string, i: number) => document.querySelectorAll(`#${section} ol > li`)[i];
const val = (root: Element | undefined, sel: string) => root!.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!.value;

describe('Phenom apply flow', () => {
  it('is detected by its phff fields on a custom domain', () => {
    page();
    expect(phenom.detect(new URL('https://join.example-careers.com/global/en/hvhapply'), document)).toBe(true);
  });

  it('rewrites the parsed job rows from the profile, in order', async () => {
    page();
    const report = await phenom.fill(ctx());
    const first = row('phff-field-experienceData', 0);
    expect(val(first, '[identifier="title"] input')).toBe('Software Engineering Intern');
    expect(val(first, '[identifier="companyName"] input')).toBe('Analytical Engines');
    expect(val(first, '[identifier="location"] input')).toBe('Seattle, WA');
    expect(val(first, '[identifier="startDate"] input')).toBe('09/2026');
    expect(val(first, '[identifier="description"] textarea')).toBe('Built the engine.');

    const second = row('phff-field-experienceData', 1);
    expect(val(second, '[identifier="title"] input')).toBe('Data Intern');
    expect(val(second, '[identifier="companyName"] input')).toBe('Example Group');
    expect(val(second, '[identifier="startDate"] input')).toBe('05/2025');
    expect(val(second, '[identifier="endDate"] input')).toBe('08/2025');

    // The parser's third job isn't in the profile: flagged, not silently kept.
    expect(report.fields.some((f) => f.label === 'Extra job entry' && f.status === 'review')).toBe(true);
    expect(report.fields.filter((f) => /Analytical Engines|Example Group/.test(f.label)).every((f) => f.status === 'filled')).toBe(true);
  });

  it('unticks "I currently work here" for a past job and fills its To date', async () => {
    page();
    const c = ctx();
    c.profile.experience = [{ ...c.profile.experience[1] }];
    await phenom.fill(c);
    const first = row('phff-field-experienceData', 0);
    expect(first!.querySelector('[data-pc-name="checkbox"]')!.getAttribute('data-p-highlight')).toBe('false');
    expect(val(first, '[identifier="endDate"] input')).toBe('08/2025');
  });

  it('rewrites the school row and picks years from the year picker', async () => {
    page();
    await phenom.fill(ctx());
    const school = row('phff-field-educationData', 0);
    expect(val(school, '[identifier="schoolName"] input')).toBe('University of California, Los Angeles');
    expect(val(school, '[identifier="degree"] input')).toBe("Bachelor's Degree");
    expect(val(school, '[identifier="fieldOfStudy"] input')).toBe('Computer Science');
    expect(val(school, '[identifier="startDate"] input')).toBe('2024');
    expect(val(school, '[identifier="endDate"] input')).toBe('2028');
  });

  it('replaces the parsed skills with yours and leaves the portfolio password empty', async () => {
    page();
    await phenom.fill(ctx());
    expect(document.querySelector<HTMLTextAreaElement>('[identifier="skills"] textarea')!.value).toBe('Python, SQL, Java');
    expect(document.querySelector<HTMLInputElement>('#phff-field-portfolioPasswordQuestion')!.value).toBe('');
  });
});

describe('password questions', () => {
  it('never get a link, even when the box is named after the portfolio', () => {
    const r = resolveAnswer('If your URL or Demo Reel requires a password, please enter it here:', 'portfolioPasswordQuestion | portfolio password question', null, { profile: context().profile, skills: [] }, false);
    expect(r.answer).toBeNull();
  });
});

describe('month/year shown in a date box', () => {
  it('reads numeric and named months', () => {
    expect(showsMonthYear('10/2026', '2026-10')).toBe(true);
    expect(showsMonthYear('Oct 2026', '2026-10')).toBe(true);
    expect(showsMonthYear('01/2026', '2026-10')).toBe(false);
    expect(showsMonthYear('2024', '2024-09')).toBe(true);
    expect(showsMonthYear('2025', '2024')).toBe(false);
  });
});

// Voluntary Disclosure step: PrimeVue dropdowns. The box is a <span role="combobox"> showing
// "Please Select" (class p-placeholder) until a choice is made; clicking the wrapper opens a
// <ul id="…_list"> of role="option" items (linked by aria-controls) appended to the page.
function dropdown(name: string, label: string, options: string[], shown = ''): string {
  const id = `pv_dd_${name}`;
  return `<div identifier="${name}" class="phff-form-group phff-combobox-box"><label for="phff-field-${name}" class="phff-form-field-label"><span>${label}</span></label>
    <div class="p-dropdown p-component phff-combobox-field" data-pc-name="dropdown" id="${id}" data-options="${options.join('|')}">
      <span id="phff-field-${name}" class="p-dropdown-label p-inputtext${shown ? '' : ' p-placeholder'}" tabindex="0" role="combobox" aria-label="${label}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}_list">${shown || 'Please Select'}</span>
      <div class="p-dropdown-trigger"></div></div></div>`;
}

function wireDropdowns(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-pc-name="dropdown"]')) {
    const box = root.querySelector<HTMLElement>('[role="combobox"]')!;
    root.addEventListener('click', () => {
      if (document.getElementById(`${root.id}_list`)) return;
      const list = document.createElement('ul');
      list.id = `${root.id}_list`;
      list.setAttribute('role', 'listbox');
      for (const o of root.dataset.options!.split('|')) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = o;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          box.textContent = o;
          box.classList.remove('p-placeholder');
          box.setAttribute('aria-expanded', 'false');
          list.remove();
        });
        list.append(li);
      }
      box.setAttribute('aria-expanded', 'true');
      document.body.append(list);
    });
  }
}

describe('Phenom Voluntary Disclosure dropdowns', () => {
  function disclosures(): void {
    document.body.innerHTML = `<form class="phff-form-field-group">
      ${dropdown('ethnicity', 'Please select the race category that most accurately describes how you identify yourself.', ['Hispanic or Latino', 'Asian (Not Hispanic or Latino)', 'White (Not Hispanic or Latino)', 'I do not wish to answer'])}
      ${dropdown('areYouHispanicOrLatino', 'Are you Hispanic or Latino?', ['Yes', 'No', 'I do not wish to answer'])}
      ${dropdown('veteranStatus', 'Please select your Veteran status. To see if you classify as a Protected Veteran, please click on the link provided above.', ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'I do not wish to answer'])}
    </form>`;
    wireDropdowns();
    resetLayoutCache();
  }

  it('reads "Please Select" as unanswered', () => {
    disclosures();
    expect(scanFields().filter((f) => f.kind === 'combobox').map(currentValue)).toEqual(['', '', '']);
  });

  it('fills race, Hispanic or Latino and veteran status', async () => {
    disclosures();
    const c = ctx();
    Object.assign(c.profile.eeo, { raceEthnicity: 'East Asian', hispanicLatino: 'No', veteranStatus: 'I am not a protected veteran' });
    await phenom.fill(c);
    const shown = (name: string) => document.getElementById(`phff-field-${name}`)!.textContent;
    expect(shown('ethnicity')).toBe('Asian (Not Hispanic or Latino)');
    expect(shown('areYouHispanicOrLatino')).toBe('No');
    expect(shown('veteranStatus')).toBe('I am not a protected veteran');
  });
});
