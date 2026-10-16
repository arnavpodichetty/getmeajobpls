import { beforeEach, describe, expect, it } from 'vitest';
import { smartrecruiters } from '../src/adapters/smartrecruiters';
import { scanFields, currentValue } from '../src/lib/engine/scan';
import { resolveAnswer } from '../src/lib/engine/answers';
import { queryAllDeep, queryDeep } from '../src/lib/engine/dom';
import { optionText } from '../src/lib/engine/labels';
import { fillCombobox } from '../src/lib/engine/controls';
import { context, fastTimings, loadFixture } from './helpers/fixture';

interface Question { id: string; label: string; fields: { values: { label: string }[] }[]; }
let questions: Question[];

beforeEach(() => {
  fastTimings();
  loadFixture('smartrecruiters-screening');
  questions = JSON.parse(document.querySelector('sr-screening-questions-form')!.getAttribute('definition')!).questions;
});
const fieldFor = (id: string) => scanFields().find((field) => field.el.id === `question_${id}`)!;

// Recreate the live component's opening/selection behavior. Captures have no
// JavaScript and only include dropdown options that happened to be open.
function hydrateDropdowns(commit = true) {
  for (const host of queryAllDeep('spl-autocomplete, spl-multiselect-autocomplete')) {
    queryAllDeep('spl-select-option', host).forEach((option) => option.remove());
    const input = queryDeep<HTMLInputElement>('input[role="combobox"]', host)!;
    if (!input) continue; // inactive conditional components have no control
    const q = questions.find((q) => `question_${q.id}` === host.id)!;
    input.addEventListener('click', () => {
      if (queryDeep('spl-select-option', host)) return;
      for (const value of q.fields[0].values) {
        const option = document.createElement('spl-select-option');
        option.textContent = value.label;
        const shadow = option.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<div role="option"><slot></slot></div>';
        shadow.querySelector('div')!.addEventListener('click', () => {
          if (commit && host.matches('spl-multiselect-autocomplete')) {
            const tag = document.createElement('spl-tag');
            tag.setAttribute('label', value.label);
            host.append(tag);
            input.value = '';
          } else if (commit) input.value = value.label;
          queryAllDeep('spl-select-option', host).forEach((node) => node.remove());
        });
        host.append(option);
      }
    });
  }
  for (const radio of queryAllDeep('spl-radio')) radio.addEventListener('click', () => {
    for (const sibling of [...radio.parentElement!.children]) if (sibling.matches('spl-radio')) sibling.setAttribute('aria-checked', String(sibling === radio));
  });
}

