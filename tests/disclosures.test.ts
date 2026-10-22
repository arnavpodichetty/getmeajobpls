import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { optionScore } from '../src/lib/engine/text';
import { context, fastTimings, testProfile } from './helpers/fixture';

const debarment = 'Are you now or have you ever been debarred or suspended from participation in government contracting, or have you been notified that such action is pending?';
const consulting = 'Have you ever been retained by the U.S. Government (as a consultant, support contractor or otherwise) to provide assistance on any Particular Matter that relates to the Company?';
const consent = 'I consent to receive telephone calls and/or text messages from Globex IT to any and all phone numbers I have provided to Globex IT at any time, including in the future, for the purpose of any matter regarding my employment and/or securing employment. I understand that these calls and texts may be sent via an automatic telephone dialing system and/or include prerecorded messages. I also understand that I am not required to give this consent in order to receive such information relevant to my employment or securing employment with Globex IT.';

describe('application disclosure preferences', () => {
  const ask = (label: string) => resolveAnswer(label, '', null, { profile: testProfile(), skills: [] }, true).answer?.value;

  it.each([
    [debarment, 'No'],
    [consulting, 'No'],
    [consent, 'No'],
    ['Are you a resident of the state of Maryland?', 'No'],
    ['Are you a resident of Maryland?', 'No'],
    ['Do you currently reside in MD?', 'No'],
    ['Are you a resident of the state of California?', 'Yes'],
    ['Are you a resident of CA?', 'Yes'],
    ['Are you currently residing in California?', 'Yes'],
    ['Do you live in New York?', 'No'],
    ['I agree to receive SMS messages', 'No'],
    ['Do you consent to texting?', 'No'],
    ['May we have permission to send text messages?', 'No'],
    ['SMS consent', 'No'],
    ['I consent to receive phone calls', 'No'],
    ['Are you willing to travel?', '25-50%'],
    ['What percentage of time are you willing to travel?', '25-50%'],
    ['How much travel are you available for?', '25-50%'],
    ['Travel percentage', '25-50%'],
  ])('%s → %s', (label, answer) => expect(ask(label)).toBe(answer));

  it('keeps phone, state, work authorization and general agreements separate', () => {
    expect(ask('Phone Number')).toBe('4155550100');
    expect(ask('State / Province')).toBe('CA');
    expect(ask('Are you legally authorized to work in the United States?')).toBe('Yes');
    expect(ask('I agree to the terms and conditions')).toBe('Yes');
    expect(ask('Have you used text messages to communicate with customers?')).toBeUndefined();
  });

  it('matches equivalent travel ranges without selecting neighboring ranges', () => {
    for (const option of ['25-50%', '25–50%', '25% - 50%', '25 to 50%', 'Travel 25%–50% of the time']) {
      expect(optionScore(option, '25-50%'), option).toBe(1);
    }
    for (const option of ['None', 'Less than 10%', '10-25%', '50-75%', 'Yes', '50%']) {
      expect(optionScore(option, '25-50%'), option).toBe(0);
    }
  });

  it('selects 25-50% for the travel dropdown', async () => {
    document.body.innerHTML = `<label for="travel">Are you willing to travel?*</label>
      <select id="travel" required>
        <option value="">Select One</option><option>None</option><option>Less than 10%</option>
        <option>10-25%</option><option>25-50%</option><option>50-75%</option>
      </select>`;
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Workday' });
    expect(document.querySelector<HTMLSelectElement>('#travel')?.value).toBe('25-50%');
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });

  it('fills all screenshot dropdowns and declines a checked texting checkbox', async () => {
    const questions = [debarment, consulting, 'Are you a resident of the state of Maryland?', consent, 'Are you a resident of California?'];
    document.body.innerHTML = questions.map((label, i) => `
      <label for="q${i}">${label}*</label>
      <select id="q${i}" required>
        <option value="">Select One</option><option value="yes">Yes</option><option value="no">No</option>
      </select>`).join('') + '<label for="sms">I consent to receive text messages</label><input id="sms" type="checkbox" checked />';
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.settings.overwriteExisting = true;
    const report = await fillPage(ctx, { ats: 'Workday' });
    expect(report.filled).toBe(6);
    expect(report.needsReview).toBe(0);
    expect([...document.querySelectorAll('select')].map((select) => select.value)).toEqual(['no', 'no', 'no', 'no', 'yes']);
    expect(document.querySelector<HTMLInputElement>('#sms')?.checked).toBe(false);
  });

  it('fills Workday dropdowns with long legends and validation errors', async () => {
    fastTimings();
    const questions = [debarment, consulting, 'Are you a resident of the state of Maryland?', consent];
    document.body.innerHTML = questions.map((question, i) => `
      <fieldset data-automation-id="formField-question${i}">
        <legend>${question}*</legend>
        <button id="question${i}" aria-haspopup="listbox" aria-invalid="true" aria-label=" Select One Required">Select One</button><input />
        <div role="alert">Error: The field ${question} is required and must have a value.</div>
      </fieldset>`).join('');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'listbox');
        for (const value of ['Yes', 'No']) {
          const row = document.createElement('div');
          row.setAttribute('role', 'option');
          row.setAttribute('data-automation-id', 'menuItem');
          const option = document.createElement('div');
          option.setAttribute('data-automation-id', 'promptOption');
          option.textContent = value;
          option.addEventListener('click', () => {
            button.textContent = value;
            button.setAttribute('aria-invalid', 'false');
            button.closest('fieldset')?.querySelector('[role="alert"]')?.remove();
            menu.remove();
          });
          row.append(option);
          menu.append(row);
        }
        document.body.append(menu);
      });
    });
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Workday' });
    expect(buttons.map((button) => button.textContent)).toEqual(['No', 'No', 'No', 'No']);
    expect(report.filled).toBe(4);
    expect(report.needsReview).toBe(0);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});
