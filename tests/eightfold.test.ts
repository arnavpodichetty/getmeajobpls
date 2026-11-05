// Eightfold application forms (careers/apply): phone-code lists with the code first,
// a "Not declared" decline option, consent boxes inside one section-wide fieldset,
// and a read-only calendar asking for today's date.
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { scanFields } from '../src/lib/engine/scan';
import { bestOption, CONFIDENT_OPTION_SCORE, DECLINE, optionScore } from '../src/lib/engine/text';
import { context } from './helpers/fixture';

const pick = (options: string[], wanted: string) => bestOption(options, (o) => o, wanted);

describe('phone country code options', () => {
  it('picks the United States over its territories with the code in front', () => {
    const options = ['🇨🇦 (+1) Canada', '🇺🇲 (+1) United States Minor Outlying Islands', '🇺🇸 (+1) United States of America'];
    const best = pick(options, 'United States');
    expect(best?.option).toBe('🇺🇸 (+1) United States of America');
    expect(best!.score).toBeGreaterThanOrEqual(CONFIDENT_OPTION_SCORE);
  });

  it('picks the United States over its territories with the code after', () => {
    const options = ['Canada (+1)', 'U. S. Virgin Islands (+1)', 'United States Minor Outlying Islands (+1)', 'United States of America (+1)'];
    const best = pick(options, 'United States');
    expect(best?.option).toBe('United States of America (+1)');
    expect(best!.score).toBeGreaterThanOrEqual(CONFIDENT_OPTION_SCORE);
  });

  it('still matches an exact country with a trailing code', () => {
    expect(optionScore('India (+91)', 'India')).toBe(1);
  });
});

describe('decline options', () => {
  it('reads "Not declared" as declining to answer', () => {
    expect(pick(['Female', 'Male', 'Non binary', 'Not declared'], DECLINE)?.option).toBe('Not declared');
    expect(optionScore('Not declared', 'Female')).toBe(0);
  });
});

describe("today's date on an acknowledgement", () => {
  const label = 'I understand that a false declaration may constitute a conflicts of interests which has consequences should I be hired. Please enter today\'s date on your acknowledgement.';
  const answer = (isChoice: boolean) => resolveAnswer(label, '', null, { profile: context().profile, skills: [] }, isChoice).answer;

  it('gives a date box today\'s date', () => {
    const a = answer(false);
    expect(a?.key).toBe('todayDate');
    expect(a?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves a Yes/No dropdown with the same text to the other rules', () => {
    expect(answer(true)?.key).not.toBe('todayDate');
  });
});

describe('scanning an Eightfold section', () => {
  function section(): HTMLElement {
    document.body.innerHTML = `
      <fieldset data-form-section-id="Application questions">
        <legend>Application questions</legend>
        <div>
          <legend id="toc_legend">Review our privacy statement.</legend>
          <div id="toc" aria-labelledby="toc_legend">
            <input type="checkbox" id="toc-0" aria-required="true" aria-label="Yes, I have read and consent to this Privacy Statement.">
            <label for="toc-0">Yes, I have read and consent to this Privacy Statement.</label>
          </div>
        </div>
        <div>
          <legend id="nda_legend">Review the nondisclosure agreement.</legend>
          <div id="nda" aria-labelledby="nda_legend">
            <input type="checkbox" id="nda-0" aria-required="true" aria-label="Yes, I acknowledge and agree to abide by the terms of this Nondisclosure Agreement.">
            <label for="nda-0">Yes, I acknowledge and agree to abide by the terms of this Nondisclosure Agreement.</label>
          </div>
        </div>
        <div>
          <legend id="race_legend">Race/Ethnicity</legend>
          <div role="group" aria-labelledby="race_legend">
            <input type="checkbox" id="r1"><label for="r1">Asian</label>
            <input type="checkbox" id="r2"><label for="r2">Do not wish to identify</label>
          </div>
        </div>
        <label id="d_label" for="d">Please enter today's date on your acknowledgement.</label>
        <input role="combobox" aria-haspopup="dialog" aria-label="Select date" id="d" readonly placeholder="Select date" aria-labelledby="d_label">
      </fieldset>`;
    return document.body;
  }

  it('keeps each consent box its own question', () => {
    const fields = scanFields(section());
    const boxes = fields.filter((f) => f.kind === 'checkbox');
    expect(boxes.map((f) => f.el.id)).toEqual(['toc-0', 'nda-0']);
    expect(boxes.every((f) => f.required)).toBe(true);
    const group = fields.find((f) => f.kind === 'checkboxes');
    expect(group?.members.map((m) => m.id)).toEqual(['r1', 'r2']);
  });

  it('treats the read-only calendar as a date field', () => {
    const date = scanFields(section()).find((f) => f.el.id === 'd');
    expect(date?.kind).toBe('date');
    expect(date?.label).toMatch(/today's date/);
  });
});

describe('DACA questions', () => {
  const label = 'Are you a current recipient of the Deferred Action for Childhood Arrivals (DACA)? (yes/no answer option) (This information is required to enable us to comply with U.S. federal export controls/sanctions screening requirements.)';
  const answer = (text: string, citizenship: string) => {
    const profile = context().profile;
    profile.answers.citizenship = citizenship;
    return resolveAnswer(text, '', null, { profile, skills: [] }, true).answer;
  };

  it('answers No for a US citizen', () => {
    expect(answer(label, 'United States')?.value).toBe('No');
  });

  it('leaves it for you when you are not a US citizen', () => {
    expect(answer(label, 'Canada')?.value ?? null).not.toBe('No');
    expect(answer(label, 'Canada')?.value ?? null).not.toBe('Yes');
  });

  it('does not answer No when the question also lists citizens', () => {
    expect(answer('Are you a U.S. citizen, permanent resident, refugee, asylee, or DACA recipient?', 'United States')?.value).not.toBe('No');
  });
});
