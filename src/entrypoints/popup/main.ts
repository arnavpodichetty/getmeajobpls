import './style.css';
import { browser } from 'wxt/browser';
import { uid } from '../../lib/defaults';
import { $, h } from '../../lib/dom';
import { mergeSavedAnswers } from '../../lib/engine/capture';
import { sendToFrame } from '../../lib/messages';
import { describe, detectFrames, targetFrames } from '../../lib/orchestrate';
import { listResumes } from '../../lib/resumeDb';
import { pickResume, pickSkillSetFor, skillSetForResume } from '../../lib/resumeRules';
import { findTailored, jobLabel } from '../../lib/tailorMatch';
import { loadProfile, loadRules, loadSettings, saveProfile } from '../../lib/storage';
import { downloadCapture } from '../../lib/captureDownload';
import type { FillReport } from '../../lib/types';

const atsEl = $('#ats');
const resumeSel = $('#resume') as HTMLSelectElement;
const skillSel = $('#skillset') as HTMLSelectElement;
const dotEl = $('#dot');
const subEl = $('#site-sub');
const reasonEl = $('#reason');
const fillBtn = $('#fill') as HTMLButtonElement;
const summaryEl = $('#summary');
const saveBtn = $('#save-answers') as HTMLButtonElement;
const captureBtn = $('#capture') as HTMLButtonElement;

$('#open-options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

function renderSummary(reports: FillReport[]): void {
  const filled = reports.reduce((n, r) => n + r.filled, 0);
  const review = reports.flatMap((r) => r.fields.filter((f) => f.status === 'review'));
  const notes = reports.flatMap((r) => r.notes);
  summaryEl.replaceChildren(
    h(
      'div',
      { class: 'counts' },
      h('div', { class: 'count filled' }, h('b', {}, String(filled)), 'filled'),
      h('div', { class: 'count review' }, h('b', {}, String(review.length)), 'to review'),
    ),
    review.length
      ? h('ul', { class: 'review-list' }, ...review.map((f) => h('li', {}, f.label.slice(0, 90), f.reason ? h('small', {}, f.reason) : null)))
      : '',
    notes.length ? h('ul', { class: 'notes' }, ...notes.map((n) => h('li', {}, n))) : '',
  );
}

function showError(text: string): void {
  summaryEl.replaceChildren(h('div', { class: 'error' }, text));
}

function showOk(text: string): void {
  summaryEl.append(h('div', { class: 'ok' }, text));
}

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const resumes = await listResumes();

  resumeSel.replaceChildren(
    h('option', { value: '' }, resumes.length ? 'None (skip upload)' : 'None uploaded'),
    ...resumes.map((r) => h('option', { value: r.id }, r.name)),
  );

  const profile = await loadProfile();
  captureBtn.hidden = !(await loadSettings()).showCaptureButton;
  skillSel.replaceChildren(
    ...(profile.skillSets.length
      ? profile.skillSets.map((x) => h('option', { value: x.id }, x.name || 'Unnamed'))
      : [h('option', { value: '' }, 'Profile skills')]),
  );
  skillSel.value = profile.skillSets.find((x) => x.isDefault)?.id ?? profile.skillSets[0]?.id ?? '';

  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    atsEl.textContent = 'Not a web page';
    subEl.textContent = 'Open a job application to fill it.';
    return;
  }
  const tabId = tab.id;

  const frames = await detectFrames(tabId);
  if (!frames.length) {
    atsEl.textContent = 'Not connected';
    subEl.textContent = 'Reload the page to connect.';
    showError('Reload this page — it was opened before the extension was installed or updated.');
    return;
  }
  const targets = targetFrames(frames);
  atsEl.textContent = describe(targets);
  const fields = targets.reduce((n, f) => n + f.fieldCount, 0);
  dotEl.classList.toggle('on', fields > 0);
  subEl.textContent = fields > 0 ? `${fields} field${fields === 1 ? '' : 's'} found` : 'No form fields on this page yet';

  // Resume preselection: job title and text from the top frame plus any form frames.
  const textFrames = [...new Set([0, ...targets.map((f) => f.frameId)])];
  const texts = await Promise.allSettled(textFrames.map((id) => sendToFrame(tabId, id, { type: 'pageText' })));
  const page = { title: '', text: '' };
  for (const t of texts) {
    if (t.status !== 'fulfilled' || !t.value) continue;
    page.title += ` ${t.value.title}`;
    page.text += `\n${t.value.text}`;
  }
  let pick = pickResume(resumes, await loadRules(), page);
  // Back on a job you already tailored for: pick that copy, like the on-page panel does.
  const done = pick ? findTailored(resumes, pick.resumeId, tab.url, tab.title ? jobLabel(tab.title) : '') : undefined;
  if (done) pick = { resumeId: done.id, reason: 'tailoring this job earlier' };
  if (pick) {
    resumeSel.value = pick.resumeId;
    reasonEl.textContent = `Picked by ${pick.reason}`;
  }
  // The skill set follows the resume; change skills after that to mix them.
  const skillPick = pickSkillSetFor(profile.skillSets, resumes, pick?.resumeId ?? null, page);
  if (skillPick) skillSel.value = skillPick;
  resumeSel.addEventListener('change', () => {
    reasonEl.textContent = '';
    const skills = skillSetForResume(profile.skillSets, resumes, resumeSel.value);
    if (skills) skillSel.value = skills;
  });

  fillBtn.disabled = false;
  saveBtn.disabled = false;
  captureBtn.disabled = false;

  fillBtn.addEventListener('click', async () => {
    fillBtn.disabled = true;
    fillBtn.textContent = 'Filling…';
    summaryEl.replaceChildren();
    try {
      const resumeId = resumeSel.value || null;
      const skillSetId = skillSel.value || null;
      const reports = await Promise.all(targets.map((f) => sendToFrame(tabId, f.frameId, { type: 'fill', resumeId, skillSetId })));
      renderSummary(reports);
    } catch (err) {
      showError(`Fill failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      fillBtn.disabled = false;
      fillBtn.textContent = 'Fill this page';
    }
  });

  saveBtn.addEventListener('click', async () => {
    const found = (await Promise.all(targets.map((f) => sendToFrame(tabId, f.frameId, { type: 'collectAnswers' })))).flat();
    if (!found.length) {
      showOk('No new answers to save on this page.');
      return;
    }
    const profile = await loadProfile();
    const { added, updated } = mergeSavedAnswers(profile.savedAnswers, found, uid);
    await saveProfile(profile);
    showOk(`Saved ${added} new answer${added === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}. They'll fill matching questions next time.`);
  });

  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    captureBtn.textContent = 'Capturing…';
    try {
      const frame = targets[0];
      const name = downloadCapture(await sendToFrame(tabId, frame.frameId, { type: 'capture' }));
      showOk(`Downloaded ${name}. Attach the HTML file in chat or share its local file path so the form can be inspected.`);
    } catch (err) {
      showError(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      captureBtn.disabled = false;
      captureBtn.textContent = 'Capture page';
    }
  });
}

init().catch((err) => showError(String(err)));
