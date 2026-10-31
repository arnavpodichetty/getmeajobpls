// Workable's EEO survey (shown after submitting): each answer is a role="radio" box
// with a hidden native radio inside. It's one question per group, not two.
import { beforeEach, describe, expect, it } from 'vitest';
import { detectAdapter } from '../src/adapters';
import { scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(fastTimings);

/** The role="radio" boxes flip aria-checked when clicked, like the live page. */
function liveRadios() {
  for (const radio of document.querySelectorAll<HTMLElement>('[role="radio"]')) {
    radio.addEventListener('click', () => {
      radio.closest('[role="radiogroup"]')!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', String(r === radio)));
    });
  }
}

const picked = (group: string) => {
  const heading = [...document.querySelectorAll('h4')].find((h) => h.textContent === group)!;
  const set = heading.parentElement!.nextElementSibling!.querySelector('[role="radiogroup"]')!;
  const box = set.querySelector('[role="radio"][aria-checked="true"]');
  return box ? document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent!.trim() : null;
};

async function fill(eeo: Record<string, string>) {
  loadFixture('workable-eeo');
  liveRadios();
  const ctx = context({ resume: null });
  Object.assign(ctx.profile.eeo, eeo);
  return detectAdapter(new URL('https://apply.workable.com/acme/j/X/apply/'), document).fill(ctx);
}

describe('Workable EEO survey', () => {
  it('sees one question per radio group', () => {
    loadFixture('workable-eeo');
    expect(scanFields().map((f) => [f.kind, f.label])).toEqual([['buttons', 'Race or ethnicity'], ['buttons', 'Gender']]);
  });

  it('picks race and gender from the profile', async () => {
    const r = await fill({ raceEthnicity: 'Asian', hispanicLatino: 'No', gender: 'Male' });
    expect(picked('Race or ethnicity')).toBe('Asian (Not Hispanic or Latino)');
    expect(picked('Gender')).toBe('Male');
    expect(r.fields.every((f) => f.status === 'filled')).toBe(true);
  });

  it('picks Hispanic or Latino for a Hispanic applicant of any race', async () => {
    await fill({ raceEthnicity: 'White', hispanicLatino: 'Yes', gender: 'Female' });
    expect(picked('Race or ethnicity')).toBe('Hispanic or Latino');
  });

  it('declines when the profile leaves it blank', async () => {
    await fill({ raceEthnicity: '', hispanicLatino: '', gender: '' });
    expect(picked('Race or ethnicity')).toBe("I don't wish to answer");
    expect(picked('Gender')).toBe("I don't wish to answer");
  });
});
