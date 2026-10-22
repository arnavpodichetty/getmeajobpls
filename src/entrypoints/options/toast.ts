import { $ } from '../../lib/dom';

let timer: number | undefined;

export function showToast(text: string, isError = false): void {
  const toast = $('#toast');
  toast.textContent = text;
  toast.className = isError ? 'show error' : 'show';
  clearTimeout(timer);
  timer = window.setTimeout(() => (toast.className = ''), isError ? 4000 : 1600);
}

/** Saves waiting out their debounce; run at once when the page is hidden or closed so the last edit isn't lost. */
const pending = new Set<() => void>();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') for (const run of [...pending]) run();
});

export function debounce(fn: () => Promise<void>, ms = 400): () => void {
  let t: number | undefined;
  const run = () => {
    clearTimeout(t);
    pending.delete(run);
    fn().then(
      () => showToast('Saved'),
      (err) => showToast(`Save failed: ${err}`, true),
    );
  };
  return () => {
    clearTimeout(t);
    pending.add(run);
    t = window.setTimeout(run, ms);
  };
}
