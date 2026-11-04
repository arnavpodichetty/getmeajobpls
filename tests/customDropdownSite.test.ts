// A company careers site with its own form (no ATS): div dropdowns whose rows carry
// data-dropdown-selection and store the pick in a hidden input, a nested "How did
// you hear about us?" list, and a styled pronoun picker with a self-describe box.
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

/** What the site's own script does on click, since a fixture has no live JS. */
function wireSite(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const box = t.closest<HTMLElement>('.preview-box');
    if (box) {
      const menu = document.getElementById(box.getAttribute('aria-controls')!)!;
      menu.style.display = menu.style.display === 'none' ? '' : 'none';
      return;
    }
    const category = t.closest<HTMLElement>('.category-name-container');
    if (category) {
      (category.nextElementSibling as HTMLElement).style.display = '';
      return;
    }
    const row = t.closest<HTMLElement>('li[data-dropdown-selection]');
    if (row && row.dataset.dropdownSelection) {
      const root = row.closest('.standard-dropdown')!;
      root.querySelector<HTMLInputElement>('input[type=hidden]')!.value = row.dataset.dropdownSelection;
      root.querySelector('.preview-box .text')!.textContent = row.dataset.dropdownSelection;
      (row.closest('.dropdown-container') as HTMLElement).style.display = 'none';
      return;
    }
    const pronoun = t.closest('.pronouns-clickable')?.closest('.pronouns-option');
    if (pronoun) pronoun.classList.toggle('checked');
  });
  document.getElementById('has-secondary-major')!.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    document.querySelector<HTMLElement>('.secondary-major-container')!.hidden = !on;
    document.getElementById('secondary_major')!.toggleAttribute('disabled', !on);
  });
}

beforeEach(() => {
  fastTimings();
  loadFixture('custom-dropdown-site');
  wireSite();
});

const stored = (id: string) => document.querySelector<HTMLInputElement>(`input#${id}`)!.value;

describe('careers site with its own div dropdowns (custom-dropdown-site)', () => {
  it('finds each dropdown once, labelled with its question', () => {
    const fields = scanFields();
    const labels = fields.filter((f) => f.kind === 'combobox').map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining([
      'How did you hear about us?',
      'Select your college/university/school.',
      'What degree are you currently pursuing?',
      'What is your major/field of study?',
      'What year did you graduate from high school?',
    ]));
    // The search and "Please specify" boxes inside each dropdown aren't questions.
    expect(fields.filter((f) => /please specify|^search$/i.test(f.label))).toEqual([]);
    expect(fields.some((f) => f.el.id === 'pronouns')).toBe(false);
  });

  it('answers the yes/no questions', () => {
    const { profile } = context();
    const expected: [RegExp, string][] = [
      [/recruiting timelines/, 'No'],
      [/^Have you interviewed with/, 'No'],
      [/^Are you currently a student/, 'Yes'],
      [/^I don't have a school email/, 'No'],
      [/^I have a secondary major/, 'No'],
    ];
    const fields = scanFields();
    for (const [re, value] of expected) {
      const field = fields.find((f) => re.test(f.label))!;
      expect(field, String(re)).toBeTruthy();
      expect(resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, true).answer?.value, field.label).toBe(value);
    }
  });

  it('picks from every dropdown and clicks the pronoun instead of typing it', async () => {
    const report = await fillPage(context(), { ats: 'Generic' });
    expect(stored('college')).toBe('University of California - Los Angeles');
    expect(stored('education_level')).toBe('Undergraduate');
    expect(stored('major')).toBe('Computer Science');
    expect(stored('high_school_grad_year')).toBe('2024');
    // LinkedIn sits under the closed "Social media" category.
    expect(stored('source-dropdown')).toBe('LinkedIn');
    // The phone country already shows +1.
    expect(stored('phone_country_code')).toBe('');
    expect(document.querySelector('.pronouns-option.she-her-hers')!.classList.contains('checked')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#pronouns')!.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#interviewed-false')!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#recruiting_timelines-false')!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#university_email')!.value).toBe('ada@university.edu');
    expect(document.querySelector<HTMLInputElement>('#no-university-email')!.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#has-secondary-major')!.checked).toBe(false);
    // The optional comments box lists prompts; "How you heard about us" there isn't the referral question.
    expect(document.querySelector<HTMLTextAreaElement>('#comments')!.value).toBe('');
    const review = report.fields.filter((f) => f.status !== 'filled').map((f) => f.label);
    expect(review).not.toEqual(expect.arrayContaining(['What degree are you currently pursuing?', 'What is your major/field of study?']));
  }, 30_000);

  it('fills the secondary major once its checkbox is ticked', async () => {
    const ctx = context();
    ctx.profile.education[0].secondMajor = 'Statistics';
    await fillPage(ctx, { ats: 'Generic' });
    expect(document.querySelector<HTMLInputElement>('#has-secondary-major')!.checked).toBe(true);
    expect(stored('secondary_major')).toBe('Statistics');
    expect(stored('major')).toBe('Computer Science');
  }, 30_000);
});
