// SAP SuccessFactors picklists (rcmpaginatedselect): the options appear in a list
// the input owns once it opens, typing filters them, and some lists depend on an
// earlier pick (Major and Degree on Education, School Name on the row's Country).
import { beforeEach, describe, expect, it } from 'vitest';
import { countryFromLocation, successfactors } from '../src/adapters/successfactors';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(fastTimings);

const OPTIONS: Record<string, string[]> = {
  'Employer Type': ['Current Employer', 'Previous Employer'],
  'Position Type': ['Full Time', 'Part Time', 'Internship', 'Temporary'],
  'Company Country': ['Canada', 'United Kingdom', 'United States'],
  Country: ['Canada', 'United Kingdom', 'United States'],
  Education: ['High School or Equivalent', 'Some College', "Associate's Degree", "Bachelor's Degree", "Master's Degree"],
  'School Name': ['University of California, Los Angeles', 'University of Texas at Austin'],
  Major: ['Computer Science', 'Economics', 'Mathematics'],
  'Degree Achieved': ['Bachelor of Arts', 'Bachelor of Science', 'Master of Science'],
  Language: ['English', 'French', 'Spanish'],
  Proficiency: ['Native Language', 'Fluent', 'Intermediate', 'Beginner'],
  'What are your preferred pronouns?': ['He/His/Him', 'She/Her/Hers', 'They/Them/Theirs'],
  Ethnicity: ['Hispanic or Latino', 'Not Hispanic or Latino', 'I do not wish to answer'],
};

const rowOf = (el: Element) => el.closest('.rcmSectionComponent');
const picklist = (row: ParentNode | null, label: string) =>
  [...(row ?? document).querySelectorAll<HTMLInputElement>('input.rcmpaginatedselectinput')].find((i) => i.getAttribute('aria-label') === label);

function optionsFor(input: HTMLInputElement): string[] {
  const label = input.getAttribute('aria-label')!;
  const row = rowOf(input);
  if (label === 'Major' || label === 'Degree Achieved') return picklist(row, 'Education')?.value ? OPTIONS[label] : [];
  if (label === 'School Name') return picklist(row, 'Country')?.value ? OPTIONS[label] : [];
  return OPTIONS[label] ?? ['Yes', 'No'];
}

function livePicklists() {
  for (const radio of document.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')) {
    radio.addEventListener('click', () => {
      radio.closest('[role="radiogroup"]')!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', String(r === radio)));
    });
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input.rcmpaginatedselectinput')) {
    const listId = input.getAttribute('aria-owns')!;
    const render = () => {
      document.getElementById(listId)?.remove();
      const ul = document.createElement('ul');
      ul.id = listId;
      ul.setAttribute('role', 'listbox');
      const q = input.value.toLowerCase();
      for (const text of optionsFor(input).filter((o) => !q || o.toLowerCase().includes(q))) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = text;
        li.addEventListener('click', () => {
          input.value = text;
          input.title = text;
          ul.remove();
        });
        ul.append(li);
      }
      document.body.append(ul);
      resetLayoutCache();
    };
    input.addEventListener('click', render);
    input.addEventListener('input', render);
  }
}

describe('SAP SuccessFactors picklists', () => {
  it('fills job, school and language rows, Education before Major and Degree', async () => {
    loadFixture('successfactors-3');
    // The capture had six job rows; keep one per profile job.
    const jobRows = [...document.querySelectorAll('.rcmFormSection')].find((s) => /work experience/i.test(s.textContent!))!.querySelectorAll('.rcmSectionComponent');
    [...jobRows].slice(1).forEach((r) => r.parentElement!.remove());
    livePicklists();
    const ctx = context({ resume: null });
    Object.assign(ctx.profile.eeo, { raceEthnicity: 'East Asian', hispanicLatino: 'No' });
    const report = await successfactors.fill(ctx);
    const status = (label: string) => report.fields.find((f) => f.label === label)?.status;

    const job = rowOf(picklist(document, 'Employer Type')!)!;
    expect(picklist(job, 'Employer Type')!.value).toBe('Current Employer');
    expect(picklist(job, 'Position Type')!.value).toBe('Internship');
    expect(picklist(job, 'Company Country')!.value).toBe('United States');
    // A current job has no end date: left for you, outlined orange.
    expect(status('Job 1 (Analytical Engines): End Date')).toBe('review');

    const school = rowOf(picklist(document, 'Education')!)!;
    expect(picklist(school, 'Education')!.value).toBe("Bachelor's Degree");
    expect(picklist(school, 'Country')!.value).toBe('United States');
    expect(picklist(school, 'School Name')!.value).toBe('University of California, Los Angeles');
    expect(picklist(school, 'Major')!.value).toBe('Computer Science');
    // "Bachelor's Degree" doesn't say Arts or Science: left for you.
    expect(picklist(school, 'Degree Achieved')!.value).toBe('');
    expect(status('School 1: degree')).toBe('review');
    expect(status('School 1: major')).toBe('filled');
    expect(status('School 1: education level')).toBe('filled');

    expect(picklist(document, 'What are your preferred pronouns?')!.value).toBe('She/Her/Hers');
    expect(picklist(document, 'Ethnicity')!.value).toBe('Not Hispanic or Latino');
    const visa = picklist(document, 'Do you now, or in the foreseeable future, require Hooli to file for a visa petition on your behalf in order to allow you to work or continue to work?')!;
    expect(visa.value).toBe('No');
    const checked = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].map((r) => document.getElementById(r.getAttribute('aria-labelledby')!)!.textContent!.trim());
    expect(checked).toContain('Spring/Fall 2028\u200b');
    // Row fields get outlined like the rest of the page.
    expect(picklist(job, 'Employer Type')!.closest('[data-getmeajobpls]')).not.toBeNull();
  }, 30000);

  it('picks Bachelor of Arts for a B.A. once Education is set', async () => {
    loadFixture('successfactors-3');
    livePicklists();
    const ctx = context({ resume: null });
    ctx.profile.education[0].degree = 'Bachelor of Arts';
    await successfactors.fill(ctx);
    const school = rowOf(picklist(document, 'Education')!)!;
    expect(picklist(school, 'Education')!.value).toBe("Bachelor's Degree");
    expect(picklist(school, 'Degree Achieved')!.value).toBe('Bachelor of Arts');
  }, 30000);

  it('reads the country from a job location only when it is clear', () => {
    expect(countryFromLocation('Seattle, WA')?.[0]).toBe('United States');
    expect(countryFromLocation('Austin, Texas')?.[0]).toBe('United States');
    expect(countryFromLocation('London, UK')?.[0]).toBe('United Kingdom');
    expect(countryFromLocation('Toronto, Ontario, Canada')?.[0]).toBe('Canada');
    expect(countryFromLocation('London')).toBeNull();
    expect(countryFromLocation('Remote')).toBeNull();
  });
});
