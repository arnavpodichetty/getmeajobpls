import { browser } from 'wxt/browser';
import { h } from '../../lib/dom';
import { applyImport, mergeDrafts, PAGE_SOURCE_KEY, planImport, type ImportItem, type PageSource, type ProfileDraft } from '../../lib/profileImport';
import { getResume } from '../../lib/resumeDb';
import { saveProfile } from '../../lib/storage';
import { readResumeForProfile, readTextForProfile } from '../../lib/tailor';
import type { Profile, ResumeMeta } from '../../lib/types';
import { showToast } from './toast';

const shorten = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const looksEmpty = (d: ProfileDraft) =>
  !d.personal.firstName && !d.personal.email && !d.education.length && !d.experience.length && !d.projects.length && !d.skills.length;

/** Read a resume PDF on this device, without Claude. */
async function readOnDevice(file: Blob): Promise<ProfileDraft> {
  const [{ readPdfLines }, { parseResume }] = await Promise.all([import('../../lib/pdfText'), import('../../lib/resumeParse')]);
  let read;
  try {
    read = await readPdfLines(await file.arrayBuffer());
  } catch {
    throw new Error("That file couldn't be opened as a PDF.");
  }
  const draft = parseResume(read.lines, read.links);
  if (!read.lines.length) throw new Error('This PDF has no text to read (it may be a scanned image). Try Read with Claude, or type your profile in.');
  if (looksEmpty(draft)) throw new Error("Couldn't find the usual resume sections (Education, Experience, Skills) in this PDF. Try Read with Claude.");
  return draft;
}

/**
 * Options → Fill my profile: Read resume sorts a resume PDF into profile fields on this
 * device. Read with Claude reads a resume, a profile page (picked with the
 * toolbar popup) and pasted text into profile fields, through the resume tailoring
 * helper. You tick what to keep before anything is saved.
 */
