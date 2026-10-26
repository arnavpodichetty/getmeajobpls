import { h } from '../../lib/dom';
import { uid } from '../../lib/defaults';
import {
  deleteResume,
  getResume,
  getTranscript,
  TRANSCRIPT_ID,
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
    let added = 0;
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
        isDefault: !resumes.some((r) => !r.tailoredFrom),
        blob: file,
      });
      resumes = await listResumes();
      added++;
    }
    draw();
    // Don't cover a "not a PDF" error with "Uploaded" when nothing was.
    if (added) showToast('Uploaded');
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
        const input = e.target as HTMLInputElement;
        const f = input.files?.[0];
        // Cleared so picking the same file again still counts as a change.
        input.value = '';
        if (f) void replaceFile(meta, f);
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
              const next = resumes.find((r) => !r.tailoredFrom);
              if (meta.isDefault && next) await setDefaultResume(next.id);
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

  /** One compact row per tailored copy; they're picked from the on-page panel, never as the default or by rules. */
  function tailoredRow(meta: ResumeMeta): HTMLElement {
    const date = new Date(meta.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const base = resumes.find((r) => r.id === meta.tailoredFrom)?.name;
    return h(
      'div',
      { class: 'tailored-row' },
      h('span', { class: 'card-title' }, meta.tailoredFor ?? meta.name, h('span', { class: 'muted' }, ` · ${base ? `from ${base} · ` : ''}${date} · ${formatSize(meta.size)}`)),
      h('button', { class: 'ghost', onClick: () => open(meta) }, 'Open'),
      h(
        'button',
        {
          class: 'ghost danger',
          onClick: async () => {
            await deleteResume(meta.id);
            resumes = await listResumes();
            draw();
          },
        },
        'Delete',
      ),
    );
  }

  let tailoredOpen = false;
  function draw() {
    const own = resumes.filter((r) => !r.tailoredFrom);
    const tailored = resumes.filter((r) => r.tailoredFrom).sort((a, b) => b.uploadedAt - a.uploadedAt);
    const box = h(
      'details',
      { class: 'tailored', open: tailoredOpen },
      h('summary', {}, `Tailored resumes (${tailored.length})`),
      h(
        'div',
        { class: 'tailored-list' },
        ...tailored.map(tailoredRow),
        h(
          'button',
          {
            class: 'ghost danger',
            onClick: async () => {
              if (!confirm(`Delete all ${tailored.length} tailored resumes?`)) return;
              for (const r of tailored) await deleteResume(r.id);
              resumes = await listResumes();
              draw();
            },
          },
          'Delete all',
        ),
      ),
    );
    box.addEventListener('toggle', () => (tailoredOpen = box.open));
    list.replaceChildren(
      ...(own.length ? own.map(card) : [h('p', { class: 'muted' }, 'No resumes yet.')]),
      ...(tailored.length ? [box] : []),
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

/** One transcript PDF, attached to "upload your unofficial transcript" fields. */
export async function transcriptSection(): Promise<HTMLElement> {
  const body = h('div', { class: 'cards' });

  async function save(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return showToast(`${file.name} is not a PDF`, true);
    if (file.size > MAX_BYTES) return showToast(`${file.name} is over 10 MB`, true);
    await putResume({
      id: TRANSCRIPT_ID,
      kind: 'transcript',
      name: 'Transcript',
      tags: [],
      skills: [],
      fileName: file.name,
      mimeType: 'application/pdf',
      size: file.size,
      uploadedAt: Date.now(),
      isDefault: false,
      blob: file,
    });
    await draw();
    showToast('Transcript saved');
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    hidden: true,
    onChange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) await save(file);
    },
  });

  async function draw() {
    const rec = await getTranscript();
    if (!rec) {
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
            const file = (e as DragEvent).dataTransfer?.files?.[0];
            if (file) void save(file);
          },
        },
        'Drop your unofficial transcript (PDF) here or click to upload',
      );
      body.replaceChildren(drop);
      return;
    }
    body.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'card-tools', style: 'margin-bottom:0' },
          h('span', { class: 'card-title' }, 'Transcript', h('span', { class: 'muted' }, ` · ${rec.fileName} · ${formatSize(rec.size)}`)),
          h(
            'button',
            {
              class: 'ghost',
              onClick: () => {
                const url = URL.createObjectURL(rec.blob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              },
            },
            'Open',
          ),
          h('button', { class: 'ghost', onClick: () => fileInput.click() }, 'Replace file'),
          h(
            'button',
            {
              class: 'ghost danger',
              onClick: async () => {
                if (!confirm('Delete your transcript?')) return;
                await deleteResume(TRANSCRIPT_ID);
                await draw();
              },
            },
            'Delete',
          ),
        ),
      ),
    );
  }
  await draw();

  return h(
    'section',
    { id: 'transcript' },
    h('h2', {}, 'Transcript'),
    h(
      'p',
      { class: 'intro' },
      'Attached to upload fields that ask for your transcript (e.g. "Please upload a copy of your unofficial transcript"), on Greenhouse, Workday and other sites. Stored in this browser like your resumes.',
    ),
    body,
    fileInput,
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
      ...resumes.filter((r) => !r.tailoredFrom).map((r) => h('option', { value: r.id }, r.name)),
    );
    // A rule pointing at a deleted resume shows "choose resume" instead of a blank box.
    sel.value = resumes.some((r) => r.id === rule.resumeId && !r.tailoredFrom) ? rule.resumeId : '';
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
