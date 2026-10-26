import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillMultiCombobox, fillRadio } from '../src/lib/engine/controls';
import { collectAnswers } from '../src/lib/engine/capture';
import { emptyProfile } from '../src/lib/defaults';
import { composedElements, queryAllDeep, queryDeep, resetLayoutCache } from '../src/lib/engine/dom';
import { clearHighlights, findResumeTarget } from '../src/lib/engine/fill';
import { scanFields } from '../src/lib/engine/scan';
import { fastTimings } from './helpers/fixture';

beforeEach(() => {
  document.body.innerHTML = '';
  resetLayoutCache();
  fastTimings();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deep DOM lookups', () => {
  it('keeps composed order, including a scoped host and nested shadow roots', () => {
    document.body.innerHTML = '<div id="host"><input id="light"></div><input id="last">';
    const host = document.querySelector('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<span id="nested"></span><input id="shadow">';
    host.shadowRoot!.querySelector('#nested')!.attachShadow({ mode: 'open' }).innerHTML = '<input id="first">';
    for (const root of [document, host, host.shadowRoot!]) {
      const expected = composedElements(root).filter((el) => el.matches('input'));
      expect(queryAllDeep('input', root)).toEqual(expected);
      expect(queryDeep('input', root)).toBe(expected[0]);
      expect(queryDeep('textarea', root)).toBeNull();
    }
  });

  it('stops searching after the first match', () => {
    document.body.innerHTML = '<input><div id="later"><input></div>';
    const later = document.querySelector('#later')!;
    const matches = vi.spyOn(later, 'matches');
    expect(queryDeep('input', document.body)).toBe(document.body.firstElementChild);
    expect(matches).not.toHaveBeenCalled();
  });

  it('clears highlights inside shadow roots', () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<input data-getmeajobpls="filled" style="outline: 2px solid green; outline-offset: 2px; color: red">';
    const input = host.shadowRoot!.querySelector('input')!;
    clearHighlights();
    expect(input.hasAttribute('data-getmeajobpls')).toBe(false);
    expect(input.style.outline).toBe('');
    expect(input.style.outlineOffset).toBe('');
    expect(input.style.color).toBe('red');
  });
});

describe('radio scopes', () => {
  const question = (label: string) => `<fieldset><legend>${label}</legend><label><input type="radio" name="answer" value="yes">Yes</label><label><input type="radio" name="answer" value="no">No</label></fieldset>`;

  it('keeps same-name radios in separate forms apart, including external form owners', () => {
    document.body.innerHTML = `<form id="a">${question('First question')}</form><form id="b">${question('Second question')}</form><input type="radio" name="answer" form="a" value="other">`;
    const fields = scanFields();
    expect(fields.map((f) => f.label)).toEqual(['First question', 'Second question']);
    expect(fields.map((f) => f.members.length)).toEqual([3, 2]);
  });

  it('keeps same-name radios in separate shadow trees apart', () => {
    for (const label of ['First question', 'Second question']) {
      const host = document.createElement('div');
      document.body.append(host);
      host.attachShadow({ mode: 'open' }).innerHTML = question(label);
    }
    expect(scanFields().map((f) => [f.label, f.members.length])).toEqual([
      ['First question', 2], ['Second question', 2],
    ]);
  });

  it('saves the visible radio answer so it can be reused with different site IDs', () => {
    document.body.innerHTML = '<fieldset><legend>Which puzzle format do you prefer?</legend><label><input type="radio" name="puzzle" value="id-123" checked>Crossword</label><label><input type="radio" name="puzzle" value="id-456">Sudoku</label></fieldset>';
    const [saved] = collectAnswers(emptyProfile());
    expect(saved).toEqual({ question: 'Which puzzle format do you prefer?', answer: 'Crossword' });
    document.body.innerHTML = '<fieldset><legend>Which puzzle format do you prefer?</legend><label><input type="radio" name="puzzle" value="different-id">Crossword</label><label><input type="radio" name="puzzle" value="another-id">Sudoku</label></fieldset>';
    expect(fillRadio(scanFields()[0].members, saved.answer).ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });
});

describe('resume target selection', () => {
  it.each(['Portfolio', 'Writing sample', 'Additional documents', 'Other attachments', 'Cover letter', 'Transcript'])('does not use a lone %s upload for the resume', (label) => {
    document.body.innerHTML = `<label for="upload">${label}</label><input id="upload" type="file">`;
    expect(findResumeTarget(scanFields())).toBeNull();
  });

  it.each(['Resume/CV', 'Attachment'])('still accepts a %s upload', (label) => {
    document.body.innerHTML = `<label for="upload">${label}</label><input id="upload" type="file">`;
    expect(findResumeTarget(scanFields())).toBe(document.querySelector('input'));
  });
});

describe('multi-select confirmation', () => {
  it.each(['ignored', 'aria', 'react', 'spl'])('recognizes an accepted pick (%s)', async (mode) => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div data-automation-id="formField-skills"><div class="select__control"><div><input role="combobox" aria-controls="skills"></div></div></div><div id="skills" role="listbox"></div>';
      if (mode === 'spl') {
        const host = document.createElement('spl-multiselect-autocomplete');
        document.querySelector('[data-automation-id]')!.replaceWith(host);
        host.attachShadow({ mode: 'open' }).innerHTML = '<input role="combobox" aria-controls="skills">';
        host.append(document.querySelector('#skills')!);
      }
      const input = queryDeep<HTMLInputElement>('input')!;
      input.addEventListener('input', () => {
        if (!input.value) return;
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = 'Python';
        option.addEventListener('click', () => {
          if (mode === 'aria') option.setAttribute('aria-selected', 'true');
          if (mode === 'react') {
            const selected = document.createElement('div');
            selected.className = 'select__multi-value';
            selected.textContent = 'Python';
            document.querySelector('.select__control')!.append(selected);
            option.remove();
          }
          if (mode === 'spl') {
            const selected = document.createElement('spl-tag');
            selected.setAttribute('label', 'Python');
            document.querySelector('spl-multiselect-autocomplete')!.append(selected);
            option.remove();
          }
        });
        document.querySelector('#skills')!.replaceChildren(option);
      });
      const result = fillMultiCombobox(input, ['Python']);
      await vi.runAllTimersAsync();
      expect(await result).toEqual(mode !== 'ignored' ? { added: ['Python'], skipped: [] } : { added: [], skipped: ['Python'] });
    } finally {
      vi.useRealTimers();
    }
  });
});
