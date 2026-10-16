import { beforeEach, describe, expect, it } from 'vitest';
import { queryAllDeep } from '../src/lib/engine/dom';
import { fillButtons } from '../src/lib/engine/controls';
import { resolveAnswer } from '../src/lib/engine/answers';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

// SmartRecruiters capture A: the radio questions sit under a "Preliminary questions" heading,
// and each question is slotted into its spl-radio-group host.
beforeEach(() => {
  fastTimings();
  loadFixture('smartrecruiters-a');
  for (const radio of queryAllDeep('spl-radio')) radio.addEventListener('click', () => {
    for (const sibling of [...radio.parentElement!.children]) if (sibling.matches('spl-radio')) sibling.setAttribute('aria-checked', String(sibling === radio));
  });
});

const radioGroups = () => scanFields().filter((field) => field.members.some((m) => m.matches('spl-radio')));

describe('SmartRecruiters spl-radio groups', () => {
  it('reads the slotted question, not the section heading', () => {
    expect(radioGroups().map((field) => field.label)).toEqual([
      'Are you currently an employee of a government entity?',
      'Do you have any experience or coursework related to transportation engineering, traffic operations, or Intelligent Transportation Systems (ITS)?',
      'Are you available for an internship starting in Spring/Summer 2027?',
      expect.stringMatching(/^This position is part of our exclusive, invitation-only hiring event/),
    ]);
  });

  it.each([
    ['Are you currently an employee of a government entity?', 'No'],
    ['Are you available for an internship starting in Spring/Summer 2027?', 'Yes'],
  ])('answers "%s" with %s', async (question, expected) => {
    const { profile } = context();
    profile.answers.governmentOfficial = 'No';
    profile.answers.earliestStartDate = '2028-05-26'; // after the term: still Yes
    const field = radioGroups().find((f) => f.label === question)!;
    const answer = resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, true).answer!;
    expect(answer.value).toBe(expected);
    fillButtons(field.members, String(answer.value));
    expect(field.members.find((m) => m.getAttribute('aria-checked') === 'true')?.getAttribute('label')).toBe(expected);
  });
});

describe('SmartRecruiters radios that only react to their inner control', () => {
  it('falls back to the inner radio and confirms the selection', () => {
    loadFixture('smartrecruiters-a');
    for (const radio of queryAllDeep('spl-radio')) {
      const inner = radio.shadowRoot?.querySelector('.c-spl-radio');
      inner?.addEventListener('click', () => {
        for (const sibling of [...radio.parentElement!.children]) if (sibling.matches('spl-radio')) sibling.setAttribute('aria-checked', String(sibling === radio));
      });
    }
    const field = radioGroups().find((f) => f.label === 'Are you currently an employee of a government entity?')!;
    expect(fillButtons(field.members, 'No').ok).toBe(true);
    expect(field.members.find((m) => m.getAttribute('aria-checked') === 'true')?.getAttribute('label')).toBe('No');
  });

  it('reports a radio the site would not select', () => {
    loadFixture('smartrecruiters-a');
    const field = radioGroups().find((f) => f.label === 'Are you currently an employee of a government entity?')!;
    expect(fillButtons(field.members, 'No').ok).toBe(false);
  });
});
