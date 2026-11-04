// Cases that must stay unanswered or unchanged, next to the 1.4 additions that look like them.
import { describe, expect, it } from 'vitest';
import { resolveAnswer } from '../src/lib/engine/answers';
import { fillText } from '../src/lib/engine/controls';
import { context } from './helpers/fixture';

const ask = (label: string, isChoice = true) => {
  const { profile } = context();
  return resolveAnswer(label, '', null, { profile, skills: [] }, isChoice).answer;
};

describe('client and vendor referral questions', () => {
  it('answers the yes/no form No', () => {
    expect(ask('To your knowledge, were you referred to this position by a senior leader at a client, business partner, or vendor of Example Group?')?.value).toBe('No');
  });

  it('leaves it for you when you have a referrer', () => {
    const { profile } = context();
    profile.answers.referrerName = 'Grace Hopper';
    expect(resolveAnswer('Were you referred by an employee of a client or vendor of Example Group?', '', null, { profile, skills: [] }, true).answer).toBeNull();
  });

  it('leaves "How were you referred?" (a list of sources) to other rules', () => {
    expect(ask('How were you referred to us (employee, client, vendor, job board)?')?.key).not.toBe('clientReferral');
  });
});

describe('split start-date boxes', () => {
  it('reads "Start Date (Year)" as the school start year', () => {
    expect(ask('Start Date (Year)', false)?.value).toBe('2024');
  });

  it('does not put your school start month in a job availability box', () => {
    expect(ask('Available start date (Month)', false)?.key).not.toBe('eduStartMonth');
    expect(ask('Earliest start date for this internship (Month)', false)?.key).not.toBe('eduStartMonth');
  });
});

describe('month names in number boxes', () => {
  const box = () => {
    document.body.innerHTML = '<input type="number" min="1" max="12">';
    return document.querySelector('input')!;
  };

  it.each([['June', '6'], ['Sept.', '9'], ['dec', '12']])('types %s as %s', (value, typed) => {
    const el = box();
    fillText(el, value);
    expect(el.value).toBe(typed);
  });

  it.each(['Junior', 'Decline', 'Mayor'])('does not turn %s into a month', (value) => {
    const el = box();
    expect(fillText(el, value).ok).toBe(false);
    expect(el.value).toBe('');
  });
});
