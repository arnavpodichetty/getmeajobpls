// Render scripts/icon/icon.svg to public/icon/{16,32,48,128}.png via headless Chrome.
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../chrome.mjs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  writeFileSync(new URL(`../../public/icon/${size}.png`, import.meta.url), png);
}
await browser.close();
