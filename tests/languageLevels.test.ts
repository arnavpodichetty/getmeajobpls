import { beforeEach, describe, expect, it } from 'vitest';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { fillPage } from '../src/lib/engine/fill';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const levels = ['1 - Beginner', '2 - Classroom Study', '3 - Intermediate', '4 - Advanced', '5 - Fluent'];

describe('numbered language skill dropdowns', () => {
  it('picks Fluent for "1 - Listening" through "4 - Writing"', async () => {
    const skills = ['1 - Listening', '2 - Speaking', '3 - Reading', '4 - Writing'];
    document.body.innerHTML = skills
      .map((s, i) => `<label for="s${i}">${s} *</label><select id="s${i}" required><option value="">Select One</option>${levels.map((l) => `<option>${l}</option>`).join('')}</select>`)
      .join('');
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Workday' });
    expect([...document.querySelectorAll('select')].map((s) => s.value)).toEqual(skills.map(() => '5 - Fluent'));
    expect(report.needsReview).toBe(0);
  });
});
