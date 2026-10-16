// Floating panel shown on application pages so you don't have to open the
// toolbar popup. Lives in a closed shadow root: the page's CSS can't touch it,
// and the filler never mistakes its controls for application fields.
import { boltIcon, h } from './dom';
import type { PanelResponse, PanelRequest } from './messages';
import { sendPanel } from './messages';
import { downloadCapture } from './captureDownload';
import type { FillReport } from './types';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
[hidden] { display: none !important; }
.wrap {
  position: fixed; top: 45%; right: 12px; z-index: 2147483646; width: 168px;
  display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 1.35; color: #1d1d1b;
}
.bar { display: flex; align-items: stretch; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.22); overflow: hidden; }
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
.capture { cursor: pointer; padding: 7px 10px; border: 1px solid #e2e1dc; border-radius: 8px; background: #fff; color: #2f6f5e; font: inherit; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.capture:disabled { opacity: .6; cursor: wait; }
.err { color: #b4412f; }
@media (prefers-color-scheme: dark) {
  .wrap { color: #ecebe6; }
  .box { background: #1f1f1d; border-color: #34332f; }
  .muted, li small { color: #9b9a93; }
  select { background: #161615; border-color: #34332f; }
  .link { color: #5cb399; }
  .capture { background: #1f1f1d; border-color: #34332f; color: #5cb399; }
}
`;


export class FillPanel {
  private host = document.createElement('getmeajobpls-panel');
  private root = this.host.attachShadow({ mode: 'closed' });
  private body = h('div');
  private resumeSel = h('select');
  private skillSel = h('select');
  private fillBtn = h('div', { class: 'fill', role: 'button', tabindex: 0, title: '' });
  private captureBtn = h('button', { class: 'capture', title: 'Download a snapshot of this form to report an autofill issue' }, 'Capture page');
  private setFillLabel(text: string): void {
    this.fillBtn.replaceChildren(boltIcon(13), text);
  }
  private status = h('div', { class: 'box', hidden: true });
  private details = h('div', { class: 'box', hidden: true });
  private siteEl = h('div', { class: 'muted' });
  private reasonEl = h('div', { class: 'muted' });
  private reviewList = h('ul', { hidden: true });
  private busy = false;
  /** Set when you close the panel with ×; it stays closed for the rest of this page. */
  dismissed = false;

  constructor(private onDismiss: () => void = () => {}) {
    this.root.append(h('style', {}, CSS), this.body);
    this.setFillLabel('Fill page');
    this.fillBtn.addEventListener('click', () => this.fill());
    this.fillBtn.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && this.fill());
    this.captureBtn.addEventListener('click', () => { void this.capture(); });
    this.resumeSel.addEventListener('change', () => (this.reasonEl.textContent = ''));
  }

  get shown(): boolean {
    return this.host.isConnected;
  }

  show(state: Extract<PanelResponse, { kind: 'state' }>): void {
    if (this.dismissed) return;
    this.siteEl.textContent = state.atsLabel;
    this.resumeSel.replaceChildren(
      h('option', { value: '' }, state.resumes.length ? 'None (skip upload)' : 'None uploaded'),
      ...state.resumes.map((r) => h('option', { value: r.id }, r.name)),
    );
    this.resumeSel.value = state.pickedResumeId ?? '';
    this.skillSel.replaceChildren(
      ...(state.skillSets.length ? state.skillSets.map((x) => h('option', { value: x.id }, x.name || 'Unnamed')) : [h('option', { value: '' }, 'Profile skills')]),
    );
    this.skillSel.value = state.pickedSkillSetId ?? '';
    this.reasonEl.textContent = state.pickReason;
    this.captureBtn.hidden = !state.showCapture;
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
    this.body.replaceChildren(
      h(
        'div',
        { class: 'wrap' },
        h(
          'div',
          { class: 'bar' },
          this.fillBtn,
          h('button', { class: 'icon', title: 'Resume & options', onClick: () => toggle(this.details) }, '⋯'),
          h('button', { class: 'icon', title: 'Hide on this page', onClick: () => this.dismiss() }, '×'),
        ),
        this.captureBtn,
        this.status,
        this.details,
      ),
    );
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
