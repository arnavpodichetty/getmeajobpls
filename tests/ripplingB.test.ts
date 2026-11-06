// Capture B: Rippling questions whose text sits in a <p> above the field, Yes/No
// rows drawn as div role="radio", and an unlabeled phone country-code picker.
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { scanFields } from '../src/lib/engine/scan';
import { context, loadFixture } from './helpers/fixture';

beforeEach(() => loadFixture('rippling-b'));

const answer = (label: RegExp) => {
  const field = scanFields().find((f) => label.test(f.label))!;
  expect(field, String(label)).toBeTruthy();
  return resolveAnswer(field.label, field.hints, null, { profile: context().profile, skills: [] }, !['text', 'textarea'].includes(field.kind)).answer;
};

describe('Rippling application (capture B)', () => {
  it('labels Yes/No rows by their question, not their options', () => {
    expect(scanFields().some((f) => f.label === 'YesNo')).toBe(false);
    expect(answer(/^Do you require work authorization/)?.value).toBe('No');
    expect(answer(/^Would you require work authorization support/)?.value).toBe('No');
  });

  it('answers the school box with the school, not the graduation date', () => {
    expect(answer(/^What school or university/)?.value).toBe('University of California, Los Angeles');
  });

  it('finds the unlabeled phone country code', () => {
    const code = scanFields().find((f) => f.kind === 'combobox' && !f.label)!;
    expect(resolveAnswer(code.label, code.hints, null, { profile: context().profile, skills: [] }, true).answer?.key).toBe('phoneCountryCode');
  });

  it('asks for the graduation date, not whether you are a student', () => {
    expect(answer(/anticipated graduation date/)?.key).toBe('graduationDate');
  });
});
