// Options page: apply a saved light theme before first paint (dark is the default).
// A separate file because extension pages don't allow inline scripts.
try {
  if (localStorage.getItem('theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch {}
