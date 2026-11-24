import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { BackgroundRequest, PanelRequest, PanelResponse, ResumeFilePayload } from '../lib/messages';
import { captureTab, fillTab, saveAnswersFromTab, tabState } from '../lib/orchestrate';
import { blobToBase64, getResume } from '../lib/resumeDb';
import { forgetPostings } from '../lib/posting';
import { REOPEN_KEY, tailorForTab } from '../lib/tailor';
import { syncNow, syncOnWake, watchLocalChanges } from '../lib/cloudSync';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') void browser.runtime.openOptionsPage().catch(() => {});
    // Turning on tailoring restarts the extension (see options/tailoring.ts); go back to where you were.
    try {
      const { [REOPEN_KEY]: section } = await browser.storage.local.get(REOPEN_KEY);
      if (typeof section === 'string') {
        await browser.storage.local.remove(REOPEN_KEY);
        await browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${section}`) });
      }
    } catch {
      // Storage or tabs unavailable during the update; Options can be opened by hand.
    }
  });

  // Optional Google Drive sync: upload local edits, and pick up other browsers' edits on wake.
  // Failures are kept in the sync state that Options shows; nothing to do here.
  watchLocalChanges();
  syncOnWake().catch(() => {});

  browser.tabs.onRemoved.addListener((tabId) => { forgetPostings(tabId).catch(() => {}); });

  browser.runtime.onMessage.addListener((msg: BackgroundRequest | PanelRequest, sender, sendResponse) => {
    if (typeof msg?.type === 'string' && msg.type.startsWith('panel:')) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      (async (): Promise<PanelResponse> => {
        switch ((msg as PanelRequest).type) {
          case 'panel:state':
            return { kind: 'state', ...(await tabState(tabId)) };
          case 'panel:capture':
            return { kind: 'capture', ...(await captureTab(tabId)) };
          case 'panel:fill': {
            const { resumeId, skillSetId } = msg as Extract<PanelRequest, { type: 'panel:fill' }>;
            return { kind: 'reports', reports: await fillTab(tabId, resumeId, skillSetId) };
          }
          case 'panel:tailor': {
            const { resumeId } = msg as Extract<PanelRequest, { type: 'panel:tailor' }>;
            return { kind: 'tailored', ...(await tailorForTab(tabId, resumeId)) };
          }
          case 'panel:saveAnswers':
            return { kind: 'saved', ...(await saveAnswersFromTab(tabId)) };
          case 'panel:options':
            await browser.runtime.openOptionsPage();
            return { kind: 'ok' };
        }
      })().then(sendResponse, (err: unknown) => sendResponse({ kind: 'error', error: err instanceof Error ? err.message : String(err) }));
      return true;
    }

    // Content scripts can't open the extension's IndexedDB, so they fetch resume files here.
    if (msg?.type === 'getResumeFile') {
      (async (): Promise<ResumeFilePayload | null> => {
        const rec = await getResume(msg.id);
        if (!rec) return null;
        const { blob, ...meta } = rec;
        return { meta, base64: await blobToBase64(blob) };
      })().then(sendResponse, () => sendResponse(null));
      return true;
    }

    if (msg?.type === 'sync:now') {
      syncNow().then(
        (result) => sendResponse({ ok: true, result }),
        (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      return true;
    }

    return false;
  });
});
