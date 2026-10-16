import { beforeEach, describe, expect, it } from 'vitest';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { optionScore } from '../src/lib/engine/text';
import { resolveAnswer } from '../src/lib/engine/answers';
import { context, fastTimings } from './helpers/fixture';

const question = 'What led you to apply for this opportunity at Initech? Select all that apply.';
const sources = ['Career fair', 'Initech presentation or event at my university', 'Current Initech employee', 'LinkedIn', 'Handshake or another university career platform', 'Indeed', 'Initech Careers website', 'Initech website, article, podcast or other Initech content', 'Other'];

beforeEach(fastTimings);

describe('application sources', () => {
  it.each(['checkbox', 'radio', 'select'])('chooses one configured source in a %s list', async (kind) => {
    for (const includeLinkedIn of [true, false]) {
      const options = sources.filter((s) => includeLinkedIn || s !== 'LinkedIn');
      document.body.innerHTML = kind === 'select'
        ? `<label for="source">${question}</label><select id="source" required><option value="">Select One</option>${options.map((s) => `<option>${s}</option>`).join('')}</select>`
        : `<fieldset><legend>${question}</legend>${options.map((s, i) => `<label><input type="${kind}" name="source" value="${s}" id="s${i}">${s}</label>`).join('')}</fieldset>`;
      resetLayoutCache();
      const ctx = context({ resume: null });
      ctx.profile.answers.referralSourceFallbacks = ['Company careers website'];
      const report = await fillPage(ctx, { ats: 'Greenhouse' });
      const chosen = kind === 'select'
        ? [document.querySelector<HTMLSelectElement>('select')!.value]
        : [...document.querySelectorAll<HTMLInputElement>('input:checked')].map((el) => el.value);
      expect(chosen).toEqual([includeLinkedIn ? 'LinkedIn' : 'Initech Careers website']);
      expect(report.filled).toBe(1);
      expect(report.needsReview).toBe(0);
    }
  });

  it('respects a different source and leaves blank preferences for review', () => {
    const { profile } = context();
    const ctx = { profile, skills: [] };
    ctx.profile.answers.referralSource = 'Indeed';
    expect(resolveAnswer(question, '', null, ctx, true).answer?.value).toBe('Indeed');
    ctx.profile.answers.referralSource = '';
    expect(resolveAnswer(question, '', null, ctx, true).answer).toBeNull();
    expect(resolveAnswer('Why do you want to work here?', '', null, ctx, false).answer).toBeNull();
  });

  it.each(sources.filter((s) => s !== 'Initech Careers website'))('does not confuse careers websites with %s', (source) => {
    expect(optionScore(source, 'Company careers website')).toBe(0);
  });
});
