// Floating panel shown on application pages so you don't have to open the
// toolbar popup. Lives in a closed shadow root: the page's CSS can't touch it,
// and the filler never mistakes its controls for application fields.
import { browser } from 'wxt/browser';
import { boltIcon, h } from './dom';
import type { PanelResponse, PanelRequest } from './messages';
import { requestResumeFile, sendPanel } from './messages';
import { base64ToBlob } from './resumeDb';
import { downloadCapture } from './captureDownload';
import type { FillReport } from './types';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
[hidden] { display: none !important; }
.wrap {
  position: fixed; top: 12px; right: 12px; z-index: 2147483646; width: 168px;
  display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 1.35; color: #1d1d1b;
}
.bar { display: flex; align-items: stretch; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.22); overflow: hidden; touch-action: none; }
.grip { display: flex; align-items: center; padding: 0 2px 0 6px; background: #2f6f5e; color: rgba(255,255,255,.55); cursor: grab; font-size: 13px; letter-spacing: -2px; user-select: none; }
.grip:hover { color: #fff; }
.wrap.dragging, .wrap.dragging * { cursor: grabbing !important; user-select: none; }
.fill { all: unset; cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 650; font-size: 13px; padding: 9px 6px; background: #2f6f5e; color: #fff; }
.fill:hover { background: #285f50; }
.fill[aria-disabled="true"] { opacity: .7; cursor: default; }
.icon { all: unset; cursor: pointer; padding: 0 8px; display: flex; align-items: center; background: #2f6f5e; color: #d7ebe4; border-left: 1px solid rgba(255,255,255,.18); font-size: 13px; }
.icon:hover { color: #fff; background: #285f50; }
.box { background: #fff; border: 1px solid #e2e1dc; border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.12); display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.summary { all: unset; cursor: pointer; font-weight: 600; }
.summary .rev { color: #c26a00; }
.muted, li small { color: #6b6b66; }
select { width: 100%; font: inherit; padding: 4px 6px; border: 1px solid #e2e1dc; border-radius: 5px; background: #fff; color: inherit; }
ul { margin: 0; padding-left: 14px; max-height: 220px; overflow: auto; }
li { margin-bottom: 4px; } li small { display: block; }
.link { all: unset; cursor: pointer; color: #2f6f5e; font-weight: 500; }
.capture, .tailor { cursor: pointer; padding: 7px 10px; border: 1px solid #e2e1dc; border-radius: 8px; background: #fff; color: #2f6f5e; font: inherit; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.capture:disabled, .tailor:disabled { opacity: .6; cursor: wait; }
.warn { color: #c26a00; }
.notice { border-left: 3px solid #c26a00; padding: 2px 0 2px 7px; color: #6b4a1d; }
.changes { margin-top: 2px; }
.err { color: #b4412f; }
@media (prefers-color-scheme: dark) {
  .wrap { color: #ecebe6; }
  .box { background: #1f1f1d; border-color: #34332f; }
  .muted, li small { color: #9b9a93; }
  select { background: #161615; border-color: #34332f; }
  .link { color: #5cb399; }
  .capture, .tailor { background: #1f1f1d; border-color: #34332f; color: #5cb399; }
  .notice { color: #e2b77a; }
}
`;

/** Where you dragged the panel to (viewport px), shared by every site. */
const POS_KEY = 'panelPosition';
/** Pointer travel before a press on the bar counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;

export class FillPanel {
  private host = document.createElement('getmeajobpls-panel');
  private root = this.host.attachShadow({ mode: 'closed' });
  private body = h('div');
  private resumeSel = h('select');
  private skillSel = h('select');
  private fillBtn = h('div', { class: 'fill', role: 'button', tabindex: 0, title: '' });
  private captureBtn = h('button', { class: 'capture', title: 'Download a snapshot of this form to report an autofill issue' }, 'Capture page');
  private tailorBtn = h('button', { class: 'tailor', title: 'Rewrite the selected resume for this posting with your Claude account, then use it for the upload' }, 'Tailor resume');
  private setFillLabel(text: string): void {
    this.fillBtn.replaceChildren(boltIcon(13), text);
  }
  private status = h('div', { class: 'box', hidden: true });
  private details = h('div', { class: 'box', hidden: true });
  private siteEl = h('div', { class: 'muted' });
  private reasonEl = h('div', { class: 'muted' });
  private reviewList = h('ul', { hidden: true });
  private skillSetByResume: Record<string, string> = {};
  private wrap = h('div', { class: 'wrap' });
  private pos: { left: number; top: number } | null = null;
  /** Set right after a drag so the click that ends it doesn't press a button. */
  private justDragged = false;
  private busy = false;
  /** Set when you close the panel with ×; it stays closed for the rest of this page. */
  dismissed = false;

  constructor(private onDismiss: () => void = () => {}) {
    this.root.append(h('style', {}, CSS), this.body);
    this.setFillLabel('Fill page');
    this.fillBtn.addEventListener('click', () => this.fill());
    this.fillBtn.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && this.fill());
    this.captureBtn.addEventListener('click', () => { void this.capture(); });
    this.tailorBtn.addEventListener('click', () => { void this.tailor(); });
    this.resumeSel.addEventListener('change', () => {
      this.reasonEl.textContent = '';
      // Switching the resume switches the skills to match; change skills after that to mix them.
      const skills = this.skillSetByResume[this.resumeSel.value];
      if (skills) this.skillSel.value = skills;
    });
    this.wrap.addEventListener('click', (e) => {
      if (!this.justDragged) return;
      this.justDragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    window.addEventListener('resize', () => this.applyPosition());
    void browser.storage.local.get(POS_KEY).then((r) => {
      const p = r[POS_KEY] as { left?: unknown; top?: unknown } | undefined;
      if (typeof p?.left === 'number' && typeof p.top === 'number') {
        this.pos = { left: p.left, top: p.top };
        this.applyPosition();
      }
    }, () => {});
  }

  /** Put the panel where you left it, kept fully on screen. */
  private applyPosition(): void {
    if (!this.pos) {
      this.wrap.style.removeProperty('left');
      this.wrap.style.removeProperty('top');
      this.wrap.style.removeProperty('right');
      return;
    }
    const w = this.wrap.offsetWidth || 168;
    const barH = 40;
    const left = Math.min(Math.max(0, this.pos.left), Math.max(0, window.innerWidth - w));
    const top = Math.min(Math.max(0, this.pos.top), Math.max(0, window.innerHeight - barH));
    this.wrap.style.left = `${left}px`;
    this.wrap.style.top = `${top}px`;
    this.wrap.style.right = 'auto';
  }

  /** Drag the panel by its green bar; a press that barely moves stays a click. */
  private makeDraggable(bar: HTMLElement): void {
    bar.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      const start = this.wrap.getBoundingClientRect();
      let dragging = false;
      const move = (e: PointerEvent) => {
        const dx = e.clientX - down.clientX;
        const dy = e.clientY - down.clientY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          this.wrap.classList.add('dragging');
        }
        this.pos = { left: start.left + dx, top: start.top + dy };
        this.applyPosition();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!dragging) return;
        this.wrap.classList.remove('dragging');
        this.justDragged = true;
        // A drag that ends off the bar fires no click; don't swallow the next real one.
        setTimeout(() => (this.justDragged = false), 0);
        const rect = this.wrap.getBoundingClientRect();
        this.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
        void browser.storage.local.set({ [POS_KEY]: this.pos }).catch(() => {});
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** Double-click the grip to put the panel back on the right edge. */
  private resetPosition(): void {
    this.pos = null;
    this.applyPosition();
    void browser.storage.local.remove(POS_KEY).catch(() => {});
  }

  get shown(): boolean {
    return this.host.isConnected;
  }

  show(state: Extract<PanelResponse, { kind: 'state' }>): void {
    if (this.dismissed) return;
    this.siteEl.textContent = state.atsLabel;
    // A tailored resume picked on this page stays picked when a multi-step form changes URL.
    const keep = this.resumeSel.selectedOptions[0]?.dataset.tailored ? this.resumeSel.value : null;
    this.resumeSel.replaceChildren(
      h('option', { value: '' }, state.resumes.length ? 'None (skip upload)' : 'None uploaded'),
      ...state.resumes.map((r) => h('option', { value: r.id, 'data-tailored': r.tailoredFrom ? '1' : '', 'data-from': r.tailoredFrom ?? '' }, r.name)),
    );
    this.resumeSel.value = keep && state.resumes.some((r) => r.id === keep) ? keep : state.pickedResumeId ?? '';
    this.skillSel.replaceChildren(
      ...(state.skillSets.length ? state.skillSets.map((x) => h('option', { value: x.id }, x.name || 'Unnamed')) : [h('option', { value: '' }, 'Profile skills')]),
    );
    this.skillSetByResume = state.skillSetByResume;
    this.skillSel.value = (keep && state.skillSetByResume[keep]) || (state.pickedSkillSetId ?? '');
    this.reasonEl.textContent = this.resumeSel.value === keep && keep ? 'Tailored for this posting' : state.pickReason;
    this.captureBtn.hidden = !state.showCapture;
    this.tailorBtn.hidden = !state.canTailor;
    this.fillBtn.title = `Fill this ${state.atsLabel} application`;
    if (!this.host.isConnected) {
      this.render();
      document.documentElement.append(this.host);
    }
  }

  remove(): void {
    this.host.remove();
  }

  private dismiss(): void {
    this.dismissed = true;
    this.remove();
    this.onDismiss();
  }

  private render(): void {
    const toggle = (box: HTMLElement) => (box.hidden = !box.hidden);
    this.details.replaceChildren(
      this.siteEl,
      h('div', { class: 'muted' }, 'Resume'),
      this.resumeSel,
      this.reasonEl,
      h('div', { class: 'muted' }, 'Skills'),
      this.skillSel,
      h('button', { class: 'link', onClick: () => this.saveAnswers() }, 'Save my answers'),
      h('button', { class: 'link', onClick: () => sendPanel({ type: 'panel:options' }) }, 'Profile ↗'),
    );
    const bar = h(
      'div',
      { class: 'bar' },
      h('span', { class: 'grip', title: 'Drag to move · double-click to reset', onDblclick: () => this.resetPosition() }, '⋮⋮'),
      this.fillBtn,
      h('button', { class: 'icon', title: 'Resume & options', onClick: () => toggle(this.details) }, '⋯'),
      h('button', { class: 'icon', title: 'Hide on this page', onClick: () => this.dismiss() }, '×'),
    );
    this.makeDraggable(bar);
    this.wrap.replaceChildren(bar, this.tailorBtn, this.captureBtn, this.status, this.details);
    this.body.replaceChildren(this.wrap);
    this.applyPosition();
  }

  private async capture(): Promise<void> {
    if (this.captureBtn.disabled) return;
    this.captureBtn.disabled = true;
    this.captureBtn.textContent = 'Capturing…';
    try {
      const response = await sendPanel({ type: 'panel:capture' });
      if (response.kind === 'error') throw new Error(response.error);
      if (response.kind !== 'capture') throw new Error('Could not capture this page. Refresh the page and try again.');
      const name = downloadCapture(response);
      this.status.replaceChildren(
        h('div', {}, `Downloaded ${name}`),
        h('div', { class: 'muted' }, 'Attach the HTML file in chat or share its local file path so the form can be inspected.'),
      );
    } catch (err) {
      this.status.replaceChildren(h('div', { class: 'err' }, `Capture failed: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      this.status.hidden = false;
      this.captureBtn.disabled = false;
      this.captureBtn.textContent = 'Capture page';
    }
  }

  /** Tailor the selected resume to this posting, then select the tailored copy for upload. */
  private async tailor(): Promise<void> {
    if (this.tailorBtn.disabled) return;
    const option = this.resumeSel.selectedOptions[0];
    // With a tailored copy picked, tailor again from the resume it came from.
    const baseId = option?.dataset.from || this.resumeSel.value;
    const baseName = [...this.resumeSel.options].find((o) => o.value === baseId)?.textContent ?? '';
    if (!baseId || !baseName) {
      this.status.replaceChildren(h('div', { class: 'err' }, 'Pick a resume under ⋯ first.'));
      this.status.hidden = false;
      return;
    }
    this.tailorBtn.disabled = true;
    this.tailorBtn.textContent = 'Tailoring… (~30s)';
    this.status.replaceChildren(h('div', { class: 'muted' }, `Claude is tailoring "${baseName}" to this posting. The first time for each resume takes longer.`));
    this.status.hidden = false;
    try {
      const res = await sendPanel({ type: 'panel:tailor', resumeId: baseId });
      if (res.kind === 'error') throw new Error(res.error);
      if (res.kind !== 'tailored') throw new Error('No answer from the extension. Refresh the page and try again.');
      if (![...this.resumeSel.options].some((o) => o.value === res.resumeId)) {
        this.resumeSel.append(h('option', { value: res.resumeId, 'data-tailored': '1', 'data-from': baseId }, `Tailored for ${res.name}`));
      }
      this.resumeSel.value = res.resumeId;
      this.reasonEl.textContent = 'Tailored for this posting';
      // Shown open: the notes flag rewordings worth a look before you submit.
      const changes = h('ul', { class: 'changes' }, ...res.changes.map((c) => h('li', {}, c)));
      this.status.replaceChildren(
        h('div', {}, res.reused ? 'Using the resume you already tailored for this job. Fill page will upload it.' : 'Tailored resume ready. Fill page will upload it.'),
        ...(res.reused ? [h('div', { class: 'muted' }, 'To tailor it again, delete it under Profile → Resumes → Tailored resumes.')] : []),
        // Shown every time: the guard catches invented numbers and tools, not every wrong emphasis or wording.
        h('div', { class: 'notice' }, 'Written with AI, which can get things wrong. Read the whole PDF before you submit and fix anything inaccurate: you are responsible for what you send.'),
        ...res.warnings.map((w) => h('div', { class: 'warn' }, w)),
        h('button', { class: 'link', onClick: () => this.preview(res.resumeId) }, 'Preview PDF ↗'),
        ...(res.changes.length ? [h('button', { class: 'link', onClick: () => (changes.hidden = !changes.hidden) }, 'What changed ⌄')] : []),
        changes,
      );
    } catch (err) {
      this.status.replaceChildren(h('div', { class: 'err' }, `Tailoring failed: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      this.status.hidden = false;
      this.tailorBtn.disabled = false;
      this.tailorBtn.textContent = 'Tailor resume';
    }
  }

  private async preview(resumeId: string): Promise<void> {
    const file = await requestResumeFile(resumeId);
    if (!file) return;
    const url = URL.createObjectURL(base64ToBlob(file.base64, file.meta.mimeType));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async fill(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.fillBtn.setAttribute('aria-disabled', 'true');
    this.setFillLabel('Filling…');
    this.status.hidden = true;
    try {
      const res = await sendPanel({ type: 'panel:fill', resumeId: this.resumeSel.value || null, skillSetId: this.skillSel.value || null });
      if (res.kind === 'reports') this.showReports(res.reports);
      else if (res.kind === 'error') {
        this.status.replaceChildren(h('div', { class: 'err' }, res.error));
        this.status.hidden = false;
      }
    } finally {
      this.busy = false;
      this.fillBtn.removeAttribute('aria-disabled');
      this.setFillLabel('Fill page');
    }
  }

  private showReports(reports: FillReport[]): void {
    const filled = reports.reduce((n, r) => n + r.filled, 0);
    const review = reports.flatMap((r) => r.fields.filter((f) => f.status === 'review'));
    this.reviewList.replaceChildren(...review.map((f) => h('li', {}, f.label.slice(0, 80), f.reason ? h('small', {}, f.reason) : null)));
    this.reviewList.hidden = true;
    const summary = h(
      'button',
      { class: 'summary', title: review.length ? 'Show what needs review' : '' },
      `${filled} filled`,
      review.length ? h('span', { class: 'rev' }, ` · ${review.length} to review ›`) : '',
    );
    summary.addEventListener('click', () => (this.reviewList.hidden = !this.reviewList.hidden));
    this.status.replaceChildren(summary, this.reviewList);
    this.status.hidden = false;
  }

  private async saveAnswers(): Promise<void> {
    const res = await sendPanel({ type: 'panel:saveAnswers' } satisfies PanelRequest);
    const text =
      res.kind === 'saved'
        ? res.added || res.updated
          ? `Saved ${res.added} new answer${res.added === 1 ? '' : 's'}${res.updated ? `, updated ${res.updated}` : ''}.`
          : 'No new answers to save on this page.'
        : res.kind === 'error'
          ? res.error
          : '';
    this.status.append(h('div', { class: 'muted' }, text));
    this.status.hidden = false;
  }
}
