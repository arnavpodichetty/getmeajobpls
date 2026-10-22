import { beforeEach, describe, expect, it } from 'vitest';
import { greenhouse } from '../src/adapters/greenhouse';
import { resolveAnswer } from '../src/lib/engine/answers';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { optionScore } from '../src/lib/engine/text';
import { optionText } from '../src/lib/engine/labels';
import { context, fastTimings, loadFixture, testProfile } from './helpers/fixture';
import questionOptions from './fixtures/greenhouse-c-options.json';

beforeEach(() => { fastTimings(); loadFixture('greenhouse-c'); });

describe('captured Greenhouse application (capture C)', () => {
  it('resolves every required question, keeping high school, university, OPT and sponsorship distinct', () => {
    const profile = testProfile();
    for (const field of scanFields().filter((field) => field.required && field.kind !== 'file')) {
      const answer = resolveAnswer(field.label, field.hints, null, { profile, skills: ['Python'] }, !['text', 'textarea'].includes(field.kind)).answer;
      expect(answer, field.label).not.toBeNull();
    }
    const byId = (id: string) => {
      const field = scanFields().find((field) => field.el.id === id)!;
      return resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, field.kind === 'combobox').answer;
    };
    expect(byId('question_9793047101')?.value).toBe('2024');
    expect(byId('question_9793053101')?.key).toBe('needsSponsorship');
    expect(byId('question_9793054101')?.value).toBe('No');
    expect(byId('question_9793055101')?.value).toBe('N/A');
    expect(byId('question_9793061101')?.value).toBe('ada@university.edu');
  });

  it('fills the whole captured form with simulated dropdowns and correct range options', async () => {
    const menus: Record<string, string[]> = {
      ...questionOptions.choices,
      country: ['Canada', 'United States'],
      'candidate-location': ['Boston, Massachusetts, United States', 'Los Angeles, California, United States'],
      'school--0': ['Stanford University', 'University of California-Los Angeles'],
      'degree--0': ["Bachelor's Degree", "Master's Degree"],
      'discipline--0': ['Software Engineering', 'Computer Science'],
      'start-month--0': ['January', 'September'], 'end-month--0': ['January', 'June'],
    };
    for (const [id, options] of Object.entries(menus)) {
      const input = document.getElementById(id) as HTMLInputElement;
      input.addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'listbox');
        for (const text of options) {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = text;
          option.addEventListener('click', () => {
            const shown = document.createElement('div');
            shown.className = 'select__single-value';
            shown.textContent = text;
            (input.closest('[class*="control"]') ?? input.parentElement)!.append(shown);
            input.value = '';
            menu.remove();
          });
          menu.append(option);
        }
        document.body.append(menu);
      });
    }
    const ctx = context();
    ctx.profile.education[0].gpa = '3.84';
    ctx.profile.answers.graduationDate = '2028-06-15';
    ctx.skills = ['Python', 'SQL'];
    const report = await greenhouse.fill(ctx);
    expect(report.fields.filter((field) => field.status === 'review')).toEqual([]);
    const fields = scanFields();
    const value = (id: string) => currentValue(fields.find((field) => field.el.id === id)!);
    const expected = {
      question_9793047101: '2024', question_9793048101: 'Other',
      question_9793049101: "I don't have SAT score", question_9793050101: "I don't have ACT score",
      question_9793051101: 'January 2028 - July 2028', question_9793052101: '3.81 - 3.9',
      question_9793053101: 'No', question_9793054101: 'No', question_9793055101: 'N/A',
      question_9793056101: 'No', question_9793057101: 'No', question_9793058101: 'No',
      question_9793059101: 'N/A', question_9793061101: 'ada@university.edu',
      question_9793062101: 'I Agree', question_9793063101: 'I agree',
      'start-year--0': '2024', 'end-year--0': '2028',
    };
    for (const [id, expectedValue] of Object.entries(expected)) expect(value(id), id).toBe(expectedValue);
    const languages = fields.find((field) => field.kind === 'checkboxes')!;
    expect(languages.members.filter((member) => (member as HTMLInputElement).checked).map(optionText)).toEqual(['Python']);
  });

  it('keeps factual scores and dates separate instead of choosing similar-looking options', () => {
    expect(optionScore('3.7–3.89', '3.84')).toBe(1);
    expect(optionScore('3.9–4.0', '3.84')).toBe(0);
    expect(optionScore('2025', '2024')).toBe(0);
    expect(optionScore('2024 or earlier', '2024')).toBe(1);
    expect(optionScore('January - June 2028', '2028-06-15')).toBe(1);
    expect(optionScore('July - December 2028', '2028-06-15')).toBe(0);
    expect(optionScore('Before January 2028', '2028-06-15')).toBe(0);
    expect(optionScore('After June 2028', '2028-06-15')).toBe(0);
    expect(optionScore('Q2 2028', '2028-06-15')).toBe(1);
    expect(optionScore('June 2028', '2028-06-15')).toBe(1);
    expect(optionScore('Spring 2028', '2028-05-13')).toBe(1);
    expect(optionScore('Fall 2028', '2028-05-13')).toBe(0);
    expect(optionScore('Fall 2027', '2027-12-15')).toBe(1);
    // Winter is the March quarter at some schools and the December term at others.
    expect(optionScore('Winter 2028', '2028-03-20')).toBe(0);
    expect(optionScore('Winter 2027', '2027-12-15')).toBe(0);
    expect(optionScore('Summer 2028', '2028-05-13')).toBe(0);
    expect(optionScore('I did not take the SAT', 'Not taken')).toBe(1);
    expect(optionScore('1500-1600', 'Not taken')).toBe(0);
  });
});
