// Render the extension icons from scripts/icon/logo.png via headless Chrome:
// the document-and-cursor mark (without the wordmark, which is unreadable at
// toolbar sizes) centered on the logo's mint rounded square.
//
//   node scripts/icon/render.mjs   → public/icon/{16,32,48,128}.png, docs/logo.png
//
// The 128 px store icon keeps 16 px of clear space per side (96 px artwork), as
// the Chrome Web Store asks; the smaller ones fill their box so they stay legible.
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../chrome.mjs';

/** Where the mark sits in logo.png (above the wordmark), and the square's background. */
const MARK = { x: 140, y: 150, w: 1010, h: 740 };
/** Just the document and cursor, for toolbar sizes where the cloud and click lines would shrink them to a smudge. */
const TIGHT = { x: 270, y: 155, w: 785, h: 710 };
const BG = 'rgb(238, 254, 245)';
/** The whole logo (wordmark included) for the README: its rounded square, with the corners outside it made transparent. */
const FULL = { x: 11, y: 19, w: 1216, h: 1208, radius: 212, width: 512 };
const SIZES = [
  { size: 16, pad: 0, mark: TIGHT },
  { size: 32, pad: 0, mark: TIGHT },
  { size: 48, pad: 1, mark: MARK },
  { size: 128, pad: 16, mark: MARK },
];

const logo = `data:image/png;base64,${readFileSync(new URL('./logo.png', import.meta.url)).toString('base64')}`;
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage();
  const icons = await page.evaluate(async (src, bg, sizes) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    /** The mark centered on a square of the logo's background. */
    const squareOf = (mark) => {
      const side = Math.max(mark.w, mark.h);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = side;
      const m = canvas.getContext('2d');
      m.fillStyle = bg;
      m.fillRect(0, 0, side, side);
      m.drawImage(img, mark.x, mark.y, mark.w, mark.h, (side - mark.w) / 2, (side - mark.h) / 2, mark.w, mark.h);
      return canvas;
    };

    /** Halve until close to the target, so small icons stay smooth instead of aliased. */
    const scaled = (master, target) => {
      let cur = master;
      while (cur.width / 2 >= target * 1.5) {
        const next = document.createElement('canvas');
        next.width = next.height = Math.round(cur.width / 2);
        const c = next.getContext('2d');
        c.imageSmoothingQuality = 'high';
        c.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      return cur;
    };

    return sizes.map(({ size, pad, mark }) => {
      const art = size - pad * 2;
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const c = out.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.beginPath();
      c.roundRect(pad, pad, art, art, art * 0.22);
      c.clip();
      c.drawImage(scaled(squareOf(mark), art), pad, pad, art, art);
      return { size, data: out.toDataURL('image/png').split(',')[1] };
    });
  }, logo, BG, SIZES);
  const full = await page.evaluate(async (src, f) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const out = document.createElement('canvas');
    out.width = f.w;
    out.height = f.h;
    const c = out.getContext('2d');
    c.beginPath();
    c.roundRect(0, 0, f.w, f.h, f.radius);
    c.clip();
    c.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const small = document.createElement('canvas');
    small.width = f.width;
    small.height = Math.round((f.h / f.w) * f.width);
    const s = small.getContext('2d');
    s.imageSmoothingQuality = 'high';
    s.drawImage(out, 0, 0, small.width, small.height);
    return small.toDataURL('image/png').split(',')[1];
  }, logo, FULL);
  writeFileSync(new URL('../../docs/logo.png', import.meta.url), Buffer.from(full, 'base64'));
  console.log('docs/logo.png');
  for (const { size, data } of icons) {
    writeFileSync(new URL(`../../public/icon/${size}.png`, import.meta.url), Buffer.from(data, 'base64'));
    console.log(`public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}
