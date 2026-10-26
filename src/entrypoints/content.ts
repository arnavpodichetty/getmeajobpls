import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { detectAdapter } from '../adapters';
import type { FillContext, ResumeFile } from '../adapters/types';
import { captureForm, collectAnswers } from '../lib/engine/capture';
import { isVisible } from '../lib/engine/dom';
import { isJobPosting } from '../lib/jobInfo';
import { FillPanel } from '../lib/panel';
import { sendPanel } from '../lib/messages';
import { scanFields } from '../lib/engine/scan';
import { looksLikeJobForm } from '../lib/engine/jobForm';
import type { ContentRequest, FrameInfo, PageText } from '../lib/messages';
import { requestResumeFile } from '../lib/messages';
import { base64ToBlob, TRANSCRIPT_ID } from '../lib/resumeDb';
import { loadProfile, loadSettings } from '../lib/storage';
import type { FillReport } from '../lib/types';

const PAGE_TEXT_LIMIT = 20_000;
/** After a fill, keep filling fields that appear (wizard steps, follow-ups) for this long. */
const WATCH_MS = 20 * 60_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  // Start once the HTML is parsed, not after every image and script has loaded.
  runAt: 'document_end',
  main(ctx) {
    const adapter = () => detectAdapter(new URL(location.href), document);
    let lastContext: FillContext | null = null;
    let filling = false;

    // Reloading the extension disconnects content scripts in already-open
    // tabs. Catch in-flight failures and let WXT tear down their callbacks.
    async function runSafely(task: () => Promise<void>): Promise<void> {
      if (ctx.isInvalid) return;
      try {
        await task();
      } catch (err) {
        if (ctx.isInvalid || /extension context invalidated/i.test(err instanceof Error ? err.message : String(err))) {
          ctx.notifyInvalidated();
          return;
        }
        console.error('getmeajobpls:', err);
      }
    }

    function pageText(limit = PAGE_TEXT_LIMIT): PageText {
      const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';
      return { title: `${document.title} ${h1}`.trim(), text: (document.body?.innerText ?? '').slice(0, limit) };
    }

    /** Visible fields, and whether they look like a job application on an unrecognized site. */
    function formInfo(): { fieldCount: number; jobForm: boolean } {
      const fields = scanFields().filter((f) => isVisible(f.el));
      const headings = [...document.querySelectorAll('h1, h2')].map((h) => h.textContent ?? '').join(' ').slice(0, 2000);
      return {
        fieldCount: fields.filter((f) => f.kind !== 'file').length,
        jobForm: looksLikeJobForm(fields, { url: location.href, title: document.title, headings }),
      };
    }

    async function buildContext(resumeId: string | null, skillSetId: string | null): Promise<FillContext> {
      const load = async (id: string | null): Promise<ResumeFile | null> => {
        const payload = id ? await requestResumeFile(id) : null;
        if (!payload) return null;
        const blob = base64ToBlob(payload.base64, payload.meta.mimeType);
        return { meta: payload.meta, file: new File([blob], payload.meta.fileName, { type: payload.meta.mimeType }) };
      };
      const [profile, settings, resume, transcript] = await Promise.all([
        loadProfile(), loadSettings(), load(resumeId), load(TRANSCRIPT_ID).catch(() => null),
      ]);
      const skills = profile.skillSets.find((s) => s.id === skillSetId)?.skills;
      return { profile, resume, transcript, settings, skills };
    }

    async function fill(resumeId: string | null, skillSetId: string | null): Promise<FillReport> {
      if (filling) return { ats: adapter().name, filled: 0, needsReview: 0, fields: [], notes: ['A fill is already running on this page.'] };
      filling = true;
      try {
        const fillContext = await buildContext(resumeId, skillSetId);
        lastContext = fillContext;
        const report = await adapter().fill(fillContext);
        if (lastContext === fillContext && fillContext.settings.watchForNewFields) startWatching();
        return report;
      } finally {
        filling = false;
      }
    }

    // --- Multi-step forms: fill new fields as they appear -------------------

    let observer: MutationObserver | null = null;
    let debounce: number | undefined;
    let watchUntil = 0;

    function stopWatching(): void {
      observer?.disconnect();
      observer = null;
      clearTimeout(debounce);
      lastContext = null;
    }
    ctx.onInvalidated(stopWatching);

    function startWatching(): void {
      if (ctx.isInvalid) return;
      watchUntil = Date.now() + WATCH_MS;
      if (observer) return;
      observer = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = ctx.setTimeout(() => { void runSafely(fillNewFields); }, 1500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    async function fillNewFields(): Promise<void> {
      if (ctx.isInvalid) return;
      if (Date.now() > watchUntil) {
        stopWatching();
        return;
      }
      if (filling || !lastContext) return;
      filling = true;
      try {
        // The resume was handled on the first fill; don't re-attach it on each step.
        const report = await adapter().fill({ ...lastContext, incremental: true });
        if (!ctx.isInvalid && (report.filled || report.needsReview)) toast(`Filled ${report.filled} new field${report.filled === 1 ? '' : 's'}${report.needsReview ? `, ${report.needsReview} to review` : ''}.`);
      } finally {
        filling = false;
      }
    }

    function toast(text: string): void {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `<div style="position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:8px;background:#1d1d1b;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)">getmeajobpls — ${text.replace(/</g, '&lt;')}</div>`;
      document.documentElement.append(host);
      setTimeout(() => host.remove(), 4000);
    }

    // --- On-page panel (top frame only) ---------------------------------------

    if (window === window.top) {
      // Closing the panel also stops filling new fields, so changes you make by hand stay.
      const panel = new FillPanel(stopWatching);
      let lastUrl = '';
      let checking = false;
      let checkTimer: number | undefined;
      const stopAt = Date.now() + 15 * 60_000;
      // Scanning a form on an unrecognized site reads every field's label. Busy pages
      // (mail, chat, docs) change constantly, so space those scans out; a later check still runs.
      const FORM_SCAN_GAP = 1000;
      let lastFormScan = 0;

      /** Local test before involving the background: ATS site, embedded ATS, or a form that looks like a job application. */
      const mightBeApplication = () => {
        if (adapter().id !== 'generic' || isJobPosting()) return true;
        const embedded = [...document.querySelectorAll('iframe[src]')].some((f) => {
          try {
            return detectAdapter(new URL((f as HTMLIFrameElement).src, location.href), document).id !== 'generic';
          } catch {
            return false;
          }
        });
        if (embedded) return true;
        // Cheap count first; only scan the form when there's enough of one.
        if (document.querySelectorAll('input:not([type=hidden]):not([type=search]), select, textarea').length < 4) return false;
        const wait = lastFormScan + FORM_SCAN_GAP - Date.now();
        if (wait > 0) {
          schedule(wait);
          return false;
        }
        lastFormScan = Date.now();
        return formInfo().jobForm;
      };
      let lastCheck = 0;
      // Workday changes the URL to /apply before drawing the form, so a panel shown for the
      // posting looks again whenever the number of form fields changes.
      const formFieldCount = () => document.querySelectorAll('input:not([type=hidden]):not([type=search]), select, textarea').length;
      let lastFieldCount = 0;
      const needsCheck = () => !panel.shown || location.href !== lastUrl || (panel.postingOnly && formFieldCount() !== lastFieldCount);

      const check = async () => {
        if (ctx.isInvalid || checking || panel.dismissed || Date.now() > stopAt) return;
        // Single-page apps (Workday) change URL without reloading; re-evaluate then.
        if (!needsCheck()) return;
        if (!mightBeApplication()) return;
        checking = true;
        try {
          const settings = await loadSettings();
          if (ctx.isInvalid) return;
          if (!settings.showOnPage) return panel.remove();
          if (Date.now() - lastCheck < 1500) return schedule(1500 - (Date.now() - lastCheck));
          lastCheck = Date.now();
          const state = await sendPanel({ type: 'panel:state' });
          if (state.kind === 'error' && /extension context invalidated/i.test(state.error)) {
            ctx.notifyInvalidated();
            return;
          }
          lastUrl = location.href;
          lastFieldCount = formFieldCount();
          // Job posting pages (before Apply) get the panel too, for the job's details and tailoring.
          if (!ctx.isInvalid && state.kind === 'state' && (state.isApplication || isJobPosting())) panel.show(state, !state.isApplication);
        } finally {
          checking = false;
        }
      };
      const schedule = (ms: number) => {
        if (ctx.isInvalid) return;
        clearTimeout(checkTimer);
        checkTimer = ctx.setTimeout(() => { checkTimer = undefined; void runSafely(check); }, ms);
      };
      schedule(100);
      // Forms often render after load; look again shortly after the page changes.
      // Throttled, not debounced: a busy page must not keep pushing the check back.
      const panelObserver = new MutationObserver(() => {
        if (!panel.dismissed && needsCheck() && checkTimer === undefined) schedule(300);
      });
      panelObserver.observe(document.documentElement, { childList: true, subtree: true });
      ctx.onInvalidated(() => {
        panelObserver.disconnect();
        clearTimeout(checkTimer);
        panel.remove();
      });
    }

    // --- Messages from the popup ----------------------------------------------

    async function handle(msg: ContentRequest): Promise<unknown> {
      switch (msg.type) {
        case 'detect': {
          const a = adapter();
          return { atsId: a.id, atsName: a.name, url: location.href, isTop: window === window.top, ...formInfo() } satisfies FrameInfo;
        }
        case 'pageText':
          return pageText(msg.limit);
        case 'fill':
          return fill(msg.resumeId, msg.skillSetId ?? null);
        case 'capture':
          return { html: captureForm(), url: location.href };
        case 'collectAnswers':
          return collectAnswers(await loadProfile());
      }
    }

    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (msg: ContentRequest, _sender, sendResponse) => {
      if (ctx.isInvalid) return false;
      void runSafely(async () => {
        let response: unknown;
        try {
          response = await handle(msg);
        } catch (err) {
          if (ctx.isInvalid || /extension context invalidated/i.test(err instanceof Error ? err.message : String(err))) throw err;
          response = { ats: adapter().name, filled: 0, needsReview: 0, fields: [], notes: [`Error: ${err instanceof Error ? err.message : String(err)}`] };
        }
        if (!ctx.isInvalid) sendResponse(response);
      });
      return true; // keep the channel open for the async response
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
  },
});
