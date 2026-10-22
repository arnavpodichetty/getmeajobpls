// Chrome Web Store images from the built extension, with a fictional profile:
// 1280×800 screenshots of the options page and a filled form, plus the
// 440×280 small promo tile.
//
//   npm run build && npm run store-assets   → store/*.png
//
// The filled-form shot uses scripts/store-demo-form.html (a neutral, made-up
// company) served locally, so no real employer's branding is in the listing.
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, '.output/chrome-mv3');
const outDir = resolve(root, 'store');
const SIZE = { width: 1280, height: 800 };

/** Fictional applicant; never real data. */
const PROFILE = {
  personal: {
    firstName: 'Ada', middleName: '', lastName: 'Lovelace', fullName: '', preferredName: 'Ada', pronouns: 'she/her',
    email: 'ada.lovelace@example.com', universityEmail: '', phone: '4155550100', phoneCountryCode: '+1',
    street: '1 Analytical Way', addressLine2: '', city: 'San Francisco', state: 'CA', zip: '94105', country: 'United States',
  },
  links: { linkedin: 'https://linkedin.com/in/ada-lovelace', github: 'https://github.com/ada-lovelace', website: 'https://adalovelace.dev', portfolio: '', twitter: '', other: '' },
  education: [{ id: 'e1', school: 'University of Michigan', degree: 'Bachelor of Science', major: 'Mathematics', majorFallbacks: [], secondMajor: '', minor: '', gpa: '3.9', coursework: '', start: '2024-09', end: '2028-06' }],
  experience: [{ id: 'x1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: 'San Francisco, CA', start: '2026-09', end: '', current: true, description: 'Wrote the first published algorithm for the Analytical Engine.' }],
  projects: [],
  skills: ['Python', 'SQL', 'Mathematics'],
  skillSets: [],
  languages: [{ id: 'l1', language: 'English', proficiency: 'Native or bilingual', fluent: true }],
  answers: { earliestStartDate: '2027-06-01', hourlyRate: '40', referralSource: 'LinkedIn' },
  eeo: {},
  savedAnswers: [],
};
const SETTINGS = { highlightFields: true, showOnPage: true, watchForNewFields: false, workdayAutoAdvance: false, overwriteExisting: false };
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

mkdirSync(outDir, { recursive: true });
const demo = readFileSync(resolve(root, 'scripts/store-demo-form.html'));
const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(demo));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const formUrl = `http://127.0.0.1:${server.address().port}/careers/software-engineering-intern/apply`;
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  enableExtensions: true,
  pipe: true,
  args: ['--disable-blink-features=AutomationControlled', '--hide-scrollbars'],
  defaultViewport: SIZE,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const id = await browser.installExtension(extensionPath);
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id), { timeout: 15_000 });
  const worker = await sw.worker();
  await worker.evaluate(async (profile, settings, pdf) => {
    await chrome.storage.local.set({ profile, settings, resumeRules: [] });
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('getmeajobpls', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('resumes', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const blob = new Blob([pdf], { type: 'application/pdf' });
    await new Promise((res, rej) => {
      const tx = db.transaction('resumes', 'readwrite');
      tx.objectStore('resumes').clear();
      tx.objectStore('resumes').put({ id: 'demo', name: 'General', tags: [], skills: [], fileName: 'Ada_Lovelace_Resume.pdf', mimeType: 'application/pdf', size: blob.size, uploadedAt: Date.now(), isDefault: true, blob });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }, PROFILE, SETTINGS, PDF);

  // Options page sections.
  const page = await browser.newPage();
  for (const [section, name] of [['personal', '1-profile'], ['answers', '2-standard-answers'], ['resumes', '3-resumes']]) {
    await page.goto(`chrome-extension://${id}/options.html#${section}`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await page.evaluate((s) => document.getElementById(s)?.scrollIntoView({ block: 'start' }), section);
    await sleep(300);
    await page.screenshot({ path: resolve(outDir, `screenshot-${name}.png`) });
    console.log(`store/screenshot-${name}.png`);
  }

  // The README's picture of the options page (top of the page, at 2x for sharp text).
  await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'networkidle0' });
  await sleep(800);
  await page.screenshot({ path: resolve(root, 'docs/options.png') });
  console.log('docs/options.png');
  await page.setViewport(SIZE);

  // A real application form, filled through the extension with the fictional profile. Nothing is submitted.
  await page.goto(formUrl, { waitUntil: 'networkidle0' });
  await sleep(1500);
  await worker.evaluate(async (pageUrl) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl.split('#')[0] + '*' });
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    for (const f of frames) {
      try {
        const info = await chrome.tabs.sendMessage(tab.id, { type: 'detect' }, { frameId: f.frameId });
        if (info.fieldCount > 0) await chrome.tabs.sendMessage(tab.id, { type: 'fill', resumeId: 'demo' }, { frameId: f.frameId });
      } catch {}
    }
  }, page.url());
  await sleep(1500);
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: resolve(outDir, 'screenshot-4-filled-form.png') });
  console.log('store/screenshot-4-filled-form.png');

  // Fill my profile: the review list after Claude reads a resume. The helper isn't
  // reachable here, so its reply (the same fictional profile) is stubbed in the page.
  await worker.evaluate(async (personal, settings) => {
    await chrome.storage.local.set({ profile: { personal }, settings: { ...settings, tailorEnabled: true } });
  }, { firstName: 'Ada', lastName: 'Lovelace' }, SETTINGS);
  const review = await browser.newPage();
  await review.evaluateOnNewDocument((p) => {
    const draft = {
      personal: { firstName: p.personal.firstName, middleName: '', lastName: p.personal.lastName, email: p.personal.email, phone: p.personal.phone, street: '', city: p.personal.city, state: p.personal.state, zip: '', country: '' },
      links: { ...p.links },
      education: p.education.map(({ school, degree, major, minor, gpa, coursework, start, end }) => ({ school, degree, major, minor, gpa, coursework, start, end })),
      experience: p.experience.map(({ company, title, location, start, end, current, description }) => ({ company, title, location, start, end, current, description })),
      projects: [],
      skills: p.skills,
      languages: [],
    };
    chrome.permissions.contains = async () => true;
    chrome.runtime.sendNativeMessage = async () => ({ ok: true, draft, dropped: [] });
  }, PROFILE);
  await review.setViewport(SIZE);
  await review.goto(`chrome-extension://${id}/options.html#import`, { waitUntil: 'networkidle0' });
  await sleep(800);
  await review.evaluate(() => document.querySelector('#import .row button')?.click());
  await sleep(1200);
  // The page scrolls smoothly; jump instead so the shot isn't taken mid-scroll.
  await review.evaluate(() => {
    document.querySelector('#import .import-review')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -70, behavior: 'instant' });
  });
  await sleep(300);
  await review.screenshot({ path: resolve(outDir, 'screenshot-5-fill-my-profile.png') });
  console.log('store/screenshot-5-fill-my-profile.png');
  await review.close();

  // Small promo tile: the full logo (its rounded square spans 11–1227 × 19–1226 of the 1254 px image) and a tagline.
  const logo = `data:image/png;base64,${readFileSync(resolve(root, 'scripts/icon/logo.png')).toString('base64')}`;
  const tile = 220;
  const scale = tile / (1227 - 11);
  await page.setViewport({ width: 440, height: 280 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:20px;padding:0 24px 0 30px;box-sizing:border-box;background:#d9f2e3;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f3d33">
    <div style="width:${tile}px;height:${tile}px;flex:none;border-radius:${tile * 0.2}px;box-shadow:0 6px 20px rgba(15,61,51,.14);background:url(${logo}) no-repeat;background-size:${1254 * scale}px;background-position:${-11 * scale}px ${-19 * scale}px"></div>
    <div><div style="font-size:24px;font-weight:700;letter-spacing:-0.3px">Apply faster.</div>
    <div style="font-size:15px;font-weight:500;line-height:1.35;margin-top:6px">One-click autofill for Workday, Greenhouse, Lever and more, plus tailored resumes.</div>
    <div style="font-size:13px;line-height:1.35;margin-top:8px;color:#2f6f5e">No account. Data stored on-device.</div></div>
  </body></html>`);
  await page.screenshot({ path: resolve(outDir, 'promo-small-440x280.png') });
  console.log('store/promo-small-440x280.png');
} finally {
  await browser.close();
  server.close();
}
