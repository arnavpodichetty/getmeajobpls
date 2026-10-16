import { beforeEach, describe, expect, it } from 'vitest';
import { smartrecruiters } from '../src/adapters/smartrecruiters';
import { queryDeep } from '../src/lib/engine/dom';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => {
  fastTimings();
  loadFixture('smartrecruiters-education');
});

const majorInput = () => queryDeep<HTMLInputElement>('input[id^="edu-major-"]')!;

describe('SmartRecruiters education', () => {
  it('replaces the parsed degree description with just the saved major', async () => {
    majorInput().value = 'B.S. in Computer Science, B.A. in Linguistics, Music Minor';
    const ctx = context({ resume: null });
    expect(ctx.settings.overwriteExisting).toBe(false);
    const report = await smartrecruiters.fill(ctx);
    expect(majorInput().value).toBe('Computer Science');
    expect(queryDeep<HTMLInputElement>('input[id^="edu-degree-"]')!.value).toBe("Bachelor's Degree");
    expect(report.fields.find((field) => field.label === 'Major')?.status).toBe('filled');
  });

  it('uses another saved major without hardcoding one', async () => {
    const ctx = context({ resume: null });
    ctx.profile.education[0].major = 'Economics';
    majorInput().value = 'Bachelor of Arts in Economics, Mathematics Minor';
    await smartrecruiters.fill(ctx);
    expect(majorInput().value).toBe('Economics');
  });

  it.each(['', 'Computer Science', 'Software Engineering'])('handles the existing value %s', async (existing) => {
    majorInput().value = existing;
    await smartrecruiters.fill(context({ resume: null }));
    expect(majorInput().value).toBe(existing || 'Computer Science');
  });
});
