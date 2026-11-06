// Capture A: an application on a large employer's own portal (select2 dropdowns, YYYY-MM-DD date boxes).
import { beforeEach, describe, expect, it } from 'vitest';
import { generic } from '../src/adapters/generic';
import { resolveAnswer } from '../src/lib/engine/answers';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => { fastTimings(); loadFixture('amazon-a'); });

const answer = (label: RegExp) => {
  const field = scanFields().find((f) => label.test(f.label))!;
  expect(field, String(label)).toBeTruthy();
  const { profile } = context();
  return resolveAnswer(field.label, field.hints, null, { profile, skills: profile.skills }, !['text', 'textarea', 'date'].includes(field.kind)).answer;
};

describe('employer portal with select2 dropdowns (capture A)', () => {
  it('answers the screening questions it can be sure of', () => {
    expect(answer(/^Do you currently have, or are in the process of obtaining, a Bachelor/)?.value).toBe('Yes');
    expect(answer(/^Currently has, or is in the process of obtaining/)?.value).toBe('Yes');
    expect(answer(/^What country\/region are you currently located/)?.value).toBe('United States');
    expect(answer(/located outside of the United States/)?.value).toBe('No');
  });

  it('says Yes to a named skill you have, flagged for a look', () => {
    const java = answer(/programming languages: Java, Python/)!;
    expect([java.value, java.confidence]).toEqual(['Yes', 'low']);
    expect(answer(/knowledge of database systems and SQL/)?.value).toBe('Yes');
    expect(answer(/written and verbal communication/)).toBeNull();
  });

  it('leaves questions the profile cannot answer', () => {
    expect(answer(/academic term system/)).toBeNull();
    expect(answer(/study abroad/)).toBeNull();
  });

  it('types full dates into YYYY-MM-DD boxes and flags a guessed day', async () => {
    const report = await generic.fill(context());
    const box = (label: RegExp) => scanFields().find((f) => label.test(f.label))!.el as HTMLInputElement;
    expect(box(/earliest possible start date/).value).toBe('2027-05-26');
    expect(box(/expected graduation day/).value).toBe('2028-06-01');
    expect(report.fields.find((f) => /expected graduation day/.test(f.label))?.reason).toMatch(/Day picked as the 1st/);
  });
});
