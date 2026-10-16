import { h } from './dom';

export interface Capture {
  html: string;
  url: string;
}

function checkCapture(capture: Capture): void {
  if (typeof capture.html !== 'string' || !capture.html.trim()) throw new Error('The page returned an empty capture. Refresh the page and try again.');
}

export function captureFileName(url: string): string {
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${host}-${stamp}.html`;
}

/** Download a form snapshot from either the toolbar popup or on-page panel. */
export function downloadCapture(capture: Capture): string {
  checkCapture(capture);
  const name = captureFileName(capture.url);
  const href = URL.createObjectURL(new Blob([capture.html], { type: 'text/html' }));
  const link = h('a', { href, download: name });
  document.documentElement.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
  return name;
}
