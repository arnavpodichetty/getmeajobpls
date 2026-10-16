import { h } from '../../lib/dom';
import { uid } from '../../lib/defaults';
import {
  deleteResume,
  getResume,
  listResumes,
  putResume,
  setDefaultResume,
  updateResumeMeta,
} from '../../lib/resumeDb';
import { pickResume } from '../../lib/resumeRules';
import { saveRules } from '../../lib/storage';
import type { ResumeMeta, ResumeRule } from '../../lib/types';
import { listField, textField } from './fields';
import { debounce, showToast } from './toast';

const MAX_BYTES = 10 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

let resumes: ResumeMeta[] = [];
/** Lets the rules section refresh its resume dropdowns when the library changes. */
let onLibraryChange: () => void = () => {};

export async function resumeSection(): Promise<HTMLElement> {
  resumes = await listResumes();
  const list = h('div', { class: 'cards' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    hidden: true,
    onChange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      await addFiles([...(input.files ?? [])]);
      input.value = '';
    },
  });

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        showToast(`${file.name} is not a PDF`, true);
        continue;
      }
      if (file.size > MAX_BYTES) {
        showToast(`${file.name} is over 10 MB`, true);
        continue;
      }
      await putResume({
        id: uid(),
        name: file.name.replace(/\.pdf$/i, ''),
        tags: [],
        skills: [],
        fileName: file.name,
        mimeType: 'application/pdf',
        size: file.size,
        uploadedAt: Date.now(),
        isDefault: resumes.length === 0,
        blob: file,
      });
      resumes = await listResumes();
    }
    draw();
    showToast('Uploaded');
  }

  async function replaceFile(meta: ResumeMeta, file: File) {
    const rec = await getResume(meta.id);
    if (!rec) return;
    await putResume({ ...rec, fileName: file.name, size: file.size, uploadedAt: rec.uploadedAt, blob: file });
    resumes = await listResumes();
    draw();
    showToast('File replaced');
  }

  async function open(meta: ResumeMeta) {
    const rec = await getResume(meta.id);
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function card(meta: ResumeMeta): HTMLElement {
    // Metadata edits are saved per resume, debounced.
    const save = debounce(async () => {
      await updateResumeMeta(meta.id, { name: meta.name });
      onLibraryChange();
    });
    const replaceInput = h('input', {
      type: 'file',
      accept: 'application/pdf,.pdf',
      hidden: true,
      onChange: (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) replaceFile(meta, f);
      },
    });
    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'card-tools' },
        h('span', { class: 'card-title' }, meta.name, h('span', { class: 'muted' }, ` · ${meta.fileName} · ${formatSize(meta.size)}`)),
        h(
          'label',
          { class: 'radio' },
          h('input', {
            type: 'radio',
            name: 'default-resume',
            checked: meta.isDefault,
            onChange: async () => {
              await setDefaultResume(meta.id);
              resumes = await listResumes();
              draw();
              showToast('Default updated');
            },
          }),
          'Default',
        ),
        h('button', { class: 'ghost', onClick: () => open(meta) }, 'Open'),
        h('button', { class: 'ghost', onClick: () => replaceInput.click() }, 'Replace file'),
        replaceInput,
        h(
          'button',
          {
            class: 'ghost danger',
            onClick: async () => {
              if (!confirm(`Delete "${meta.name}"?`)) return;
              await deleteResume(meta.id);
              resumes = await listResumes();
              if (meta.isDefault && resumes[0]) await setDefaultResume(resumes[0].id);
              resumes = await listResumes();
              draw();
            },
          },
          'Delete',
        ),
      ),
      textField('Name', meta, 'name', save),
    );
  }

  const drop = h(
    'div',
    {
      class: 'dropzone',
      onClick: () => fileInput.click(),
      onDragover: (e: Event) => {
        e.preventDefault();
        drop.classList.add('over');
      },
      onDragleave: () => drop.classList.remove('over'),
      onDrop: (e: Event) => {
        e.preventDefault();
        drop.classList.remove('over');
        addFiles([...((e as DragEvent).dataTransfer?.files ?? [])]);
      },
    },
    'Drop PDF resumes here or click to upload',
    fileInput,
  );

  function draw() {
    list.replaceChildren(
      ...(resumes.length ? resumes.map(card) : [h('p', { class: 'muted' }, 'No resumes yet.')]),
    );
    onLibraryChange();
  }
  draw();

  return h(
    'section',
    { id: 'resumes' },
    h('h2', {}, 'Resumes'),
    h('p', { class: 'intro' }, 'PDFs are stored in this browser (IndexedDB). The default is used when no rule matches.'),
    drop,
    list,
  );
}

export async function rulesSection(rules: ResumeRule[]): Promise<HTMLElement> {
  const save = debounce(() => saveRules(rules));
  const list = h('div', { class: 'rules' });

  function resumeSelect(rule: ResumeRule): HTMLSelectElement {
    const sel = h(
      'select',
      {
        onChange: (e: Event) => {
          rule.resumeId = (e.target as HTMLSelectElement).value;
          save();
        },
      },
      h('option', { value: '' }, '— choose resume —'),
      ...resumes.map((r) => h('option', { value: r.id }, r.name)),
    );
    sel.value = rule.resumeId;
    return sel;
  }

  function draw() {
    list.replaceChildren(
      ...rules.map((rule, i) =>
        h(
          'div',
          { class: 'rule' },
          h('span', { class: 'muted' }, `${i + 1}.`),
          listField('Keywords', rule, 'keywords', save, { placeholder: 'software, backend' }),
          h('span', { class: 'arrow' }, '→'),
          resumeSelect(rule),
          h('button', { class: 'ghost', disabled: i === 0, title: 'Move up (earlier rules win ties)', onClick: () => move(i, -1) }, '↑'),
          h(
            'button',
            {
              class: 'ghost danger',
              onClick: () => {
                rules.splice(i, 1);
                save();
                draw();
              },
            },
            '✕',
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'add',
          onClick: () => {
            rules.push({ id: uid(), keywords: [], resumeId: '' });
            save();
            draw();
          },
        },
        '+ Add rule',
      ),
    );
  }
  function move(i: number, delta: number) {
    const [r] = rules.splice(i, 1);
    rules.splice(i + delta, 0, r);
    save();
    draw();
  }
  onLibraryChange = draw;
  draw();

  // Quick way to check what the rules would pick without visiting a job page.
  const testTitle = h('input', { type: 'text', placeholder: 'Try a job title, e.g. Senior Software Engineer' });
  const testOut = h('div', { class: 'muted' });
  testTitle.addEventListener('input', () => {
    const pick = pickResume(resumes, rules, { title: testTitle.value, text: '' });
    const name = resumes.find((r) => r.id === pick?.resumeId)?.name;
    testOut.textContent = testTitle.value && pick ? `→ ${name} (${pick.reason})` : '';
  });

  return h(
    'section',
    { id: 'rules' },
    h('h2', {}, 'Resume rules'),
    h(
      'p',
      { class: 'intro' },
      'Keywords match whole words, case-insensitive (so "ML" won\'t match "HTML"). The job title is checked first; ' +
        'if no rule matches it, the page text is checked. Ties go to the rule listed first. Otherwise the default resume is used.',
    ),
    list,
    h('div', { class: 'rule-test' }, testTitle, testOut),
  );
}
