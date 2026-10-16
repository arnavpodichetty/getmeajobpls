import { $ } from '../../lib/dom';

let timer: number | undefined;

export function showToast(text: string, isError = false): void {
  const toast = $('#toast');
  toast.textContent = text;
  toast.className = isError ? 'show error' : 'show';
  clearTimeout(timer);
  timer = window.setTimeout(() => (toast.className = ''), isError ? 4000 : 1600);
}

export function debounce(fn: () => Promise<void>, ms = 400): () => void {
  let t: number | undefined;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      fn().then(
        () => showToast('Saved'),
        (err) => showToast(`Save failed: ${err}`, true),
      );
    }, ms);
  };
}