export function importSection(opts: {
  resumes: ResumeMeta[];
  /** A page handed over by the popup's "Use this page for my profile". */
  page: PageSource | null;
  /** Resume tailoring is on, so the helper can be reached. */
  enabled: boolean;
  profile: () => Profile;
  onApplied: () => Promise<void>;
}): HTMLElement {
  const own = opts.resumes.filter((r) => !r.tailoredFrom);
  const picked = own.find((r) => r.isDefault) ?? own[0];
  let page = opts.page;

  const resumeSel = h(
    'select',
    {},
    h('option', { value: '' }, own.length ? 'No resume' : 'No resumes uploaded'),
    ...own.map((r) => h('option', { value: r.id, selected: r.id === picked?.id }, r.name)),
  );
  const pageRow = h('div', { class: 'import-source' });
  const paste = h('textarea', {
    rows: 4,
    placeholder: 'Optional: paste anything about you, like a LinkedIn About and Experience section, a Simplify profile or a bio.',
  });
  const status = h('span', { class: 'hint' });
  const localStatus = h('span', { class: 'hint' });
  const review = h('div', { class: 'import-review', hidden: true });

  async function readLocal(source: () => Promise<{ blob: Blob; name: string } | null>): Promise<void> {
    localStatus.className = 'hint';
    review.hidden = true;
    try {
      const file = await source();
      if (!file) {
        localStatus.className = 'hint err';
        localStatus.textContent = 'Pick a resume or choose a PDF first.';
        return;
      }
      if (file.blob.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Only PDFs can be read on this device. Try Read with Claude for other files.');
      localStatus.textContent = 'Reading…';
      const items = planImport(opts.profile(), await readOnDevice(file.blob));
      localStatus.textContent = items.length ? 'Check each value before applying: the layout is read by rules, not by Claude.' : 'Your profile already has everything this resume says.';
      showReview(items, []);
    } catch (err) {
      localStatus.textContent = err instanceof Error ? err.message : String(err);
      localStatus.className = 'hint err';
    }
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    hidden: true,
    onChange: async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) await readLocal(async () => ({ blob: f, name: f.name }));
    },
  }) as HTMLInputElement;
  const readResume = h('button', {
    onClick: () =>
      readLocal(async () => {
        if (!resumeSel.value) return null;
        const rec = await getResume(resumeSel.value);
        if (!rec) throw new Error('That resume is no longer in your library.');
        return { blob: rec.blob, name: rec.name };
      }),
  }, 'Read resume');
  const choosePdf = h('button', { class: 'secondary', onClick: () => fileInput.click() }, 'Choose a PDF…');

  function drawPage(): void {
    pageRow.replaceChildren(
      ...(page
        ? [
            h('span', {}, 'Page: ', h('strong', { title: page.url }, shorten(page.title || page.url, 70))),
            h('button', {
              class: 'ghost',
              onClick: async () => {
                page = null;
                await browser.storage.session.remove(PAGE_SOURCE_KEY);
                drawPage();
              },
            }, 'Remove'),
          ]
        : [
            h('span', { class: 'hint' }, 'To use a profile page (Simplify, LinkedIn, Handshake, your website), open it and click "Use this page for my profile" in the toolbar popup.'),
          ]),
    );
  }
  drawPage();

  const read = h('button', {
    disabled: !opts.enabled,
    onClick: async () => {
      const steps: { label: string; run: () => Promise<{ draft: ProfileDraft; dropped: string[] }> }[] = [];
      if (resumeSel.value) steps.push({ label: 'your resume', run: () => readResumeForProfile(resumeSel.value) });
      if (page) {
        const p = page;
        steps.push({ label: 'the page', run: () => readTextForProfile({ ...p, kind: 'page' }) });
      }
      const pasted = paste.value.trim();
      if (pasted) steps.push({ label: 'the pasted text', run: () => readTextForProfile({ title: '', url: '', text: pasted, kind: 'paste' }) });
      if (!steps.length) {
        status.className = 'hint err';
        status.textContent = 'Pick a resume, add a page, or paste some text first.';
        return;
      }

      read.disabled = true;
      review.hidden = true;
      status.className = 'hint';
      const drafts: ProfileDraft[] = [];
      const dropped: string[] = [];
      try {
        for (const [i, step] of steps.entries()) {
          status.textContent = `Claude is reading ${step.label}${steps.length > 1 ? ` (${i + 1} of ${steps.length})` : ''}… about a minute`;
          const result = await step.run();
          drafts.push(result.draft);
          dropped.push(...result.dropped.map((d) => (steps.length > 1 ? `From ${step.label}: ${d}` : d)));
        }
        const items = planImport(opts.profile(), mergeDrafts(drafts));
        status.textContent = items.length ? '' : 'Your profile already has everything these sources say.';
        showReview(items, dropped);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        status.className = 'hint err';
      } finally {
        read.disabled = !opts.enabled;
      }
    },
  }, 'Read with Claude');

  function showReview(items: ImportItem[], dropped: string[]): void {
    const chosen = new Set(items.filter((i) => i.checked).map((i) => i.id));
    const groups = [...new Set(items.map((i) => i.group))];
    const apply = h('button', {
      onClick: async () => {
        // A second click would add the new entries twice.
        if (apply.disabled) return;
        apply.disabled = true;
        const profile = opts.profile();
        const n = applyImport(profile, items, chosen);
        await saveProfile(profile);
        // The page's text was only needed for this; don't keep it around.
        await browser.storage.session.remove(PAGE_SOURCE_KEY);
        showToast(`Added ${n} change${n === 1 ? '' : 's'} to your profile`);
        await opts.onApplied();
      },
    }, '');
    const count = () => {
      apply.textContent = `Apply ${chosen.size} change${chosen.size === 1 ? '' : 's'}`;
      apply.disabled = !chosen.size;
    };
    count();

    review.replaceChildren(
      ...(items.length
        ? [
            h('p', { class: 'intro' }, 'Empty fields and new entries are ticked. A change to something you already filled starts unticked. Nothing is saved until you apply.'),
            ...groups.map((g) =>
              h(
                'div',
                { class: 'import-group' },
                h('h3', {}, g),
                ...items.filter((i) => i.group === g).map((item) => {
                  const box = h('input', {
                    type: 'checkbox',
                    checked: chosen.has(item.id),
                    onChange: () => {
                      if (box.checked) chosen.add(item.id);
                      else chosen.delete(item.id);
                      count();
                    },
                  });
                  return h(
                    'label',
                    { class: 'check import-item' },
                    box,
                    h(
                      'span',
                      {},
                      item.label,
                      h('small', { title: item.proposed }, item.current ? `Now: ${shorten(item.current, 80)} → ${shorten(item.proposed)}` : shorten(item.proposed)),
                    ),
                  );
                }),
              ),
            ),
            h('div', { class: 'row' }, apply, h('button', { class: 'secondary', onClick: () => { review.hidden = true; } }, 'Discard')),
          ]
        : []),
      ...(dropped.length
        ? [
            h(
              'details',
              { class: 'import-dropped' },
              h('summary', {}, `Left out: ${dropped.length} value${dropped.length === 1 ? '' : 's'} the sources don't actually say`),
              h('ul', {}, ...dropped.map((d) => h('li', {}, d))),
            ),
          ]
        : []),
    );
    review.hidden = !items.length && !dropped.length;
  }

  return h(
    'section',
    { id: 'import' },
    h('h2', {}, 'Fill my profile'),
    h(
      'p',
      { class: 'intro' },
      'Fill your profile from your resume instead of typing it in. Read resume works on this device with any PDF that has selectable text: it copies your contact info, links, education, jobs, projects and skills straight from the resume. ' +
        'You choose what to keep, and standard answers and EEO are never changed.',
    ),
    h('label', { class: 'field' }, h('span', {}, 'Resume'), resumeSel),
    h('div', { class: 'row' }, readResume, choosePdf, fileInput, localStatus),
    h('h3', {}, 'Read with Claude'),
    h(
      'p',
      { class: 'intro' },
      'Claude can also read the resume above, a profile page or pasted text, and handles unusual layouts better. Your own Claude account reads them, through the same helper as Resume tailoring. ' +
        'Every value is checked against the source text, and descriptions and skills are copied word for word.',
    ),
    !opts.enabled
      ? h('p', { class: 'notice' }, 'Turn on ', h('a', { href: '#tailoring' }, 'Resume tailoring'), ' and finish its setup first. This uses the same helper.')
      : null,
    pageRow,
    h('label', { class: 'field' }, h('span', {}, 'Pasted text'), paste),
    h('div', { class: 'row' }, read, status),
    review,
  );
}
