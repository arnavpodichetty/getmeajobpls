import { beforeEach, describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

const EXPORT =
  'EXPORT CONTROLS - This position requires access to information and technology that is subject to U.S. export controls. Your responses to the questions below will be used solely to determine your eligibility under U.S. law to receive information and materials subject to U.S. export controls. *';
const EXPORT_OPTIONS = [
  'A United States citizen or national',
  'A person lawfully admitted for permanent residence of the United States (i.e., “Green Card” holder)',
  'A person admitted as a refugee to the United States under 8 U.S.C. 1157',
  'A person admitted as an asylee to the United States under 8 U.S.C. 1158',
  'None of the above',
];

beforeEach(fastTimings);

const select = (label: string, options: string[]) => {
  document.body.innerHTML = `<label for="q">${label}</label><select id="q" required><option value="">Select...</option>${options.map((o) => `<option>${o}</option>`).join('')}</select>`;
  resetLayoutCache();
};

describe('US citizen options', () => {
  it.each([EXPORT, 'Are you a U.S. person as defined by ITAR?', 'What is your citizenship status?', 'Which of the following best describes your immigration status?'])(
    'maps "%s" to the US-citizen choice',
    (label) => {
      const { profile } = context();
      const answer = resolveAnswer(label, '', null, { profile, skills: [] }, true).answer;
      expect(answer?.key).toBe('usPersonStatus');
      profile.answers.citizenship = 'India';
      expect(resolveAnswer(label, '', null, { profile, skills: [] }, true).answer).toBeNull();
    },
  );

  it('picks the citizen option on the Greenhouse export-controls question', async () => {
    select(EXPORT, EXPORT_OPTIONS);
    const report = await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
    expect(document.querySelector('select')!.value).toBe(EXPORT_OPTIONS[0]);
    expect(report.needsReview).toBe(0);
  });

  it('prefers a US-citizen option on any choice question', async () => {
    select('Will you now or in the future require sponsorship?', ['Yes', 'No, I have a green card', 'No, I am a U.S. citizen', 'I am not a US citizen']);
    await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
    expect(document.querySelector('select')!.value).toBe('No, I am a U.S. citizen');

    select('Some question we have no rule for', ['Other', 'US Citizen', 'Permanent Resident']);
    await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
    expect(document.querySelector('select')!.value).toBe('US Citizen');
  });

  it('leaves citizen options alone for non-US citizens', async () => {
    select('Some question we have no rule for', ['Other', 'US Citizen', 'Permanent Resident']);
    const ctx = context({ resume: null });
    ctx.profile.answers.citizenship = 'India';
    await fillPage(ctx, { ats: 'Greenhouse' });
    expect(document.querySelector('select')!.value).toBe('');
  });
});

describe('postgraduate plans', () => {
  it.each([
    'Do you intent to enroll in a postgraduate degree following the completion of your internship term?*',
    'Do you plan to pursue a graduate degree after graduation?',
    'Are you planning to attend graduate school upon completion of your undergraduate degree?',
  ])('answers "%s" from your further-education answer', (label) => {
    const { profile } = context();
    expect(resolveAnswer(label, '', null, { profile, skills: [] }, true).answer?.value).toBe('No');
  });
});
