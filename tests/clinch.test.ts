// Capture: a careers site on Clinch with Greenhouse education pickers (selectize typeaheads),
// a "Start date" inside the education block and a state/region list with "Another State in the US".
import { beforeEach, describe, expect, it } from 'vitest';
import { generic } from '../src/adapters/generic';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { context, fastTimings, loadFixture } from './helpers/fixture';

beforeEach(() => { fastTimings(); loadFixture('clinch-a'); });

/** Make each selectize box show these options while typing and add an .item when one is picked. */
function simulateSelectize(menus: Record<string, string[]>) {
  for (const [id, options] of Object.entries(menus)) {
    const input = document.getElementById(id) as HTMLInputElement;
    const box = input.closest('.selectize-input')!;
    const content = box.parentElement!.querySelector('.selectize-dropdown-content')!;
    const render = () => {
      content.innerHTML = '';
      const query = input.value.toLowerCase();
      for (const text of options.filter((o) => o.toLowerCase().includes(query.split(',')[0]))) {
        const option = document.createElement('div');
        option.className = 'option';
        option.setAttribute('data-selectable', '');
        option.textContent = text;
        option.addEventListener('mousedown', () => {
          box.querySelector('.item')?.remove();
          const item = document.createElement('div');
          item.className = 'item';
          item.textContent = text;
          box.insertBefore(item, input);
          input.value = '';
          content.innerHTML = '';
        });
        content.append(option);
      }
    };
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
  }
}

const field = (label: RegExp) => scanFields().find((f) => label.test(f.label))!;
const SCHOOL = 'question_7_0_4_1_0_school_name_--template---selectized';
const byId = (id: string) => currentValue(scanFields().find((f) => f.el.id === id)!);

describe('Clinch careers site (capture A)', () => {
  it('reads labels without the hidden accessibility code and skips selectize\'s hidden selects', () => {
    const labels = scanFields().map((f) => f.label);
    expect(labels).toContain('Location');
    expect(labels).toContain('Degree');
    expect(scanFields().filter((f) => f.kind === 'select' && /typing/i.test(f.label))).toEqual([]);
    expect(field(/^Degree$/).kind).toBe('combobox');
  });

  it('fills the form, picking from the education typeaheads', async () => {
    simulateSelectize({
      'question_7_0_4_1_0_school_name_--template---selectized': ['University of California, Los Angeles', 'University of California, Davis'],
      'question_7_0_4_1_0_degree_--template---selectized': ["Bachelor's Degree", "Master's Degree"],
      'question_7_0_4_1_0_discipline_--template---selectized': ['Computer Science', 'Software Engineering'],
    });
    const report = await generic.fill(context());
    const value = (label: RegExp) => currentValue(field(label));
    expect(value(/require work authorization\?$/)).toBe('No');
    expect(value(/^If yes, what kind/)).toBe('Not applicable');
    expect(value(/export license/)).toBe('No');
    expect(value(/current or former Globex/)).toBe('Never worked at Globex');
    expect(value(/state\/region/)).toBe('Another State in the US');
    expect(byId(SCHOOL)).toBe('University of California, Los Angeles');
    expect(value(/^Degree$/)).toBe("Bachelor's Degree");
    expect(value(/^Discipline$/)).toBe('Computer Science');
    // School dates, not the internship start date.
    expect((document.getElementById('question_7_0_4_1_0_start_month_--template--') as HTMLInputElement).value).toBe('9');
    expect((document.getElementById('question_7_0_4_1_0_start_year_--template--') as HTMLInputElement).value).toBe('2024');
    expect((document.getElementById('question_7_0_4_1_0_end_year_--template--') as HTMLInputElement).value).toBe('2028');
    expect(value(/^Location$/)).toBe('Los Angeles, CA');
    expect(report.fields.filter((f) => f.status === 'review')).toEqual([]);
  });

  it('flags a typeahead that never picked anything instead of marking it filled', async () => {
    await generic.fill(context());
    expect(byId(SCHOOL)).toBe('');
  });
});
