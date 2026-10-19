// Message contracts between popup, content scripts (every frame) and the
// background worker. Chrome serializes messages as JSON, so files travel as base64.
import { browser } from 'wxt/browser';
import type { TabState } from './orchestrate';
import type { TailorResult } from './tailor';
import type { FillReport, ResumeMeta } from './types';

export interface FrameInfo {
  atsId: string;
  atsName: string;
  url: string;
  isTop: boolean;
  /** Visible form fields in this frame (to pick the frame that holds the form). */
  fieldCount: number;
  /** On an unrecognized site, whether the form looks like a job application. */
  jobForm: boolean;
}

export interface PageText {
  title: string;
  text: string;
}

export interface ResumeFilePayload {
  meta: ResumeMeta;
  base64: string;
}

/** Popup → content script (sent per frame). */
export type ContentRequest =
  | { type: 'detect' }
  | { type: 'pageText' }
  | { type: 'fill'; resumeId: string | null; skillSetId?: string | null }
  | { type: 'capture' }
  | { type: 'collectAnswers' };

export interface ContentResponses {
  detect: FrameInfo;
  pageText: PageText;
  fill: FillReport;
  capture: { html: string; url: string };
  collectAnswers: { question: string; answer: string }[];
}

/** Content script → background. */
export type BackgroundRequest =
  | { type: 'getResumeFile'; id: string };


/** On-page panel (top frame) → background, which works across the tab's frames. */
export type PanelRequest =
  | { type: 'panel:state' }
  | { type: 'panel:capture' }
  | { type: 'panel:fill'; resumeId: string | null; skillSetId: string | null }
  | { type: 'panel:saveAnswers' }
  | { type: 'panel:tailor'; resumeId: string }
  | { type: 'panel:options' };

export type PanelResponse =
  | ({ kind: 'state' } & TabState)
  | { kind: 'capture'; html: string; url: string }
  | { kind: 'reports'; reports: FillReport[] }
  | { kind: 'saved'; added: number; updated: number }
  | ({ kind: 'tailored' } & TailorResult)
  | { kind: 'ok' }
  | { kind: 'error'; error: string };

export async function sendPanel(msg: PanelRequest): Promise<PanelResponse> {
  try {
    return await browser.runtime.sendMessage(msg);
  } catch (err) {
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendToFrame<T extends ContentRequest>(
  tabId: number,
  frameId: number,
  msg: T,
): Promise<ContentResponses[T['type']]> {
  return browser.tabs.sendMessage(tabId, msg, { frameId });
}

export async function requestResumeFile(id: string): Promise<ResumeFilePayload | null> {
  const msg: BackgroundRequest = { type: 'getResumeFile', id };
  return browser.runtime.sendMessage(msg);
}

