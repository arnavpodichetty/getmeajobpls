// Run the built extension against live application pages in your installed
// Chrome (headless, throwaway profile) with a fictional test profile, and
// report what got filled. Nothing is ever submitted.
//
//   npm run build && npm run live-test -- <url> [<url>...]
//   SHOW=1 npm run live-test -- <url>                 # watch it in a visible window
//   VALUES=1 npm run live-test -- <url>               # also print every text box's value after the fill
//
// Screenshots go to .live-test/<host>.png.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, '.output/chrome-mv3');
const outDir = resolve(root, '.live-test');

// Pass public application form URLs (any supported ATS) on the command line.
const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: npm run live-test -- <application url> [<url>...]');
  process.exit(1);
}

/** Fictional applicant; never real data. */
const PROFILE = {
  personal: {
    firstName: 'Ada', middleName: '', lastName: 'Lovelace', preferredName: 'Ada', pronouns: 'she/her',
    email: 'ada.lovelace.test@example.com', phone: '(415) 555-0100', phoneCountryCode: '+1',
    street: '1 Analytical Way', addressLine2: '', city: 'Los Angeles', state: 'CA', zip: '90024', country: 'United States',
  },
  links: { linkedin: 'https://www.linkedin.com/in/ada-test', github: 'https://github.com/ada-test', website: 'https://example.com', portfolio: 'https://example.com/work', twitter: '', other: '' },
  education: [{ id: 'e1', school: 'University of California, Los Angeles', degree: "Bachelor's Degree", major: 'Computer Science', secondMajor: '', minor: '', gpa: '3.9', start: '2024-09', end: '2028-06' }],
  experience: [{ id: 'x1', company: 'Analytical Engines', title: 'Software Engineering Intern', type: 'Internship', location: 'Seattle, WA', start: '2026-09', end: '', current: true, description: 'Built data pipelines.' }],
  projects: [],
  skills: ['Python', 'SQL', 'Java'],
  languages: [{ id: 'l1', language: 'English', proficiency: 'Native or bilingual', fluent: true }],
  answers: {
    workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes', over18: 'Yes', previouslyEmployed: 'No', nonCompete: 'No',
    citizenship: 'United States', securityClearance: '', earliestStartDate: '2027-05-26', hourlyRate: '', noticePeriod: '', referralSource: 'LinkedIn', coverLetter: '',
  },
  eeo: { gender: '', raceEthnicity: '', hispanicLatino: '', veteranStatus: '', disability: '', sexualOrientation: '', transgender: '' },
  savedAnswers: [],
};

const SETTINGS = { overwriteExisting: false, highlightFields: true, workdayAutoAdvance: false, watchForNewFields: false, showOnPage: !!process.env.PANEL };

// A minimal one-page PDF so upload fields accept the test resume.
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 72 720 Td (Ada Lovelace) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: !process.env.SHOW,
  enableExtensions: true,
  pipe: true,
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1280,1600'],
  defaultViewport: { width: 1280, height: 1600 },
});

try {
  const id = await browser.installExtension(extensionPath);
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id), { timeout: 15_000 });
  const worker = await swTarget.worker();

  // Seed profile, settings, and a resume (IndexedDB lives in the extension origin).
  await worker.evaluate(
    async (profile, settings, pdf) => {
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
        // Never use real resumes on live sites: only the test PDF exists.
        tx.objectStore('resumes').clear();
        tx.objectStore('resumes').put({ id: 'test-resume', name: 'Test', tags: [], skills: [], fileName: 'Ada_Lovelace_Resume.pdf', mimeType: 'application/pdf', size: blob.size, uploadedAt: Date.now(), isDefault: true, blob });
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    },
    PROFILE,
    SETTINGS,
    PDF,
  );

  const page = await browser.newPage();
  const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
  await page.setUserAgent(ua);

  for (const url of urls) {
    const host = new URL(url).hostname;
    console.log(`\n=== ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.PANEL) {
        // Click "Fill page" on the on-page panel like a person would (it sits at the top right).
        // The panel is in a closed shadow root; hit-test the right edge to find it.
        const x = page.viewport().width - 12 - 168 + 50;
        let y = -1;
        for (let tries = 0; tries < 20 && y < 0; tries++) {
          y = await page.evaluate((px) => {
            for (let py = 0; py < innerHeight; py += 4) if (document.elementFromPoint(px, py)?.tagName === 'GETMEAJOBPLS-PANEL') return py + 8;
            return -1;
          }, x);
          if (y < 0) await new Promise((r) => setTimeout(r, 1000));
        }
        if (y < 0) {
          console.log('  panel not shown on this page');
          continue;
        }
        await page.mouse.click(x, y);
        await new Promise((r) => setTimeout(r, 15000));
        await page.screenshot({ path: resolve(outDir, `${host}-panel.png`) });
        console.log('  panel click done; screenshot saved');
        continue;
      }
      // Same frame choice as the popup: frames with a known ATS, else the busiest frame.
      const reports = await worker.evaluate(async (pageUrl) => {
        const [tab] = await chrome.tabs.query({ url: pageUrl.split('#')[0] + '*' });
        const tabId = tab?.id ?? (await chrome.tabs.query({ active: true }))[0].id;
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        const infos = [];
        for (const f of frames) {
          try {
            infos.push({ ...(await chrome.tabs.sendMessage(tabId, { type: 'detect' }, { frameId: f.frameId })), frameId: f.frameId });
          } catch {}
        }
        let targets = infos.filter((f) => f.atsId !== 'generic' && (f.fieldCount > 0 || !f.isTop));
        if (!targets.length) targets = [infos.sort((a, b) => b.fieldCount - a.fieldCount)[0]].filter(Boolean);
        const out = [];
        for (const t of targets) out.push(await chrome.tabs.sendMessage(tabId, { type: 'fill', resumeId: 'test-resume' }, { frameId: t.frameId }));
        return out;
      }, page.url());

      for (const r of reports) {
        console.log(`[${r.ats}] filled ${r.filled}, review ${r.needsReview}`);
        for (const f of r.fields) console.log(`  ${f.status.padEnd(7)} ${f.label.slice(0, 80)}${f.reason ? `   [${f.reason.slice(0, 110)}]` : ''}`);
        for (const n of r.notes) console.log(`  note: ${n}`);
      }
      if (process.env.VALUES) {
        // What each text box holds a few seconds after the fill (catches sites that clear values).
        await new Promise((r) => setTimeout(r, Number(process.env.VALUES) || 3000));
        const values = await page.evaluate(() => {
          const all = [];
          const walk = (root) => {
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) walk(el.shadowRoot);
              if (el.matches('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea')) all.push(el);
            }
          };
          walk(document);
          return all.map((el) => `${el.id || el.name || el.getAttribute('aria-label') || el.tagName}: ${JSON.stringify(el.value)}`);
        });
        for (const v of values) console.log(`  value ${v.slice(0, 120)}`);
      }
      await page.screenshot({ path: resolve(outDir, `${host}.png`), fullPage: true });
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }
} finally {
  await browser.close();
}
