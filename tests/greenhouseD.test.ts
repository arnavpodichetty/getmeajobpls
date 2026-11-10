// Capture D: an internship form with a conditional graduation question, ranked
// interest dropdowns and a city search that lists several towns with the same name.
import { beforeEach, describe, expect, it } from 'vitest';
import { cityWithState, greenhouse } from '../src/adapters/greenhouse';
import { resolveAnswer } from '../src/lib/engine/answers';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => { fastTimings(); loadFixture('greenhouse-d'); });

/** Make each react-select open a menu of these options and show the one clicked. */
function simulateMenus(menus: Record<string, string[]>) {
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
          const control = input.closest('[class*="control"]')!;
          control.querySelector('.select__single-value')?.remove();
          const shown = document.createElement('div');
          shown.className = 'select__single-value';
          shown.textContent = id === 'country' ? text.split(' ').pop()! : text;
          control.append(shown);
          input.value = '';
          menu.remove();
        });
        menu.append(option);
      }
      document.body.append(menu);
    });
  }
}

const id = (label: RegExp) => scanFields().find((f) => label.test(f.label))!.el.id;

describe('captured Greenhouse application (capture D)', () => {
  it('reads each question as what it asks', () => {
    const ctx = context();
    const answer = (label: RegExp) => {
      const field = scanFields().find((f) => label.test(f.label))!;
      return resolveAnswer(field.label, field.hints, null, { profile: ctx.profile, skills: [] }, field.kind === 'combobox').answer;
    };
    expect(answer(/connect with us/)?.key).toBe('referralSource');
    // Not "Yes" to "are you enrolled": the question is the graduation date.
    expect(answer(/expected graduation date/)?.key).toBe('graduationDate');
    // Which work excites you most is your call.
    expect(answer(/first choice/)).toBeNull();
    expect(answer(/second choice/)).toBeNull();
    expect(answer(/authorized to work/)?.value).toBe('Yes');
    expect(answer(/worked for Acme before/)?.value).toBe('No');
    // Essays stay for you.
    expect(answer(/Why do you want to join/)).toBeNull();
    expect(answer(/describe a past project/)).toBeNull();
  });

  it('fills the dropdowns, picking the right town and leaving only the essays', async () => {
    const ctx = context();
    ctx.profile.answers.graduationDate = '2028-06-15';
    simulateMenus({
      country: ['Canada +1', 'United States +1'],
      'candidate-location': ['Los Angeles, California, United States', 'Los Angeles, Texas, United States', 'East Los Angeles, California, United States'],
      [id(/connect with us/)]: ['LinkedIn', 'Career Fair', 'Employee Referral', 'Other'],
      [id(/expected graduation date/)]: ['December 2027', 'June 2028', 'December 2028', 'Not currently enrolled'],
      [id(/first choice/)]: ['Product', 'Backend/Infrastructure', 'Security Engineering', "Open: I'm flexible and still exploring different types of work"],
      [id(/second choice/)]: ['Product', 'Backend/Infrastructure', 'Security Engineering', "Open: I'm flexible and still exploring different types of work"],
      [id(/authorized to work/)]: ['Yes', 'No'],
      [id(/worked for Acme before/)]: ['Yes', 'No'],
      question_19438728004: ['he/him/his', 'she/her/hers', 'they/them/theirs'],
      gender: ['Male', 'Female', 'Decline To Self Identify'],
      hispanic_ethnicity: ['Yes', 'No', 'Decline To Self Identify'],
      veteran_status: ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"],
    });
    const report = await greenhouse.fill(ctx);
    const fields = scanFields();
    const value = (label: RegExp) => currentValue(fields.find((f) => label.test(f.label))!);
    expect(value(/^Location/)).toBe('Los Angeles, California, United States');
    expect(value(/connect with us/)).toBe('LinkedIn');
    expect(value(/expected graduation date/)).toBe('June 2028');
    expect(value(/first choice/)).toBe('');
    expect(value(/second choice/)).toBe('');
    expect(value(/authorized to work/)).toBe('Yes');
    expect(value(/worked for Acme before/)).toBe('No');
    expect(report.fields.filter((f) => f.status === 'review').map((f) => f.label).sort()).toEqual([
      "Based on the engineering work you listed above that you're most excited to do at Acme, briefly (2-4 sentences) describe a past project or experience that best reflects your interest in those areas.",
      'Which type of engineering work are you most excited to do at Acme? Select your first choice.',
      'Which type of engineering work are you most excited to do at Acme? Select your second choice.',
      'Why do you want to join Acme?',
    ]);
  });
});

describe('city with its state', () => {
  it('spells the state out and abbreviated', () => {
    const { profile } = context();
    expect(cityWithState(profile)).toEqual(['Los Angeles, California', 'Los Angeles, CA']);
    profile.personal.state = 'district of columbia';
    profile.personal.city = 'Washington';
    expect(cityWithState(profile)).toEqual(['Washington, District of Columbia', 'Washington, DC']);
  });
});
