// ResumeDoc → one-page PDF with headless Chrome. Uses the largest font from
// 11pt down to 10pt that fits one page; if 10pt still overflows, cuts the least
// relevant bullets and projects (fit.mjs) until it fits.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../chrome.mjs';
import { trimOnce } from './fit.mjs';
import { hideWrappedSeparators, renderHtml } from './render.mjs';

const PAGE_PX = 11 * 96;
/** Chrome's print layout can differ from the screen by a few pixels; leave room so a "fit" never spills a line. */
const SAFETY_PX = 8;
/** Font scales tried, largest first: 11pt down to 10pt (LaTeX's \small). */
const SCALES = Array.from({ length: 10 }, (_, i) => +(1 - i * 0.01).toFixed(2));

let fontCss = null;
/** Computer Modern (OFL) inlined as data URIs so the PDF never depends on installed fonts. */
function computerModern() {
  if (fontCss !== null) return fontCss;
  const dir = join(dirname(createRequire(import.meta.url).resolve('computer-modern/package.json')), 'fonts');
  const face = (weight, style) => {
    const data = readFileSync(join(dir, `cmu-serif-${weight}-${style === 'italic' ? 'italic' : 'roman'}.woff2`)).toString('base64');
    return `@font-face{font-family:"CMU Serif";font-weight:${weight === 500 ? 'normal' : 'bold'};font-style:${style};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
  };
  fontCss = face(500, 'normal') + face(500, 'italic') + face(700, 'normal') + face(700, 'italic');
  return fontCss;
}

async function withPage(fn) {
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 816, height: PAGE_PX });
    await page.emulateMediaType('print');
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Lay the doc out at a scale; returns its height in pages (fractional, including the safety margin). */
async function layout(page, doc, scale) {
  const fonts = doc.style.font === 'computer-modern' ? computerModern() : '';
  await page.setContent(renderHtml(doc, { scale, fontCss: fonts }), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(hideWrappedSeparators);
  const height = await page.evaluate(() => document.querySelector('.page').scrollHeight);
  return (height + SAFETY_PX) / PAGE_PX;
}

/** Pages Chrome actually prints: asking for a page that doesn't exist throws. */
async function printedPages(page) {
  for (let n = 1; n < 10; n++) {
    try {
      await page.pdf({ format: 'letter', preferCSSPageSize: true, pageRanges: String(n + 1) });
    } catch {
      return n;
    }
  }
  return 10;
}

/** How much of a page the doc fills at full size (1.2 = 20% too long). */
export function pageFill(doc) {
  return withPage((page) => layout(page, doc, 1));
}

/** Largest scale at which the doc fits one page, or null. Pages only grow with scale, so binary search. */
async function fitScale(page, doc) {
  if ((await layout(page, doc, SCALES[SCALES.length - 1])) > 1) return null;
  let lo = 0;
  let hi = SCALES.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((await layout(page, doc, SCALES[mid])) <= 1) hi = mid;
    else lo = mid + 1;
  }
  return SCALES[lo];
}

/**
 * Render on one page, cutting content if it can't fit at 10pt.
 * @returns { pdf, pages, scale, doc, cuts } — `doc` is what was rendered, `cuts` describes each removal
 */
export function renderOnePage(doc) {
  return withPage(async (page) => {
    const cuts = [];
    let i;
    let pages;
    for (;;) {
      const scale = await fitScale(page, doc);
      i = SCALES.indexOf(scale ?? SCALES[SCALES.length - 1]);
      await layout(page, doc, SCALES[i]);
      // Trust the printed page count over the measurement; step the font down if Chrome still spills.
      pages = await printedPages(page);
      while (pages > 1 && i < SCALES.length - 1) {
        i += 1;
        await layout(page, doc, SCALES[i]);
        pages = await printedPages(page);
      }
      if (pages === 1) break;
      const trimmed = trimOnce(doc);
      if (!trimmed) break;
      doc = trimmed.doc;
      cuts.push(trimmed.note);
    }
    const pdf = Buffer.from(await page.pdf({ format: 'letter', printBackground: true, preferCSSPageSize: true }));
    return { pdf, pages, scale: SCALES[i], doc, cuts };
  });
}
