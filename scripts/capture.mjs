// Render a public application page in your installed Chrome and save its DOM
// (including open shadow roots) as a test fixture.
//
//   npm run capture -- <url> <name> [--click "Button text"]...   → tests/fixtures/<name>.html
//
// --click clicks a button/link/option with that exact text first (repeatable),
// for boards with a consent or "Apply" step before the form.
// Scripts, styles, iframes and images are stripped; the form structure stays.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';

const args = process.argv.slice(2);
const clicks = args.flatMap((a, i) => (args[i - 1] === '--click' ? [a] : []));
const [url, name] = args.filter((a, i) => a !== '--click' && args[i - 1] !== '--click');
if (!url || !name) {
  console.error('usage: npm run capture -- <url> <name>');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tests/fixtures', `${name}.html`);

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  // Some boards (SmartRecruiters) refuse to render the form for automated browsers.
  args: ['--disable-blink-features=AutomationControlled'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1800 });
  const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
  await page.setUserAgent(ua);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
  // Some boards show the job first and the form after an "Apply" click.
  await page.evaluate(() => {
    const hasForm = document.querySelectorAll('input:not([type=hidden]), textarea').length > 3;
    if (hasForm) return;
    const apply = [...document.querySelectorAll('a, button')].find((el) => /^\s*apply( now| for this job)?\s*$/i.test(el.textContent ?? ''));
    apply?.click();
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  for (const text of clicks) {
    const clicked = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button, a, [role=button], [role=option], label, li, option')].find(
        (e) => (e.textContent ?? '').trim() === t,
      );
      if (!el) return false;
      if (el.tagName === 'OPTION') {
        const select = el.closest('select');
        select.value = el.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else el.click();
      return true;
    }, text);
    console.log(`${clicked ? 'clicked' : 'NOT FOUND'}: ${text}`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const html = await page.evaluate(() => {
    const serialize = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/</g, '&lt;');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'link', 'iframe', 'img', 'svg', 'noscript', 'video', 'picture', 'meta'].includes(tag)) return '';
      const attrs = [...el.attributes]
        .filter((a) => !a.name.startsWith('on') && a.name !== 'style' && a.name !== 'srcset')
        .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
        .join('');
      const shadow = el.shadowRoot ? `<template shadowrootmode="open">${[...el.shadowRoot.childNodes].map(serialize).join('')}</template>` : '';
      const kids = [...el.childNodes].map(serialize).join('');
      const voids = ['input', 'br', 'hr', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'];
      return voids.includes(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${shadow}${kids}</${tag}>`;
    };
    return `<!doctype html>\n<!-- captured from ${location.href} on ${new Date().toISOString().slice(0, 10)} -->\n<html><body>${serialize(document.body)}</body></html>`;
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  const fields = (html.match(/<(input|select|textarea)\b/g) ?? []).length;
  console.log(`saved ${out} (${Math.round(html.length / 1024)} KB, ${fields} form controls)`);
} finally {
  await browser.close();
}
