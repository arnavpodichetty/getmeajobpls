import { describe, expect, it } from 'vitest';
import { fillPage } from '../src/lib/engine/fill';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

function searchableMajor(options: { selected?: string; query?: string; data?: boolean; information?: boolean; computer?: boolean; commit?: boolean } = {}) {
  document.body.innerHTML = `<label for="major">Discipline*</label><div class="select__control">
    <div class="select__value-container"><div class="select__input-container">
      <input id="major" class="select__input" role="combobox" aria-autocomplete="list" />
    </div></div></div>`;
  const input = document.querySelector<HTMLInputElement>('#major')!;
  const control = document.querySelector('.select__control')!;
  const queryLog: string[] = [];
  const chosen: string[] = [];
  input.value = options.query ?? '';
  if (options.selected) {
    const selected = document.createElement('div');
    selected.className = 'select__single-value';
    selected.textContent = options.selected;
    control.append(selected);
  }
  const menu = document.createElement('div');
  menu.setAttribute('role', 'listbox');
  // Reuse DOM nodes as react-select can when the filtered results change.
  const nodes = ['Science', 'Software Engineering'].map(() => {
    const node = document.createElement('div');
    node.setAttribute('role', 'option');
    node.addEventListener('click', () => {
      chosen.push(node.textContent!);
      if (options.commit !== false) {
        control.querySelector('.select__single-value')?.remove();
        const selected = document.createElement('div');
        selected.className = 'select__single-value';
        selected.textContent = node.textContent;
        control.append(selected);
        input.value = '';
      }
      menu.remove();
    });
    return node;
  });
  const render = (labels: string[]) => {
    labels.forEach((label, i) => { nodes[i].textContent = label; });
    menu.replaceChildren(...nodes.slice(0, labels.length));
    document.body.append(menu);
  };
  input.addEventListener('click', () => render(['Science', 'Software Engineering']));
  input.addEventListener('input', () => {
    queryLog.push(input.value);
    if (input.value === 'Computer Science' && options.data) render(['Computer Sciences']);
    else if (input.value === 'Software and Systems Engineering' && options.information) render(['Software and Systems Engineering']);
    else if (input.value === 'Software Engineering' && options.computer !== false) render(['Software Engineering']);
    else render(['Science']);
  });
  resetLayoutCache();
  fastTimings();
  return { input, queryLog, chosen };
}

const fill = () => fillPage(context({ resume: null }), { ats: 'Greenhouse' });

describe('major search fallbacks', () => {
  it('preserves actual values in plain input comboboxes', () => {
    document.body.innerHTML = '<label for="major">Discipline</label><input id="major" class="form-control" role="combobox" aria-autocomplete="list" value="Software Engineering" />';
    resetLayoutCache();
    expect(currentValue(scanFields()[0])).toBe('Software Engineering');
  });
  it('replaces a leftover science search with a committed Software Engineering selection', async () => {
    const { input, queryLog, chosen } = searchableMajor({ query: 'science' });
    expect(currentValue(scanFields()[0])).toBe('');
    const report = await fill();
    expect(chosen).toEqual(['Software Engineering']);
    expect(queryLog).toContain('Software Engineering');
    expect(input.value).toBe('');
    expect(currentValue(scanFields()[0])).toBe('Software Engineering');
    expect(report.filled).toBe(1);
    expect(report.needsReview).toBe(0);
  });

  it('corrects an actual Science selection even when ordinary overwriting is off', async () => {
    const { chosen } = searchableMajor({ selected: 'Science' });
    const report = await fill();
    expect(chosen).toEqual(['Software Engineering']);
    expect(report.filled).toBe(1);
    expect(currentValue(scanFields()[0])).toBe('Software Engineering');
  });

  it('searches for Computer Science before accepting an initially visible computing fallback', async () => {
    const { queryLog, chosen } = searchableMajor({ data: true });
    await fill();
    expect(queryLog).toEqual(['Computer Science']);
    expect(chosen).toEqual(['Computer Sciences']);
  });

  it('goes straight from Computer Science to Software Engineering', async () => {
    const { chosen, queryLog } = searchableMajor({ information: true });
    await fill();
    expect(queryLog).not.toContain('Software and Systems Engineering');
    expect(chosen).toEqual(['Software Engineering']);
  });

  it('reports review when only generic Science is available', async () => {
    const { chosen } = searchableMajor({ computer: false });
    const report = await fill();
    expect(chosen).toEqual([]);
    expect(report.filled).toBe(0);
    expect(report.needsReview).toBe(1);
  });

  it('does not report success if the dropdown retains the wrong selection', async () => {
    searchableMajor({ selected: 'Science', commit: false });
    const report = await fill();
    expect(currentValue(scanFields()[0])).toBe('Science');
    expect(report.filled).toBe(0);
    expect(report.needsReview).toBe(1);
  });

  it('corrects Science in native selects too', async () => {
    document.body.innerHTML = `<label for="major">Discipline*</label><select id="major">
      <option selected>Science</option><option>Software Engineering</option><option>Earth Sciences</option></select>`;
    resetLayoutCache();
    const report = await fill();
    expect(document.querySelector<HTMLSelectElement>('#major')?.value).toBe('Software Engineering');
    expect(report.filled).toBe(1);
  });
});
