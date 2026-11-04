// A company careers site that renders its own form over Greenhouse: react-select
// dropdowns whose <label for> holds the question text instead of an id, and
// education dates split into number boxes.
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => {
  fastTimings();
  loadFixture('greenhouse-custom-react');
});

describe('Greenhouse-backed custom form (greenhouse-custom-react)', () => {
  it('labels every dropdown with its question, without stray marks', () => {
    const labels = scanFields().filter((f) => f.kind === 'combobox').map((f) => f.label);
    expect(labels).not.toContain('');
    expect(labels).toEqual(expect.arrayContaining([
      'Have you previously worked for Example Group or any of its subsidiaries in any capacity (e.g., full-time employee, contractor, intern, etc.)?',
      'How did you hear about this job posting?',
      'School',
      'Degree',
    ]));
    for (const f of scanFields()) expect(f.label).not.toMatch(/[⁠:]$|⁠/);
  });

  it('answers each screening question', () => {
    const { profile } = context();
    const expected: [RegExp, string][] = [
      [/^Have you previously worked for/, 'No'],
      [/^Do you now, or will you in the future, require sponsorship/, 'No'],
      [/^Do you have legal authorization to work/, 'Yes'],
      [/^Are you able to work an average of 40 hours/, 'Yes'],
      [/^Do you have demonstrated experience/, 'Yes'],
      [/^Will you be including a link on your resume/, 'Yes'],
    ];
    const fields = scanFields();
    for (const [re, value] of expected) {
      const field = fields.find((f) => re.test(f.label))!;
      expect(field, String(re)).toBeTruthy();
      expect(resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, true).answer?.value, field.label).toBe(value);
    }
  });

  it('fills the split education dates as numbers', async () => {
    await fillPage(context(), { ats: 'Greenhouse' });
    const value = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
    expect([value('educations[0].start_date.year'), value('educations[0].start_date.month')]).toEqual(['2024', '9']);
    expect([value('educations[0].end_date.year'), value('educations[0].end_date.month')]).toEqual(['2028', '6']);
  }, 30_000);
});
