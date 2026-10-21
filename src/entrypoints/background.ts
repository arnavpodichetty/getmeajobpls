import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { BackgroundRequest, PanelRequest, PanelResponse, ResumeFilePayload } from '../lib/messages';
import { captureTab, fillTab, saveAnswersFromTab, tabState } from '../lib/orchestrate';
import { blobToBase64, getResume } from '../lib/resumeDb';
import { forgetPostings } from '../lib/posting';
import { REOPEN_KEY, tailorForTab } from '../lib/tailor';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') browser.runtime.openOptionsPage();
    // Turning on tailoring restarts the extension (see options/tailoring.ts); go back to where you were.
    const { [REOPEN_KEY]: section } = await browser.storage.local.get(REOPEN_KEY);
    if (typeof section === 'string') {
      await browser.storage.local.remove(REOPEN_KEY);
      await browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${section}`) });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => { void forgetPostings(tabId); });

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
    if (msg.type === 'getResumeFile') {
      (async (): Promise<ResumeFilePayload | null> => {
        const rec = await getResume(msg.id);
        if (!rec) return null;
        const { blob, ...meta } = rec;
        return { meta, base64: await blobToBase64(blob) };
      })().then(sendResponse, () => sendResponse(null));
      return true;
    }

    return false;
  });
});
