// Ashby puts help text under the question title, in an element whose class
// contains "question" ("ashby-application-form-question-description"). The
// title is the question; the help text must not replace it.
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { scanFields } from '../src/lib/engine/scan';
import { context } from './helpers/fixture';

const TITLE = 'Are you legally authorized to work in the United States?';
const DESCRIPTION = '<div class="ashby-application-form-question-description"><p>(If hired, verification will be required consistent with federal law)</p></div>';

const yesNo = `<div class="ashby-application-form-field-entry" data-field-path="q1">
  <label class="_required_f7cvd_91 ashby-application-form-question-title" for="q1">${TITLE}</label>${DESCRIPTION}
  <div class="ashby-application-form-input-yesno">
    <button aria-pressed="false" data-option="yes">Yes</button><button aria-pressed="false" data-option="no">No</button>
    <input type="checkbox" tabindex="-1" name="q1">
  </div>
</div>`;

const radios = `<div data-field-path="q2"><fieldset class="ashby-application-form-input-radio-group">
  <label class="_required_f7cvd_91 ashby-application-form-question-title" for="q2">${TITLE}</label>${DESCRIPTION}
  <div class="ashby-application-form-input-radio-group-option"><input type="radio" id="q2-0" name="q2"><label for="q2-0">Yes</label></div>
  <div class="ashby-application-form-input-radio-group-option"><input type="radio" id="q2-1" name="q2"><label for="q2-1">No</label></div>
</fieldset></div>`;

describe('Ashby questions with help text', () => {
  for (const [name, html] of [['yes/no buttons', yesNo], ['radio group', radios]]) {
    it(`reads the title, not the help text (${name})`, () => {
      document.body.innerHTML = html;
      resetLayoutCache();
      const [field] = scanFields(document);
      expect(field.label).toBe(TITLE);
      expect(field.required).toBe(true);
      const { profile } = context();
      expect(resolveAnswer(field.label, field.hints, null, { profile, skills: [] }, true).answer?.value).toBe('Yes');
    });
  }
});