describe('SmartRecruiters screening', () => {
  it('reads every visible question, including long and slotted dropdown labels', () => {
    const fields = scanFields();
    expect(fields.length).toBe(27);
    expect(fields.every((field) => !!field.label)).toBe(true);
    const { profile } = context();
    expect(resolveAnswer('Are you able to attend a virtual interview?', '', null, { profile, skills: [] }, true).matchedKey).not.toBe('eventAttendance');
    const expected = [
      ['a69e416b-93e6-461e-af6f-103648baf297', 'degree'],
      ['8bec4f0a-4e4c-4864-8cd5-2c2e82d3d5f6', 'gpa'],
      ['48b8f839-0222-469c-9063-0901368d7ed1', 'referralSource'],
      ['1a8b0819-36bb-4767-a72d-921853ad2654', 'veteranStatus'],
      ['d3eab1ed-bbf7-495b-83d7-0a296e74aa59', 'raceEthnicity'],
    ];
    for (const [id, key] of expected) {
      const field = fieldFor(id);
      expect(resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, true).matchedKey).toBe(key);
    }
    expect(resolveAnswer(fieldFor('f94e5ea7-8e50-4d7e-93e4-f2b2e52f96a4').label, '', null, { profile, skills: [] }, true).answer).toBeNull();
    for (const id of ['be1eeca3-c545-4cf5-9d8f-432685e56ea7', '2596d662-3d3a-49bf-b89f-7e7d26b9292a']) {
      expect(resolveAnswer(fieldFor(id).label, '', null, { profile, skills: [] }, true).matchedKey).toBe('selfAssessment');
    }
  });

  it('fills supported fields through the captured web components', async () => {
    hydrateDropdowns();
    const ctx = context({ resume: null });
    ctx.profile.answers.closestStartDateChoice = true;
    ctx.profile.answers.eventAttendance = 'No';
    ctx.profile.education[0].coursework = 'Operating Systems; Compilers; Computer Science';
    ctx.profile.eeo.raceEthnicity = 'Asian';
    ctx.profile.eeo.gender = 'Male';
    ctx.profile.eeo.veteranStatus = 'I am not a protected veteran';
    fieldFor('8bec4f0a-4e4c-4864-8cd5-2c2e82d3d5f6').el.setAttribute('value', '2028-06');
    fieldFor('a69e416b-93e6-461e-af6f-103648baf297').el.setAttribute('value', '2028-06');
    const report = await smartrecruiters.fill(ctx);
    const expected = [
      ['1ac79ca6-b504-4ab4-a478-38781c7e7f09', 'University of California, Los Angeles'],
      ['ecb566dd-1edb-4f82-8e24-119e9805ce42', ''],
      ['a69e416b-93e6-461e-af6f-103648baf297', "Bachelor's Degree"],
      ['8bec4f0a-4e4c-4864-8cd5-2c2e82d3d5f6', '3.9'],
      ['0a1dfa43-3c8e-4e16-a754-b72371f9652e', 'I am interested in Western locations'],
      ['2ab8befb-248e-4b08-a971-e4e4a40e5048', 'California'],
      ['922bbdd2-7e99-4947-b900-89ec8156dc25', 'No'],
      ['98bb1fa5-fd4f-49f0-91b6-c4bf5a14bb1b', 'N/A'],
      ['3ce753fc-32a7-43ea-a722-21610138da00', 'Yes'],
      ['dfcee9d7-fe97-4a71-a6a4-17d2b67a8de0', 'I do not require sponsorship and I will not require sponsorship in the future'],
      ['48b8f839-0222-469c-9063-0901368d7ed1', 'LinkedIn'],
      ['c95a84e5-eb0c-446b-9793-14e4c44377f1', 'No'],
      ['c4de208f-312f-4580-856d-5d4fa4619fcd', 'No'],
      ['1a8b0819-36bb-4767-a72d-921853ad2654', 'No, I am not a protected veteran'],
      ['d3eab1ed-bbf7-495b-83d7-0a296e74aa59', 'Asian (Not Hispanic or Latino)'],
      ['68cd3d2f-d4ea-4c35-a2fb-a84fc064ac37', 'Male'],
    ];
    for (const [id, value] of expected) expect(currentValue(fieldFor(id)), fieldFor(id).label).toBe(value);
    const internship = scanFields().find((field) => field.label.includes('Spring/Summer 2027'))!;
    expect(currentValue(internship)).toBe('Yes');
    expect(currentValue(fieldFor('426752f0-5bd3-499f-8357-dfc0b2d058cd'))).toBe('Within the next 6 months from my application date');
    expect(currentValue(fieldFor('71839f45-18de-4fb8-8ff0-f2b36e930350'))).toBe('Operating Systems; Compilers; Computer Science');
    expect(currentValue(scanFields().find((field) => field.label.includes('invitation-only'))!)).toBe('No');
    expect(report.fields.find((field) => field.label.includes('Microsoft Excel'))?.status).toBe('review');
  });

  it('reads slotted option text and reports a selection the component rejects', async () => {
    hydrateDropdowns(false);
    const field = fieldFor('1ac79ca6-b504-4ab4-a478-38781c7e7f09');
    field.el.click();
    const option = queryDeep('[role="option"]', queryAllDeep('spl-autocomplete, spl-multiselect-autocomplete').find((host) => host.id === field.el.id)!);
    expect(optionText(option!)).toBe('Arizona State University');
    expect((await fillCombobox(field.el, 'University of California, Los Angeles')).ok).toBe(false);
  });

  it('keeps business lines and experience levels manual, with editable overrides', async () => {
    hydrateDropdowns();
    const ctx = context({ resume: null });
    const ids = ['02b9474c-87ee-4611-85a6-f961261b4cff', 'f94e5ea7-8e50-4d7e-93e4-f2b2e52f96a4'];
    ctx.profile.savedAnswers = ids.map((id, i) => ({ id, question: fieldFor(id).label, answer: i === 0 ? 'Water' : 'Expert' }));
    await smartrecruiters.fill(ctx);
    for (const id of ids) {
      expect(currentValue(fieldFor(id))).toBe('');
    }
    ctx.settings.reviewBusinessLines = false;
    ctx.settings.reviewExperienceLevels = false;
    await smartrecruiters.fill(ctx);
    expect(currentValue(fieldFor(ids[0]))).toBe('Water');
    expect(currentValue(fieldFor(ids[1]))).toMatch(/^Expert/);
  });
});
