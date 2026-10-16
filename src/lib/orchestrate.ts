// Tab-level fill logic shared by the toolbar popup and the on-page panel (via
// the background worker): find the frames holding the form, pick a resume,
// fill every target frame, and collect saved answers.
import { browser } from 'wxt/browser';
import { MIN_FORM_FIELDS } from './engine/jobForm';
import { uid } from './defaults';
import { mergeSavedAnswers } from './engine/capture';
import { sendToFrame, type FrameInfo } from './messages';
import { listResumes } from './resumeDb';
import { pickResume, pickSkillSet } from './resumeRules';
import { loadProfile, loadRules, loadSettings, saveProfile } from './storage';
import type { FillReport, ResumeMeta } from './types';

export interface Frame extends FrameInfo {
  frameId: number;
}

export interface TabState {
  connected: boolean;
  atsLabel: string;
  /** True when the page looks like an application form worth showing the panel for. */
  isApplication: boolean;
  resumes: Pick<ResumeMeta, 'id' | 'name' | 'tags'>[];
  pickedResumeId: string | null;
  pickReason: string;
  skillSets: { id: string; name: string }[];
  pickedSkillSetId: string | null;
  /** Developer setting: show "Capture page". */
  showCapture: boolean;
}

/** Ask every frame's content script what it sees; frames without one are skipped. */
export async function detectFrames(tabId: number): Promise<Frame[]> {
  const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
  const results = await Promise.allSettled(
    frames.map(async (f) => ({ ...(await sendToFrame(tabId, f.frameId, { type: 'detect' })), frameId: f.frameId })),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
}

/** Frames to fill: frames with a known ATS; else the frame with the most fields (embedded forms). */
export function targetFrames(frames: Frame[]): Frame[] {
  const known = frames.filter((f) => f.atsId !== 'generic' && (f.fieldCount > 0 || !f.isTop));
  if (known.length) return known;
  const top = frames.find((f) => f.isTop);
  const busiest = [...frames].sort((a, b) => b.fieldCount - a.fieldCount)[0];
  return busiest && busiest.fieldCount > (top?.fieldCount ?? 0) ? [busiest] : top ? [top] : [];
}

export function describe(targets: Frame[]): string {
  if (!targets.length) return 'Unknown site';
  return [...new Set(targets.map((f) => f.atsName + (f.isTop ? '' : ' (embedded)')))].join(', ');
}

export async function tabState(tabId: number): Promise<TabState> {
  const resumes = (await listResumes()).map(({ id, name, tags }) => ({ id, name, tags }));
  const showCapture = (await loadSettings()).showCaptureButton;
  const frames = await detectFrames(tabId);
  if (!frames.length) {
    return { connected: false, atsLabel: 'Not connected', isApplication: false, resumes, pickedResumeId: null, pickReason: '', skillSets: [], pickedSkillSetId: null, showCapture };
  }
  const targets = targetFrames(frames);
  const fields = targets.reduce((n, f) => n + f.fieldCount, 0);
  const knownAts = targets.some((f) => f.atsId !== 'generic');

  // Resume preselection: job title and text from the top frame plus any form frames.
  const textFrames = [...new Set([0, ...targets.map((f) => f.frameId)])];
  const texts = await Promise.allSettled(textFrames.map((id) => sendToFrame(tabId, id, { type: 'pageText' })));
  const page = { title: '', text: '' };
  for (const t of texts) {
    if (t.status !== 'fulfilled' || !t.value) continue;
    page.title += ` ${t.value.title}`;
    page.text += `\n${t.value.text}`;
  }
  const pick = pickResume(await listResumes(), await loadRules(), page);
  const profile = await loadProfile();
  const skillPick = pickSkillSet(profile.skillSets, page);
  return {
    showCapture,
    skillSets: profile.skillSets.map(({ id, name }) => ({ id, name })),
    pickedSkillSetId: skillPick?.resumeId ?? null,
    connected: true,
    atsLabel: describe(targets),
    // Known ATS with a form, or a form elsewhere that looks like a job application
    // (not a sign-up, checkout, settings or contact form).
    isApplication: (knownAts && fields > 0) || (fields >= MIN_FORM_FIELDS && targets.some((f) => f.jobForm)),
    resumes,
    pickedResumeId: pick?.resumeId ?? null,
    pickReason: pick ? `Picked by ${pick.reason}` : '',
  };
}

export async function fillTab(tabId: number, resumeId: string | null, skillSetId: string | null = null): Promise<FillReport[]> {
  const targets = targetFrames(await detectFrames(tabId));
  return Promise.all(targets.map((f) => sendToFrame(tabId, f.frameId, { type: 'fill', resumeId, skillSetId })));
}

export async function saveAnswersFromTab(tabId: number): Promise<{ added: number; updated: number }> {
  const targets = targetFrames(await detectFrames(tabId));
  const found = (await Promise.all(targets.map((f) => sendToFrame(tabId, f.frameId, { type: 'collectAnswers' })))).flat();
  if (!found.length) return { added: 0, updated: 0 };
  const profile = await loadProfile();
  const result = mergeSavedAnswers(profile.savedAnswers, found, uid);
  await saveProfile(profile);
  return result;
}

export async function captureTab(tabId: number): Promise<{ html: string; url: string }> {
  const [target] = targetFrames(await detectFrames(tabId));
  return sendToFrame(tabId, target?.frameId ?? 0, { type: 'capture' });
}
