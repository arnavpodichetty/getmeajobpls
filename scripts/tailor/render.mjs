// ResumeDoc → HTML in the layout of Jake's resume template (the LaTeX one most
// student resumes start from), adjusted by doc.style for resumes in other styles.
// Sizes follow the LaTeX source at 11pt: \small = 10pt (0.91em), \large = 12pt,
// \Huge = 24.88pt, 0.5in margins, entries indented 0.15in with their header row
// 97% wide. All sizes are in em so the page can be scaled to fit.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** LaTeX's dashes: --- is an em dash, -- an en dash (date ranges). */
const dashes = (s) => s.replace(/---/g, '\u2014').replace(/--/g, '\u2013');

/** Escape, then allow **bold** and *italic*. */
export function inline(s) {
  return dashes(esc(s))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
}

const isEmail = (t) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t.trim());
const isWeb = (t) => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t.trim()) && !/^\d/.test(t.trim());

/**
 * Contact items on two lines like the template: location, phone, email and
 * LinkedIn first; GitHub, websites and other links second. One line when
 * there's nothing for the second.
 */
export function contactLines(items) {
  const second = items.filter((t) => isWeb(t) && !isEmail(t) && !/linkedin\./i.test(t));
  const first = items.filter((t) => !second.includes(t));
  return [first, second].filter((line) => line.length);
}

/** Link emails and web addresses in the contact line, like the LaTeX template does. */
export function contactItem(text) {
  const t = text.trim();
  if (isEmail(t)) return `<a href="mailto:${esc(t)}">${esc(t)}</a>`;
  if (isWeb(t)) {
    const href = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    return `<a href="${esc(href)}">${esc(t.replace(/^https?:\/\//i, ''))}</a>`;
  }
  return esc(t);
}

const FONT_STACKS = {
  'computer-modern': '"CMU Serif", "Latin Modern Roman", "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
  garamond: '"EB Garamond", Garamond, "Times New Roman", serif',
  sans: 'Helvetica, Arial, sans-serif',
};

function css(style, scale) {
  const accent = style.accent || '#000';
  const heading = {
    'smallcaps-rule': 'font-variant: small-caps; font-weight: normal; font-size: 1.09em; border-bottom: 0.4pt solid #000;',
    'caps-rule': 'text-transform: uppercase; letter-spacing: .04em; font-weight: bold; font-size: 1em; border-bottom: 0.6pt solid #000;',
    'bold-rule': 'font-weight: bold; font-size: 1.1em; border-bottom: 0.6pt solid #000;',
    bold: 'font-weight: bold; font-size: 1.1em;',
  }[style.headings];
  return `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: ${(11 * scale).toFixed(2)}pt; }
/* LaTeX's baselines: 13.6pt at 11pt, 12pt at \\small. */
body { font-family: ${FONT_STACKS[style.font]}; color: #000; background: #fff; line-height: 1.236; -webkit-print-color-adjust: exact; }
.page { width: 8.5in; padding: 0.5in; }
/* One underline weight for every link (LaTeX's \\underline varies between viewers). */
a { color: inherit; text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 0.4pt; }
header { text-align: ${style.nameAlign}; }
/* Computer Modern has no bold small caps, so pdflatex prints the template's \\scshape name as plain bold. */
h1 { font-size: 2.26em; font-weight: bold; line-height: 1.1; color: ${accent};${style.headings === 'smallcaps-rule' && style.font !== 'computer-modern' ? ' font-variant: small-caps;' : ''} }
.contact { font-size: 0.91em; margin-top: 0.1em; line-height: 1.3; }
header { margin-bottom: 0.75em; }
.contact .item { white-space: nowrap; }
h2 { ${heading} color: ${accent}; margin: 0.65em 0 0.3em; padding-bottom: 0.1em; line-height: 1.2; }
section:first-of-type h2 { margin-top: 0; }
.entries { padding-left: 0.15in; }
/* Even gaps between entries, whatever their bullet count. */
.entry + .entry { margin-top: 0.3em; }
/* Header rows are 0.97\\textwidth, starting at the entry indent like the template's tabular*. */
.row { display: flex; justify-content: space-between; gap: 1em; width: calc(0.97 * 7.5in); }
.row > :last-child { flex-shrink: 0; text-align: right; }
.title { font-weight: bold; }
.title-detail { font-weight: normal; }
/* Project headings: title and tech stack are \\small, the date stays full size. */
.row.project .title { font-size: 0.91em; }
.sub { font-style: italic; font-size: 0.91em; line-height: 1.36; }
ul { margin: 0 0 0 2.2em; padding: 0; }
li { font-size: 0.91em; line-height: 1.2; }
li + li { margin-top: 0.06em; }
li::marker { font-size: 0.9em; }
/* No last line holding a single word. */
li, .text p { text-wrap: pretty; }
.text p { font-size: 0.91em; line-height: 1.2; padding-left: 0.15in; margin-bottom: 0.15em; }
.skills { font-size: 0.91em; line-height: 1.2; padding-left: 0.15in; }
.skills b { font-weight: bold; }
`;
}

function entry(e) {
  // A web address in the tech stack ("React | example.com") is linked, like the template's \\href.
  const detail = e.titleDetail.split(' | ').map((p) => (isWeb(p) && !isEmail(p) ? contactItem(p) : esc(p))).join(' | ');
  const titleDetail = e.titleDetail ? ` <span class="title-detail">| ${detail}</span>` : '';
  const top = `<div class="row${e.titleDetail ? ' project' : ''}"><span class="title">${inline(e.title)}${titleDetail}</span><span>${dashes(esc(e.date))}</span></div>`;
  const sub = e.subtitle || e.location
    ? `<div class="row sub"><span>${inline(e.subtitle)}</span><span>${esc(e.location)}</span></div>`
    : '';
  const bullets = e.bullets.length ? `<ul>${e.bullets.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>` : '';
  return `<div class="entry">${top}${sub}${bullets}</div>`;
}

function section(s) {
  let body = '';
  if (s.kind === 'entries') body = `<div class="entries">${s.entries.map(entry).join('')}</div>`;
  else if (s.kind === 'skills') body = `<div class="skills">${s.skills.map((l) => `<div><b>${esc(l.label)}</b>: ${esc(l.items.join(', '))}</div>`).join('')}</div>`;
  else body = `<div class="text">${s.paragraphs.map((p) => `<p>${inline(p)}</p>`).join('')}</div>`;
  return `<section><h2>${esc(s.heading)}</h2>${body}</section>`;
}

/** Run in the page once fonts have loaded: hide a separator where the contact line wraps. */
export function hideWrappedSeparators() {
  for (const sep of document.querySelectorAll('.contact .sep')) {
    const a = sep.previousElementSibling;
    const b = sep.nextElementSibling;
    if (a && b && a.getBoundingClientRect().top !== b.getBoundingClientRect().top) sep.style.display = 'none';
  }
}

/**
 * @param doc normalized ResumeDoc
 * @param opts.scale font scale (1 = 11pt body)
 * @param opts.fontCss @font-face rules (data URIs) for the chosen font
 */
export function renderHtml(doc, { scale = 1, fontCss = '' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)}</title>
<style>${fontCss}${css(doc.style, scale)}</style></head><body><div class="page">
<header><h1>${esc(doc.name)}</h1><div class="contact">${contactLines(doc.contact).map((line) => `<div>${line.map((c) => `<span class="item">${contactItem(c)}</span>`).join(' <span class="sep">|</span> ')}</div>`).join('')}</div></header>
${doc.sections.map(section).join('\n')}
</div></body></html>`;
}
