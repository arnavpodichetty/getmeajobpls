// After a fill, the page is watched and every change starts a pass over it for new fields.
// Most of those passes find nothing; they must stay cheap, and still fill what does appear.
import { beforeEach, describe, expect, it } from 'vitest';
import { fillPage } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

const box = (id: string, label: string) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text"></div>`;

beforeEach(() => {
  fastTimings();
  document.body.innerHTML = `<form>${box('first', 'First name')}${box('last', 'Last name')}</form>`;
  resetLayoutCache();
});

describe('passes over new fields', () => {
  it('end quickly when nothing new appeared, and fill what did', async () => {
    const ctx = context({ resume: null });
    expect((await fillPage(ctx, { ats: 'Test' })).filled).toBe(2);

    const started = performance.now();
    const idle = await fillPage({ ...ctx, incremental: true }, { ats: 'Test', incremental: true });
    expect(idle.filled).toBe(0);
    // No second look 400ms later: nothing was answered, so nothing was revealed.
    expect(performance.now() - started).toBeLessThan(350);

    document.querySelector('form')!.insertAdjacentHTML('beforeend', box('email', 'Email'));
    const pass = await fillPage({ ...ctx, incremental: true }, { ats: 'Test', incremental: true });
    expect(pass.filled).toBe(1);
    expect((document.querySelector('#email') as HTMLInputElement).value).toBe('ada@example.com');
  });

  it('still looks again for an entry form an adapter just opened', async () => {
    // Oracle and SmartRecruiters fill a form right after opening it; its fields can arrive late.
    document.body.innerHTML = '<div id="entry"></div>';
    const entry = document.querySelector('#entry')!;
    setTimeout(() => entry.insertAdjacentHTML('beforeend', box('school', 'School')), 100);
    const report = await fillPage(context({ resume: null }), { ats: 'Test', root: entry, incremental: true });
    expect((document.querySelector('#school') as HTMLInputElement | null)?.value).toBe('University of California, Los Angeles');
    expect(report.filled).toBe(1);
  });
});
