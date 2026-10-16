import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, testProfile } from './helpers/fixture';
import { ashby } from '../src/adapters/ashby';

const certification = 'By typing your name below, I hereby certify that the answers that I have provided are complete and accurate to the best of my recollection and knowledge. I acknowledge and agree that I will abide by any applicable post-government employment conflicts of interest restrictions that may apply to any services that I may perform on behalf of the Company. I also acknowledge that the Company is specifically relying on the veracity of my answers and agree that any false or misleading answer may be a cause for disciplinary action, up to and including termination of employment if I am offered and accept a position with the Company, or cancellation of any consulting agreement.';

describe('applicant names and typed signatures', () => {
  const c = { profile: testProfile(), skills: [] };
  const ask = (label: string) => resolveAnswer(label, '', null, c, false).answer?.value;

  it.each([
    'Name:', 'Full Name', 'Legal Name', 'Name of Applicant', 'Signature',
    'Type your name below', 'Please enter your full legal name to certify your application',
    'Provide your full name to acknowledge and agree to the terms',
    'Please provide your electronic signature to certify the information is accurate',
    certification,
  ])('fills the full name for %s', (label) => expect(ask(label)).toBe('Ada Lovelace'));

  it('keeps separate name fields, company names and signature dates distinct', () => {
    expect(ask('First Name')).toBe('Ada');
    expect(ask('Last Name')).toBe('Lovelace');
    expect(ask('Middle Name')).toBe('K');
    expect(ask('Company Name')).toBe('Analytical Engines');
    expect(resolveAnswer('Signature Date', '', null, c, false).answer?.isDate).toBe(true);
    expect(ask('Name of your supervisor')).toBeUndefined();
  });

  it.each(['label', 'legend'])('fills the certification textarea using its %s', async (source) => {
    document.body.innerHTML = source === 'label'
      ? `<p>${certification}</p><label for="name">Name:*</label><textarea id="name" required></textarea>`
      : `<fieldset><legend>${certification}</legend><textarea id="name" required></textarea></fieldset>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    Object.assign(ctx.profile.personal, { firstName: 'Ada', lastName: 'Lovelace' });
    const report = await fillPage(ctx, { ats: 'Workday' });
    expect(document.querySelector<HTMLTextAreaElement>('#name')?.value).toBe('Ada Lovelace');
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });

  it.each(['survey-name', '_systemfield_eeoc_disability_name', 'eeocSurveyApplicantName'])('fills Ashby self-identification name field %s', async (id) => {
    document.body.innerHTML = `<section>
      <h3>Voluntary Self-Identification of Disability</h3>
      <div class="ashby-application-form-field-entry"><label for="${id}">Name*</label>
        <input id="${id}" name="${id}" placeholder="Type here..." required /></div>
      <div><label for="survey-date">Date*</label><input id="survey-date" placeholder="MM/DD/YYYY" required /></div>
    </section>`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    Object.assign(ctx.profile.personal, { firstName: 'Ada', lastName: 'Lovelace' });
    const report = await ashby.fill(ctx);
    expect(document.getElementById(id)).toHaveProperty('value', 'Ada Lovelace');
    expect(document.querySelector<HTMLInputElement>('#survey-date')?.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(report.filled).toBe(2);
    expect(report.needsReview).toBe(0);
  });

  it('uses the full-name override for both the main Ashby name and the disability survey', async () => {
    document.body.innerHTML = `<label for="_systemfield_name">Full name</label><input id="_systemfield_name" />
      <input id="_systemfield_eeoc_disability_name" name="_systemfield_eeoc_disability_name" aria-label="Voluntary Self-Identification of Disability" required />`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.personal.fullName = 'Ada Katherine Lovelace';
    const report = await ashby.fill(ctx);
    expect([...document.querySelectorAll('input')].map((input) => input.value)).toEqual(['Ada Katherine Lovelace', 'Ada Katherine Lovelace']);
    expect(report.filled).toBe(2);
  });
});
