import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { optionScore } from '../src/lib/engine/text';
import { context, fastTimings } from './helpers/fixture';

const question = 'Please indicate your level of education during the Fall 2026 Semester:';
const labels = [question, 'Current year', 'Current academic year', 'Year of study', 'What year are you in college?', 'Class standing', 'Student classification'];

beforeEach(fastTimings);

describe('academic year', () => {
  it.each(labels)('answers %s from the editable preference', (label) => {
    const { profile } = context();
    profile.answers.academicYear = 'Junior';
    expect(resolveAnswer(label, '', null, { profile, skills: [] }, true).answer?.value).toBe('Junior');
    profile.answers.academicYear = 'Senior';
    expect(resolveAnswer(label, '', null, { profile, skills: [] }, true).answer?.value).toBe('Senior');
    profile.answers.academicYear = '';
    expect(resolveAnswer(label, '', null, { profile, skills: [] }, true).answer).toBeNull();
  });

  it.each(['Junior', '3rd year', 'Third-year undergraduate', 'Undergraduate Year 3', 'Junior (third year)'])('selects %s instead of other levels', async (option) => {
    document.body.innerHTML = `<label for="year">${question}</label><select id="year" required><option value="">Select...</option>${['1st year associates degree', '2nd year associates degree', 'Freshman', 'Sophomore', option, 'Senior', 'Graduate-level student', 'None of the above'].map((value) => `<option>${value}</option>`).join('')}</select>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.answers.academicYear = 'Junior';
    const report = await fillPage(ctx, { ats: 'Greenhouse' });
    expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe(option);
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });

  it.each(['Freshman', 'Sophomore', 'Senior', '3rd year graduate student', '3rd year associates degree', 'Junior in high school', 'None of the above'])('does not substitute %s for Junior', (option) => {
    expect(optionScore(option, 'Junior')).toBe(0);
  });

  it('keeps degree and graduation questions separate', () => {
    const { profile } = context();
    profile.answers.academicYear = 'Junior';
    const ask = (label: string) => resolveAnswer(label, '', null, { profile, skills: [] }, true);
    expect(ask('Highest education level').matchedKey).toBe('degree');
    expect(ask('Graduation year').answer?.value).toBe('2028');
    expect(ask('Current university').answer?.value).toBe(profile.education[0].school);
  });
});
