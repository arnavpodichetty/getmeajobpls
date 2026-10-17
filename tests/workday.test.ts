// Workday "My Experience" step, from a capture of a live application
// (tests/fixtures/workday-a.html). Dropdowns can't open in a static
// page, so this checks panel discovery and text/checkbox/date handling.
import { beforeEach, describe, expect, it } from 'vitest';
import { workday } from '../src/adapters/workday';
import { context, fastTimings, loadFixture } from './helpers/fixture';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';

beforeEach(() => fastTimings());

describe('language skill dropdowns', () => {
  it('handles the full Workday section with existing Expert values and empty Read, Speak and Write fields', async () => {
    const skills = ['Comprehension', 'Overall', 'Read', 'Speak', 'Write'];
    document.body.innerHTML = `
      <div role="group" aria-labelledby="Languages-section">
        <h4 id="Languages-section">Languages</h4>
        <div role="group" aria-labelledby="Languages-1-panel">
          <h5 id="Languages-1-panel">Languages 1</h5>
          <div data-automation-id="formField-language">
            <label for="language">Language*</label>
            <button id="language" aria-haspopup="listbox" aria-label="Language English Required">English</button><input />
          </div>
          <div data-automation-id="formField-native">
            <label for="native">I am fluent in this language.</label>
            <input id="native" type="checkbox" checked />
          </div>
          ${skills.map((skill, i) => `
            <div data-automation-id="formField-level${i}">
              <label for="level${i}">${skill}*</label>
              <button id="level${i}" aria-haspopup="listbox" aria-label="${skill} ${i < 2 ? 'Expert' : 'Select One'} Required">${i < 2 ? 'Expert' : 'Select One'}</button><input />
            </div>`).join('')}
          <button>Add Another</button>
        </div>
      </div>`;
    document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]').forEach((button) => {
      button.addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'listbox');
        const levels = button.id === 'language' ? ['English', 'French'] : ['Advanced', 'Beginner', 'Expert', 'Fluent', 'Intermediate'];
        for (const level of levels) {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = level;
          option.addEventListener('click', () => {
            button.textContent = level;
            menu.remove();
          });
          menu.append(option);
        }
        document.body.append(menu);
      });
    });
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.settings.overwriteExisting = true;
    const report = await fillPage(ctx, { ats: 'Workday' });
    expect(report.fields.map((field) => field.label)).toEqual(['Language', 'I am fluent in this language.', ...skills]);
    expect(report.filled).toBe(7);
    expect(report.needsReview).toBe(0);
    expect(document.getElementById('language')?.textContent).toBe('English');
    expect(document.querySelector<HTMLInputElement>('#native')?.checked).toBe(true);
    skills.forEach((skill, i) => expect(document.getElementById(`level${i}`)?.textContent, skill).toBe('Fluent'));
  });

  it.each(['select', 'combobox'])('fills every skill as Fluent in %s fields', async (kind) => {
    const skills = ['Comprehension', 'Overall', 'Read', 'Reading', 'Speak', 'Speaking', 'Write', 'Writing', 'Listen', 'Listening', 'Understand', 'Understanding', 'Verbal', 'Written', 'Oral Proficiency'];
    const levels = ['Select One', 'Advanced', 'Beginner', 'Expert', 'Fluent', 'Intermediate'];
    document.body.innerHTML = skills.map((skill, i) => `
      <div data-automation-id="formField-skill${i}">
        <label for="skill${i}">${skill}*</label>
        ${kind === 'select'
          ? `<select id="skill${i}" required>${levels.map((level, j) => `<option value="${j || ''}">${level}</option>`).join('')}</select>`
          : `<button id="skill${i}" aria-haspopup="listbox" aria-controls="levels${i}">Select One</button>`}
      </div>`).join('');
    if (kind === 'combobox') {
      document.querySelectorAll('button').forEach((button, i) => {
        button.addEventListener('click', () => {
          const menu = document.createElement('div');
          menu.id = `levels${i}`;
          menu.setAttribute('role', 'listbox');
          levels.slice(1).forEach((level) => {
            const option = document.createElement('div');
            option.setAttribute('role', 'option');
            option.textContent = level;
            option.addEventListener('click', () => {
              button.textContent = level;
              menu.remove();
            });
            menu.append(option);
          });
          document.body.append(menu);
        });
      });
    }
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Workday' });
    expect(report.filled).toBe(skills.length);
    expect(report.needsReview).toBe(0);
    for (let i = 0; i < skills.length; i++) {
      const field = document.getElementById(`skill${i}`)!;
      const selected = field instanceof HTMLSelectElement ? field.selectedOptions[0].text : field.textContent;
      expect(selected, skills[i]).toBe('Fluent');
    }
  });
});

