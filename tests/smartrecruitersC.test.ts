import { beforeEach, describe, expect, it } from 'vitest';
import { smartrecruiters } from '../src/adapters/smartrecruiters';
import { currentValue, scanFields } from '../src/lib/engine/scan';
import { queryAllDeep, queryDeep } from '../src/lib/engine/dom';
import { context, fastTimings, loadFixture } from './helpers/fixture';

// SmartRecruiters capture C: an internship's screening page with a language row, graduation
// month and year dropdowns, credit-hour and enrollment questions, an attestation checkbox, and
// an "Additional attachments" upload under a note asking for a transcript.
interface Question { id: string; fields: { name: string; values: { label: string }[] }[]; }
let questions: Question[];

beforeEach(() => {
  fastTimings();
  loadFixture('smartrecruiters-c');
  questions = JSON.parse(document.querySelector('sr-screening-questions-form')!.getAttribute('definition')!).questions;
});

const field = (match: string | RegExp) => {
  const found = scanFields().find((f) => (typeof match === 'string' ? f.label.includes(match) : match.test(f.label)));
  if (!found) throw new Error(`No field for ${match}`);
  return found;
};

// Recreate the live components: captures have no JavaScript, and only open dropdowns carry options.
function hydrate() {
  for (const host of queryAllDeep('spl-autocomplete')) {
    queryAllDeep('spl-select-option', host).forEach((option) => option.remove());
    const input = queryDeep<HTMLInputElement>('input[role="combobox"]', host)!;
    const [, id, , part] = host.id.match(/^question_([0-9a-f-]+)(?:-(\d+)-(\w+))?$/)!;
    const q = questions.find((q) => q.id === id)!;
    const values = (part ? q.fields.find((f) => f.name === part)! : q.fields[0]).values;
    input.addEventListener('click', () => {
      if (queryDeep('spl-select-option', host)) return;
      for (const value of values) {
        const option = document.createElement('spl-select-option');
        option.textContent = value.label;
        option.attachShadow({ mode: 'open' }).innerHTML = '<div role="option"><slot></slot></div>';
        option.shadowRoot!.querySelector('div')!.addEventListener('click', () => {
          input.value = value.label;
          queryAllDeep('spl-select-option', host).forEach((node) => node.remove());
        });
        host.append(option);
      }
    });
  }
  for (const radio of queryAllDeep('spl-radio')) radio.addEventListener('click', () => {
    for (const sibling of [...radio.parentElement!.children]) if (sibling.matches('spl-radio')) sibling.setAttribute('aria-checked', String(sibling === radio));
  });
  // The drop zone lists what it took, then clears its input.
  for (const zone of queryAllDeep('spl-dropzone')) {
    const input = zone.shadowRoot!.querySelector<HTMLInputElement>('input[type=file]')!;
    input.addEventListener('change', () => {
      const list = zone.shadowRoot!.querySelector('.c-spl-file-list')!;
      for (const file of [...(input.files ?? [])]) list.insertAdjacentHTML('beforeend', `<li class="c-spl-file-list-item"><span class="c-spl-file-list-item-name">${file.name}</span></li>`);
    });
  }
}

const transcript = () => {
  const file = new File(['%PDF-1.4 transcript'], 'ada-transcript.pdf', { type: 'application/pdf' });
  return { meta: { id: 't', kind: 'transcript' as const, name: 'Transcript', tags: [], skills: [], fileName: file.name, mimeType: 'application/pdf', size: file.size, uploadedAt: 0, isDefault: false }, file };
};
const attached = () => queryAllDeep('.c-spl-file-list-item-name').map((el) => el.textContent);

describe('SmartRecruiters screening page C', () => {
  it('reads each field\'s own question, not the section heading', () => {
    const labels = scanFields().map((f) => f.label);
    expect(labels).not.toContain('Preliminary questions');
    expect(labels).toContain('Additional attachments');
    expect(labels).toContain('Language input for entry 1');
    expect(labels).toContain('Level for language entry 1');
    expect(labels.some((l) => l.startsWith('I understand that the information I provide'))).toBe(true);
    expect(labels.some((l) => l.startsWith('You declare that you have read and agree'))).toBe(true);
  });

  it('answers the questions it can be sure of', async () => {
    hydrate();
    const ctx = context({ transcript: transcript() });
    await smartrecruiters.fill(ctx);
    const expected: [string | RegExp, string][] = [
      ['Do you meet all work authorization', 'Yes'],
      ['employed by Globex', 'No'],
      ['Language input for entry 1', 'English'],
      // A language marked fluent tries Native first, as on other sites.
      ['Level for language entry 1', 'Native'],
      ['links/URLs of your portfolios or work samples', 'Yes'],
      ['GPA of 3.0 or above', 'Yes'],
      ['Will you be enrolled in a college degree program', 'Yes'],
      ['30 college credit hours', 'Yes'],
      ['month in which you will receive your degree', 'June'],
      ['year in which you will receive your degree', '2028'],
      ['Current or Former Acme Intern', 'No'],
      ['spouse/domestic partner of a member of the US Armed Forces', 'No'],
    ];
    for (const [match, value] of expected) expect(currentValue(field(match)), String(match)).toBe(value);
    // Optional and about memberships, not employment: left for you.
    expect(currentValue(field('member of any professional'))).toBe('');
    expect(currentValue(field('I understand that the information I provide'))).toBe('checked');
    expect(currentValue(field('You declare that you have read and agree'))).toBe('checked');
  });

  it('puts the transcript, not the resume, in the attachments box under the transcript request', async () => {
    hydrate();
    const report = await smartrecruiters.fill(context({ transcript: transcript() }));
    expect(attached()).toEqual(['ada-transcript.pdf']);
    expect(report.fields.find((f) => f.label.startsWith('Transcript'))?.status).toBe('filled');
    await smartrecruiters.fill(context({ transcript: transcript() }));
    expect(attached()).toEqual(['ada-transcript.pdf']);
  });

  it('flags the transcript request when no transcript is saved', async () => {
    hydrate();
    const report = await smartrecruiters.fill(context());
    expect(attached()).toEqual([]);
    expect(report.fields.find((f) => f.label === 'Transcript')?.status).toBe('review');
  });
});
