// GPA questions: exact value or the range holding it, else rounded to one decimal.
import { beforeEach, describe, expect, it } from 'vitest';
import { generic } from '../src/adapters/generic';
import { gpaToTenth, resolveAnswer } from '../src/lib/engine/answers';
import { bestOptionTiered } from '../src/lib/engine/text';
import { context, fastTimings } from './helpers/fixture';

function pick(gpa: string, options: string[]) {
  const { profile } = context();
  profile.education[0].gpa = gpa;
  const r = resolveAnswer('Please enter your cumulative GPA', '', null, { profile, skills: [] }, true);
  return bestOptionTiered(options, (o) => o, r.answer!.tiers!)?.option;
}

describe('GPA', () => {
  beforeEach(() => fastTimings());

  it('rounds to the nearest tenth', () => {
    expect(gpaToTenth('3.84')).toBe('3.8');
    expect(gpaToTenth('3.85')).toBe('3.9');
    expect(gpaToTenth('3.96')).toBe('4.0');
    expect(gpaToTenth('3.5')).toBe('3.5');
  });

  it('picks the one-decimal value closest to yours', () => {
    const values = ['4.0', '3.9', '3.8', '3.7', '3.6', '3.5', 'Below 3.5'];
    expect(pick('3.84', values)).toBe('3.8');
    expect(pick('3.85', values)).toBe('3.9');
    expect(pick('3.96', values)).toBe('4.0');
    expect(pick('3.45', values)).toBe('Below 3.5');
  });

  it('picks the range that holds your GPA', () => {
    const ranges = ['Below 3.0', '3.0 - 3.49', '3.5 - 3.79', '3.8 - 4.0'];
    expect(pick('3.84', ranges)).toBe('3.8 - 4.0');
    expect(pick('3.5', ranges)).toBe('3.5 - 3.79');
    expect(pick('3.45', ranges)).toBe('3.0 - 3.49');
    expect(pick('3.84', ['3.5+', '3.0+', 'Below 3.0'])).toBe('3.5+');
  });

  it('prefers your exact GPA when it is listed', () => {
    expect(pick('3.84', ['4.0', '3.84', '3.8'])).toBe('3.84');
  });

  it('types the rounded GPA when the box asks for one decimal place', async () => {
    document.body.innerHTML = `
      <label for="a">GPA (rounded to one decimal place)</label><input id="a" type="text">
      <label for="b">Cumulative GPA</label><input id="b" type="text">`;
    const ctx = context();
    ctx.profile.education[0].gpa = '3.84';
    await generic.fill(ctx);
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('3.8');
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('3.84');
  });
});

describe('graduation year options with a degree level', () => {
  it('picks "2028 Bachelors" for a June 2028 bachelor\'s', () => {
    const { profile } = context();
    const r = resolveAnswer('What year do you intend to complete your degree program?', '', null, { profile, skills: [] }, true);
    const options = ['2027 Bachelors', '2027 Masters', '2028 Bachelors', '2028 Masters', '2028 PhD', '2030+ All Degrees'];
    expect(bestOptionTiered(options, (o) => o, r.answer!.tiers!)?.option).toBe('2028 Bachelors');
  });
});
