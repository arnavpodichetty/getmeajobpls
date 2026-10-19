// Shapes exchanged with Claude. A resume is read once into a ResumeDoc; each
// tailoring run returns a Tailoring that only points into that doc (by index)
// and rewords bullets, so names, employers, titles, dates and schools are never
// written by the model.
//
// ResumeDoc {
//   name: string
//   contact: string[]                      // "City, ST", phone, email, linkedin.com/in/…
//   style: { font, headings, nameAlign, accent }
//   sections: [{ heading, kind: 'entries' | 'text' | 'skills', entries, paragraphs, skills }]
// }
// Entry { title, titleDetail, date, subtitle, location, bullets: string[] }
// Inline formatting in bullets and paragraphs: **bold** and *italic*.

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const int = { type: 'integer', minimum: 0 };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const FONTS = ['computer-modern', 'times', 'garamond', 'sans'];
export const HEADINGS = ['smallcaps-rule', 'caps-rule', 'bold-rule', 'bold'];

export const resumeDocSchema = obj({
  name: str,
  contact: strs,
  style: obj({
    font: { type: 'string', enum: FONTS },
    headings: { type: 'string', enum: HEADINGS },
    nameAlign: { type: 'string', enum: ['center', 'left'] },
    accent: { type: 'string', description: 'Hex color of headings/name if not black, else ""' },
  }),
  sections: {
    type: 'array',
    items: obj({
      heading: str,
      kind: { type: 'string', enum: ['entries', 'text', 'skills'] },
      entries: {
        type: 'array',
        items: obj({ title: str, titleDetail: str, date: str, subtitle: str, location: str, bullets: strs }),
      },
      paragraphs: strs,
      skills: { type: 'array', items: obj({ label: str, items: strs }) },
    }),
  },
});

export const tailoringSchema = obj({
  entries: {
    type: 'array',
    items: obj({
      section: int,
      entry: int,
      relevance: { type: 'integer', minimum: 1, maximum: 5 },
      titleDetail: str,
      bullets: { type: 'array', items: obj({ text: str, from: { type: 'array', items: int } }) },
    }),
  },
  skills: {
    type: 'array',
    items: obj({ section: int, lines: { type: 'array', items: obj({ label: str, items: strs }) } }),
  },
  drop: { type: 'array', items: obj({ section: int, entry: int }) },
  add: {
    type: 'array',
    items: obj({
      kind: { type: 'string', enum: ['experience', 'projects'] },
      index: int,
      relevance: { type: 'integer', minimum: 1, maximum: 5 },
      bullets: { type: 'array', items: obj({ text: str, from: { type: 'array', items: int } }) },
    }),
  },
  changes: strs,
});

export const DEFAULT_STYLE = { font: 'computer-modern', headings: 'smallcaps-rule', nameAlign: 'center', accent: '' };

/** Fill in anything missing so rendering never sees undefined. */
export function normalizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const s = d.style ?? {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const text = (v) => (typeof v === 'string' ? v : '');
  return {
    name: text(d.name),
    contact: list(d.contact),
    style: {
      font: FONTS.includes(s.font) ? s.font : DEFAULT_STYLE.font,
      headings: HEADINGS.includes(s.headings) ? s.headings : DEFAULT_STYLE.headings,
      nameAlign: s.nameAlign === 'left' ? 'left' : 'center',
      accent: /^#[0-9a-f]{3,8}$/i.test(s.accent ?? '') ? s.accent : '',
    },
    sections: (Array.isArray(d.sections) ? d.sections : []).map((sec) => ({
      heading: text(sec?.heading),
      kind: ['entries', 'text', 'skills'].includes(sec?.kind) ? sec.kind : 'text',
      entries: (Array.isArray(sec?.entries) ? sec.entries : []).map((e) => ({
        title: text(e?.title),
        titleDetail: text(e?.titleDetail),
        date: text(e?.date),
        subtitle: text(e?.subtitle),
        location: text(e?.location),
        bullets: list(e?.bullets),
      })),
      paragraphs: list(sec?.paragraphs),
      skills: (Array.isArray(sec?.skills) ? sec.skills : []).map((l) => ({ label: text(l?.label), items: list(l?.items) })),
    })),
  };
}
