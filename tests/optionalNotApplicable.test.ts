import { beforeEach, describe, expect, it } from 'vitest';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { fillPage } from '../src/lib/engine/fill';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const referral = 'If you were referred to the role by a current Example Group teammate, please share their name here.';

async function fill(html: string) {
  document.body.innerHTML = html;
  resetLayoutCache();
  await fillPage(context({ resume: null }), { ats: 'Greenhouse' });
  return document.querySelector<HTMLInputElement>('#referral')!.value;
}

describe('optional boxes that would only get N/A', () => {
  const marked = `<label for="first">First name *</label><input id="first" required>`;

  it('leaves an optional box empty instead of typing N/A', async () => {
    expect(await fill(`${marked}<label for="referral">${referral}</label><input id="referral">`)).toBe('');
    expect(document.querySelector<HTMLInputElement>('#first')!.value).toBe('Ada');
  });

  it('still answers N/A when the box is required', async () => {
    expect(await fill(`${marked}<label for="referral">${referral} *</label><input id="referral" required>`)).toBe('N/A');
  });

  it('still answers N/A when the form marks nothing as required', async () => {
    expect(await fill(`<label for="first">First name</label><input id="first"><label for="referral">${referral}</label><input id="referral">`)).toBe('N/A');
  });

  it('types a real answer into an optional box', async () => {
    document.body.innerHTML = '';
    const ctx = context({ resume: null });
    ctx.profile.answers.referrerName = 'Grace Hopper';
    document.body.innerHTML = `${marked}<label for="referral">${referral}</label><input id="referral">`;
    resetLayoutCache();
    await fillPage(ctx, { ats: 'Greenhouse' });
    expect(document.querySelector<HTMLInputElement>('#referral')!.value).toBe('Grace Hopper');
  });
});