describe('Workday My Experience', () => {
  it('fills one panel per job with its own title, company and current flag', async () => {
    loadFixture('workday-a');
    const ctx = context();
    ctx.profile.experience = [
      { id: '1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: '', start: '2026-09', end: '', current: true, description: '' },
      { id: '2', company: 'Difference Engine Co', title: 'Research Intern', type: 'Internship', location: '', start: '2025-01', end: '2025-04', current: false, description: '' },
    ];
    const r = await workday.fill(ctx);
    const titles = [...document.querySelectorAll<HTMLInputElement>('input[name="jobTitle"]')].map((i) => i.value);
    const companies = [...document.querySelectorAll<HTMLInputElement>('input[name="companyName"]')].map((i) => i.value);
    expect(titles.slice(0, 2)).toEqual(['Software Engineering Intern', 'Research Intern']);
    expect(companies.slice(0, 2)).toEqual(['Analytical Engines', 'Difference Engine Co']);
    expect(r.fields.some((f) => /Job 2 \(Difference Engine Co\): from/.test(f.label))).toBe(true);
  });

  it('fills the school name and recognizes the date and upload fields', async () => {
    loadFixture('workday-a');
    const r = await workday.fill(context());
    expect((document.querySelector('input[name="schoolName"]') as HTMLInputElement).value).toBe('University of California, Los Angeles');
    expect(r.fields.some((f) => /^School 1: to$/.test(f.label))).toBe(true);
    expect(r.fields.find((f) => /^Resume/.test(f.label))).toBeTruthy();
  });
});

describe('Workday Application Questions', () => {
  it('reads each question from the legend, not the dropdown value, and ignores helper boxes and the header', async () => {
    const { scanFields } = await import('../src/lib/engine/scan');
    loadFixture('workday-b-2');
    const fields = scanFields();
    const labels = fields.map((f) => f.label);
    expect(labels).toContain('Are you 18 years of age or older?');
    expect(labels).toContain('Have you applied to ACME within the past 6 months?');
    expect(labels.filter((l) => /18 years/.test(l))).toHaveLength(1); // no duplicate helper input
    expect(labels).not.toContain('Yes');
    expect(labels).not.toContain('Careers');
    expect(fields.find((f) => /18 years/.test(f.label))?.kind).toBe('combobox');
  });

  it('answers every question on the page', async () => {
    const { scanFields } = await import('../src/lib/engine/scan');
    const { resolveAnswer } = await import('../src/lib/engine/answers');
    loadFixture('workday-b-2');
    const c = { profile: context().profile, skills: [] };
    for (const f of scanFields().filter((x) => x.kind === 'combobox')) {
      expect(resolveAnswer(f.label, f.hints, null, c, true).answer, f.label).not.toBeNull();
    }
  });
});

describe('Workday My Experience (capture B)', () => {
  it('skips date spin-buttons, the skills box and website URLs in the generic pass', async () => {
    const { scanFields } = await import('../src/lib/engine/scan');
    loadFixture('workday-b-1');
    const labels = scanFields().map((f) => f.label);
    expect(labels).not.toContain('Month');
    expect(labels).not.toContain('Careers');
    expect(labels.filter((l) => l === 'Language')).toHaveLength(1);
  });
});

describe('Workday Websites', () => {
  const urls = () => [...document.querySelectorAll<HTMLInputElement>('[aria-labelledby^="Websites-"][aria-labelledby$="-panel"] input[name="url"]')].map((i) => i.value);

  it('lists portfolio and GitHub when the form has its own LinkedIn box', async () => {
    loadFixture('workday-b-1');
    await workday.fill(context());
    const { portfolio, github, linkedin } = context().profile.links;
    expect(urls()).toEqual([portfolio, github]);
    expect(document.querySelector<HTMLInputElement>('input[name="linkedInAccount"]')!.value).toBe(linkedin);
  });

  it('adds LinkedIn to Websites when there is no LinkedIn box', async () => {
    loadFixture('workday-b-1');
    document.querySelector('[data-automation-id="formField-linkedInAccount"]')!.remove();
    await workday.fill(context());
    const { portfolio, linkedin } = context().profile.links;
    // The capture has two panels and can't add a third (GitHub); the live form's Add button does.
    expect(urls()).toEqual([portfolio, linkedin]);
  });
});

describe('highest completed education', () => {
  const label = 'What is your highest level of completed education?*';
  const options = ['Less than High School', 'High School Diploma/GED', 'Some College', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'];

  it('picks high school while the degree is still in progress', async () => {
    document.body.innerHTML = `<label for="q">${label}</label><select id="q" required><option value="">Select One</option>${options.map((o) => `<option>${o}</option>`).join('')}</select>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.education[0].end = '2099-05';
    await fillPage(ctx, { ats: 'Workday' });
    expect(document.querySelector('select')!.value).toBe('High School Diploma/GED');
  });

  it('picks the degree once it is finished', async () => {
    document.body.innerHTML = `<label for="q">${label}</label><select id="q" required><option value="">Select One</option>${options.map((o) => `<option>${o}</option>`).join('')}</select>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.education[0].degree = 'Bachelor of Arts';
    ctx.profile.education[0].end = '2020-05';
    await fillPage(ctx, { ats: 'Workday' });
    expect(document.querySelector('select')!.value).toBe("Bachelor's Degree");
  });
});

describe('resume upload', () => {
  it('attaches the resume once even after Workday re-renders the upload input', async () => {
    const uploadInput = () => '<div id="upload"><label for="resume">Resume/CV</label><input id="resume" type="file" data-automation-id="file-upload-input-ref" /></div>';
    document.body.innerHTML = uploadInput();
    let attaches = 0;
    const listen = () => document.querySelector('#resume')!.addEventListener('change', () => attaches++);
    listen();
    const ctx = context();
    await fillPage(ctx, { ats: 'Workday' });
    expect(attaches).toBe(1);

    // Workday swaps in a fresh, empty input after taking the file.
    document.body.innerHTML = uploadInput();
    listen();
    await fillPage({ ...ctx, incremental: true }, { ats: 'Workday', incremental: true });
    expect(attaches).toBe(1);
  });
});

describe('resume removed by hand', () => {
  it('is not re-attached when watching for new fields', async () => {
    const uploadInput = () => '<label for="resume">Resume/CV</label><input id="resume" type="file" />';
    document.body.innerHTML = uploadInput();
    const ctx = context();
    await fillPage(ctx, { ats: 'Greenhouse' });
    // You remove the file: the site renders a fresh, empty upload box.
    document.body.innerHTML = uploadInput();
    let attaches = 0;
    document.querySelector('#resume')!.addEventListener('change', () => attaches++);
    await fillPage({ ...ctx, incremental: true }, { ats: 'Greenhouse', incremental: true });
    expect(attaches).toBe(0);
  });
});

describe('resume on a later page', () => {
  it('is attached again on a different page of the same tab', async () => {
    const uploadInput = () => '<label for="resume">Resume/CV</label><input id="resume" type="file" />';
    document.body.innerHTML = uploadInput();
    const ctx = context();
    await fillPage(ctx, { ats: 'Workday' }); // e.g. "Autofill with Resume"
    history.pushState({}, '', '/apply/applyManually');
    document.body.innerHTML = uploadInput();
    let attaches = 0;
    document.querySelector('#resume')!.addEventListener('change', () => attaches++);
    await fillPage({ ...ctx, incremental: true }, { ats: 'Workday', incremental: true });
    expect(attaches).toBe(1);
    history.pushState({}, '', '/');
  });
});
