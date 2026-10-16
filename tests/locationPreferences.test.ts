import { describe, expect, it } from 'vitest';
import { ashby } from '../src/adapters/ashby';
import { emptyProfile, normalizeProfile } from '../src/lib/defaults';
import { resolveAnswer } from '../src/lib/engine/answers';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { bestLocationOption, locationPreferenceRank, matchesLocation } from '../src/lib/engine/locationPreferences';
import { context, fastTimings, testProfile } from './helpers/fixture';

const places = ['New York, NY', 'San Francisco, CA', 'Los Angeles, CA', 'Chicago, IL'];
const question = 'What is your preferred work location?';
const options = () => '<option value="">Select One</option>' + places.map((place) => `<option>${place}</option>`).join('');

describe('preferred work locations', () => {
  it.each(['Preferred location', 'Location preference 1', 'Which office would you prefer?', 'Where would you prefer to work?', 'Which locations are you interested in?'])('recognizes %s', (label) => {
    const answer = resolveAnswer(label, '', null, { profile: testProfile(), skills: [] }, true).answer;
    expect(answer?.key).toBe('locationPreference');
    expect(answer?.locationPreference?.places).toEqual(['California']);
  });

  it('recognizes California states and city-only choices without treating Canada as CA', () => {
    for (const place of ['California', 'CA', 'San Francisco', 'Los Angeles', 'Palo Alto', 'San Diego, California', 'Sunnyvale, CA']) expect(matchesLocation(place, 'California'), place).toBe(true);
    for (const place of ['Toronto, Canada', 'Cambridge, MA', 'Los Angeles, Chile', 'San Diego, Texas', 'New York, NY']) expect(matchesLocation(place, 'California'), place).toBe(false);
  });

  it('accepts work-mode and region notes after a California city', () => {
    for (const place of ['San Francisco, CA - Hybrid', 'San Francisco, Bay Area', 'San Francisco (Hybrid)', 'San Jose, CA, USA', 'Los Angeles, California, United States', 'Sunnyvale, CA (On-site)', 'Palo Alto, Remote']) expect(matchesLocation(place, 'California'), place).toBe(true);
    for (const place of ['San Jose, Costa Rica', 'Los Angeles, Chile']) expect(matchesLocation(place, 'California'), place).toBe(false);
  });

  it('sorts California first while preserving option order within each region', () => {
    const pick = (rank: number) => bestLocationOption(places, (place) => place, { places: ['California'], rank })?.option;
    expect([1, 2, 3, 4].map(pick)).toEqual(['San Francisco, CA', 'Los Angeles, CA', 'New York, NY', 'Chicago, IL']);
    expect(bestLocationOption(places, (place) => place, { places: ['New York', 'California'], rank: 1 })?.option).toBe('New York, NY');
    expect(bestLocationOption(['New York, NY', 'Chicago, IL'], (place) => place, { places: ['California'], rank: 1 })?.option).toBe('New York, NY');
  });

  it('normalizes defaults and preserves an editable or disabled priority list', () => {
    expect(emptyProfile().answers.locationPreferences).toEqual([]);
    expect(normalizeProfile({ answers: {} }).answers.locationPreferences).toEqual([]);
    expect(normalizeProfile({ answers: { locationPreferences: ['Seattle', 'California'] } }).answers.locationPreferences).toEqual(['Seattle', 'California']);
    expect(normalizeProfile({ answers: { locationPreferences: [] } }).answers.locationPreferences).toEqual([]);
    expect(locationPreferenceRank('second office preference')).toBe(2);
    expect(locationPreferenceRank('preferred office #3')).toBe(3);
  });

  it.each(['select', 'radio', 'checkboxes', 'buttons', 'combobox'])('prioritizes California in %s fields', async (kind) => {
    fastTimings();
    let control: string;
    if (kind === 'select') control = `<select id="preference" required>${options()}</select>`;
    else if (kind === 'combobox') control = '<div class="select__control"><input id="preference" role="combobox" aria-autocomplete="list" placeholder="Start typing" required /></div>';
    else if (kind === 'buttons') control = `<div>${places.map((place) => `<button aria-pressed="false">${place}</button>`).join('')}</div>`;
    else control = places.map((place) => `<label><input type="${kind === 'radio' ? 'radio' : 'checkbox'}" name="preference" value="${place}" />${place}</label>`).join('');
    document.body.innerHTML = `<fieldset><legend>${question}*</legend>${control}</fieldset>`;
    let picked = '';
    document.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { picked = button.textContent!; button.setAttribute('aria-pressed', 'true'); }));
    if (kind === 'combobox') {
      const input = document.querySelector<HTMLInputElement>('#preference')!;
      input.addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'listbox');
        places.forEach((place) => {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.textContent = place;
          option.addEventListener('click', () => {
            picked = place;
            const selected = document.createElement('div');
            selected.className = 'select__single-value';
            selected.textContent = place;
            input.parentElement!.append(selected);
            input.value = '';
            menu.remove();
          });
          menu.append(option);
        });
        document.body.append(menu);
      });
    }
    resetLayoutCache();
    const report = await ashby.fill(context({ resume: null }));
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
    if (kind === 'select') picked = document.querySelector<HTMLSelectElement>('select')!.value;
    if (kind === 'radio' || kind === 'checkboxes') picked = document.querySelector<HTMLInputElement>('input:checked')!.value;
    expect(picked).toBe('San Francisco, CA');
  });

  it('assigns distinct California choices before other states in ranked fields', async () => {
    document.body.innerHTML = [1, 2, 3].map((rank) => `<label for="location${rank}">Location preference ${rank}*</label><select id="location${rank}">${options()}</select>`).join('');
    resetLayoutCache();
    await ashby.fill(context({ resume: null }));
    expect([...document.querySelectorAll('select')].map((select) => select.value)).toEqual(['San Francisco, CA', 'Los Angeles, CA', 'New York, NY']);
  });

  it.each([
    { hasCA: true, rank: 1, expected: 'San Francisco, CA' },
    { hasCA: false, rank: 1, expected: 'New York, NY' },
    { hasCA: true, rank: 2, expected: 'New York, NY' },
  ])('searches preferred regions before using other offices: $hasCA, rank $rank', async ({ hasCA, rank, expected }) => {
    fastTimings();
    document.body.innerHTML = `<label for="location">Location preference ${rank}*</label><div class="select__control">
      <input id="location" role="combobox" aria-autocomplete="list" placeholder="Start typing" required /></div>`;
    const input = document.querySelector<HTMLInputElement>('#location')!;
    const queries: string[] = [];
    let picked = '';
    let menu: HTMLElement | undefined;
    const render = (offices: string[]) => {
      menu?.remove();
      menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      for (const office of offices) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = office;
        option.addEventListener('click', () => {
          picked = office;
          const selected = document.createElement('div');
          selected.className = 'select__single-value';
          selected.textContent = office;
          input.parentElement!.append(selected);
          input.value = '';
          menu?.remove();
        });
        menu.append(option);
      }
      document.body.append(menu);
    };
    input.addEventListener('click', () => render(['New York, NY']));
    input.addEventListener('input', () => {
      queries.push(input.value);
      if (input.value === 'California' && hasCA) render(['San Francisco, CA']);
      else if (input.value === '') render(hasCA ? ['New York, NY', 'San Francisco, CA'] : ['New York, NY', 'Chicago, IL']);
      else render([]);
    });
    resetLayoutCache();
    const report = await ashby.fill(context({ resume: null }));
    expect(queries).toContain('California');
    expect(picked).toBe(expected);
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });

  it('leaves a disabled preference for review instead of filling the current address', async () => {
    document.body.innerHTML = `<label for="location">Preferred location*</label><input id="location" role="combobox" placeholder="Start typing" required />`;
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.answers.locationPreferences = [];
    const report = await ashby.fill(ctx);
    expect(document.querySelector<HTMLInputElement>('#location')?.value).toBe('');
    expect(report.needsReview).toBe(1);
  });

  it('does not reinterpret current location, residency, or RTO suitability as a preference', () => {
    const profile = testProfile();
    const ask = (label: string) => resolveAnswer(label, '', null, { profile, skills: [] }, true).answer;
    expect(ask('Current location')?.value).toBe('Los Angeles, CA');
    expect(ask('Are you a resident of Maryland?')?.value).toBe('No');
    expect(ask('Do the office location and RTO requirements work for you?')?.value).toBe('Yes');
  });
});
