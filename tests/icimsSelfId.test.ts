// iCIMS "Portal Specific Forms" step: the VEVRAA self-identification form. The veteran
// question is a numbered paragraph above unlabeled-by-question radios, and the signature
// is a lone checkbox ("checking the checkbox above is equivalent to a handwritten signature").
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context } from './helpers/fixture';

const FORM = `<form><div class="formBox">
  <p>1. This employer is a Government contractor subject to the Vietnam Era Veterans' Readjustment Assistance Act of 1974.</p>
  <p>2. If you believe you belong to any of the categories of protected veterans listed above, please indicate by checking the appropriate box below. As a Government contractor subject to VEVRAA, we request this information in order to measure the effectiveness of the outreach and positive recruitment efforts we undertake pursuant to VEVRAA.</p>
  <div><input type="radio" name="vet" id="v1" value="1"><label for="v1">I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE</label></div>
  <div><input type="radio" name="vet" id="v2" value="2"><label for="v2">I AM NOT A PROTECTED VETERAN</label></div>
  <div><input type="radio" name="vet" id="v3" value="3"><label for="v3">I DON'T WISH TO ANSWER</label></div>
  <p>3. Submission of this information is voluntary and refusal to provide it will not subject you to any adverse treatment.</p>
  <table><tr><td><label for="name">Your Name</label></td></tr><tr><td><input type="text" id="name"></td></tr></table>
  <div style="text-align:center"><b>Signature</b><br><input type="checkbox" id="sig" name="sig"><br>(checking the checkbox above is equivalent to a handwritten signature)</div>
</div></form>`;

describe('iCIMS VEVRAA self-identification form', () => {
  it('picks the veteran answer and ticks the signature box', async () => {
    document.body.innerHTML = FORM;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.eeo.veteranStatus = 'I am not a protected veteran';
    const report = await fillPage(ctx, { ats: 'iCIMS' });
    expect(document.querySelector<HTMLInputElement>('#v2')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#sig')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#name')?.value).toBe('Ada Lovelace');
    expect(report.needsReview).toBe(0);
  });

  it('still types your name into a signature text box', () => {
    const ask = (label: string) => resolveAnswer(label, '', null, { profile: context().profile, skills: [] }, false).answer?.value;
    expect(ask('Signature')).toBe('Ada Lovelace');
    expect(ask('Electronic Signature')).toBe('Ada Lovelace');
    expect(ask('Typing your name below is equivalent to a handwritten signature')).not.toBe('Yes');
  });
});
