import { describe, expect, it } from 'vitest';
import { payExpectation, resolveAnswer } from '../src/lib/engine/answers';
import { bestOptionTiered } from '../src/lib/engine/text';
import { context } from './helpers/fixture';

const resolve = (label: string, hourlyRate = '40', isChoice = false) => {
  const { profile } = context();
  profile.answers.hourlyRate = hourlyRate;
  return resolveAnswer(label, '', null, { profile, skills: [] }, isChoice).answer;
};
const pick = (label: string, options: string[]) => bestOptionTiered(options, (o) => o, resolve(label, '40', true)!.tiers!)?.option;

describe('pay expectations', () => {
  it('answers hourly by default', () => {
    expect(resolve('What are your salary expectations?')?.value).toBe('$40/hr');
    expect(resolve('Desired compensation')?.value).toBe('$40/hr');
    expect(resolve('What is your expected hourly rate?')?.value).toBe('$40/hr');
  });

  it('works out annual pay as 52 × 40 × hourly', () => {
    expect(resolve('What is your desired annual salary?')?.value).toBe('$83,200');
    expect(resolve('Expected yearly compensation')?.value).toBe('$83,200');
    const { profile } = context();
    profile.answers.hourlyRate = '$45/hr';
    expect(payExpectation(profile)).toEqual({ hourly: 45, annual: 93600 });
    expect(resolve('Salary expectations', '')).toBeNull();
  });

  it('chooses the annual range that contains the annual figure', () => {
    const annual = ['Less than $60,000', '$60,000 - $79,999', '$80,000 - $99,999', '$100,000+'];
    expect(pick('What is your desired annual salary range?', annual)).toBe('$80,000 - $99,999');
    expect(pick('Desired salary', ['$50k-$70k', '$70k-$90k', '$90k+'])).toBe('$70k-$90k');
  });

  it('chooses an hourly range, and never compares hourly with annual figures', () => {
    expect(pick('Expected pay', ['$20-$30/hr', '$30-$40/hr', '$41-$50/hr', '$50+/hr'])).toBe('$30-$40/hr');
    expect(pick('Expected pay', ['Under $30', '$31 - $45', '$46+'])).toBe('$31 - $45');
    expect(pick('Expected pay', ['Under $50,000', '$50,000 - $90,000', 'Over $90,000'])).toBe('$50,000 - $90,000');
  });
});
