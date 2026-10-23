import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper module (scripts/tailor runs in Node, outside the extension build)
import { applyTailoring, namedIn, terms, unsupported } from '../scripts/tailor/guard.mjs';
// @ts-expect-error plain JS helper module
import { contactItem, contactLines, inline, renderHtml } from '../scripts/tailor/render.mjs';
// @ts-expect-error plain JS helper module
import { trimOnce } from '../scripts/tailor/fit.mjs';
// @ts-expect-error plain JS helper module
import { normalizeDoc } from '../scripts/tailor/schema.mjs';
import { htmlToText, postingSource } from '../src/lib/posting';
import { pickResume } from '../src/lib/resumeRules';
import { jobLabel } from '../src/lib/tailor';
import { findTailored, jobKey } from '../src/lib/tailorMatch';
import type { ResumeMeta } from '../src/lib/types';

const base = normalizeDoc({
  name: 'Ada Lovelace',
  contact: ['London, UK', 'ada@example.com', 'github.com/ada-example'],
  sections: [
    {
      heading: 'Experience',
      kind: 'entries',
      entries: [
        {
          title: 'Initech',
          date: 'Jun 2026 – Aug 2026',
          subtitle: 'Machine Learning Intern',
          location: 'Austin, TX',
          bullets: [
            'Built a churn model in Python with XGBoost on 1.2M records, raising recall by 14%',
            'Wrote SQL pipelines in PostgreSQL that cut refresh time from 3 hours to 25 minutes',
            'Presented results to 4 product teams',
          ],
        },
      ],
    },
    {
      heading: 'Projects',
      kind: 'entries',
      entries: [{ title: 'Recipe Search', titleDetail: 'Python, FastAPI, pgvector, React', date: '2026', bullets: ['Built semantic search over 40K recipes'] }],
    },
    { heading: 'Publications', kind: 'text', paragraphs: ['A. Lovelace. *Notes on the Engine*. 1843.'] },
    {
      heading: 'Skills',
      kind: 'skills',
      skills: [
        { label: 'Languages', items: ['Python', 'SQL', 'Java'] },
        { label: 'Tools', items: ['Docker', 'Git'] },
      ],
    },
  ],
});

const bulletsOf = (doc: typeof base, s = 0, e = 0) => doc.sections[s].entries[e].bullets;

describe('tailoring guard', () => {
  it('keeps rewordings backed by their cited bullets, in the new order', () => {
    const { doc, warnings } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [
        { text: 'Reduced PostgreSQL pipeline refresh time from 3 hours to 25 minutes with SQL', from: [1] },
        { text: 'Built a Python churn model with XGBoost on 1.2M records, raising recall 14%', from: [0] },
      ] }],
    });
    expect(warnings).toEqual([]);
    expect(bulletsOf(doc)).toEqual([
      'Reduced PostgreSQL pipeline refresh time from 3 hours to 25 minutes with SQL',
      'Built a Python churn model with XGBoost on 1.2M records, raising recall 14%',
    ]);
  });

  it('restores the original bullet when a rewrite adds a number', () => {
    const { doc, warnings } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [{ text: 'Presented results to 12 product teams', from: [2] }] }],
    });
    expect(bulletsOf(doc)).toEqual(['Presented results to 4 product teams']);
    expect(warnings[0]).toMatch(/"12"/);
  });

  it('restores the original bullet when a rewrite adds a tool from the posting', () => {
    const { doc, warnings } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [{ text: 'Wrote Spark and SQL pipelines in PostgreSQL that cut refresh time from 3 hours to 25 minutes', from: [1] }] }],
    });
    expect(bulletsOf(doc)).toEqual([base.sections[0].entries[0].bullets[1]]);
    expect(warnings[0]).toMatch(/"Spark"/);
  });

  it('does not let a bullet borrow a tool from another bullet or the skills section', () => {
    // Docker is in Skills and XGBoost is in bullet 0, but bullet 2 cites only itself.
    expect(unsupported('Presented Docker results to 4 product teams', base.sections[0].entries[0].bullets[2])).toMatch(/Docker/);
    expect(unsupported('Presented XGBoost results to 4 product teams', base.sections[0].entries[0].bullets[2])).toMatch(/XGBoost/);
  });

  it('drops bullets with no valid source and falls back to the originals when none survive', () => {
    const { doc } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [{ text: 'Led a team', from: [] }, { text: 'Did things', from: [9] }] }],
    });
    expect(bulletsOf(doc)).toEqual(base.sections[0].entries[0].bullets);
  });

  it('never repeats an original bullet when several rewrites fall back to it', () => {
    const { doc } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [
        { text: 'Presented to 9 teams', from: [2] },
        { text: 'Presented to 10 teams', from: [2] },
      ] }],
    });
    expect(bulletsOf(doc)).toEqual(['Presented results to 4 product teams']);
  });

  it('only reorders or drops tech-stack and skill items, keeping the original spelling', () => {
    const { doc } = applyTailoring(base, {
      entries: [{ section: 1, entry: 0, titleDetail: 'pgvector, python, Kubernetes', bullets: [] }],
      skills: [{ section: 3, lines: [{ label: 'languages', items: ['sql', 'Python', 'Rust'] }, { label: 'Cloud', items: ['AWS'] }] }],
    });
    expect(doc.sections[1].entries[0].titleDetail).toBe('pgvector, Python');
    expect(doc.sections[3].skills).toEqual([
      { label: 'Languages', items: ['SQL', 'Python'] },
      { label: 'Tools', items: ['Docker', 'Git'] },
    ]);
  });

  it('ignores anything outside entries and skills (names, dates, publications)', () => {
    const { doc } = applyTailoring(base, {
      entries: [{ section: 2, entry: 0, titleDetail: 'x', bullets: [{ text: 'x', from: [0] }] }],
      skills: [{ section: 0, lines: [{ label: 'Languages', items: [] }] }],
    });
    expect(doc).toEqual(base);
  });

  it('treats tools, acronyms and versions as terms but not ordinary sentence words', () => {
    expect(terms('Built pipelines in Node.js and C++ on AWS for the Data team. Improved runtime')).toEqual(['Node.js', 'C++', 'AWS', 'Data']);
  });
});

describe('resume template', () => {
  it('escapes HTML and supports **bold** and *italic*', () => {
    expect(inline('**Coursework:** <script> & *Notes*')).toBe('<b>Coursework:</b> &lt;script&gt; &amp; <i>Notes</i>');
  });

  it('links emails and web addresses in the contact line, but not phone numbers or places', () => {
    expect(contactItem('ada@example.com')).toBe('<a href="mailto:ada@example.com">ada@example.com</a>');
    expect(contactItem('github.com/ada-example')).toBe('<a href="https://github.com/ada-example">github.com/ada-example</a>');
    expect(contactItem('555-010-1815')).toBe('555-010-1815');
    expect(contactItem('London, UK')).toBe('London, UK');
  });

  it('puts location, phone, email and LinkedIn on the first contact line and other links on the second', () => {
    expect(contactLines(['London, UK', '555-010-1815', 'ada@example.com', 'linkedin.com/in/ada', 'github.com/ada', 'ada.dev'])).toEqual([
      ['London, UK', '555-010-1815', 'ada@example.com', 'linkedin.com/in/ada'],
      ['github.com/ada', 'ada.dev'],
    ]);
    expect(contactLines(['London, UK', 'ada@example.com'])).toEqual([['London, UK', 'ada@example.com']]);
  });

  it('renders every section kind', () => {
    const html = renderHtml(base);
    expect(html).toContain('<h1>Ada Lovelace</h1>');
    expect(html).toContain('<span class="title-detail">| Python, FastAPI, pgvector, React</span>');
    expect(html).toContain('<i>Notes on the Engine</i>');
    expect(html).toContain('<b>Languages</b>: Python, SQL, Java');
  });

  it('links a web address in a project tech stack and turns -- into an en dash', () => {
    const doc = structuredClone(base);
    const project = doc.sections.flatMap((s: { entries: { titleDetail: string; date: string }[] }) => s.entries).find((e: { titleDetail: string }) => e.titleDetail)!;
    project.titleDetail = 'React | ada.dev';
    project.date = 'Jun 2026 -- Present';
    const html = renderHtml(doc);
    expect(html).toContain('<span class="title-detail">| React | <a href="https://ada.dev">ada.dev</a></span>');
    expect(html).toContain('Jun 2026 – Present');
  });
});

describe('tailored resumes in the library', () => {
  const r = (id: string, extra: Partial<ResumeMeta> = {}): ResumeMeta => ({
    id, name: id, tags: [], skills: [], fileName: 'resume.pdf', mimeType: 'application/pdf', size: 1, uploadedAt: 0, isDefault: false, ...extra,
  });

  it('are never picked by rules or as the fallback', () => {
    const resumes = [r('tailored', { tailoredFrom: 'own', uploadedAt: -1 }), r('own')];
    expect(pickResume(resumes, [{ id: 'x', keywords: ['data'], resumeId: 'tailored' }], { title: 'Data Engineer', text: '' })?.resumeId).toBe('own');
  });

  it('are labeled with a short job name', () => {
    expect(jobLabel('Job Application for Data Engineering Intern at Hooli')).toBe('Data Engineering Intern at Hooli');
  });
});

describe('reusing a tailored copy for the same job', () => {
  const r = (id: string, extra: Partial<ResumeMeta> = {}): ResumeMeta => ({
    id, name: id, tags: [], skills: [], fileName: 'resume.pdf', mimeType: 'application/pdf', size: 1, uploadedAt: 0, isDefault: false, ...extra,
  });

  it('treats a posting and its application steps as the same job', () => {
    const posting = jobKey('https://jobs.lever.co/hooli/1a2b3c?lever-source=LinkedIn');
    expect(jobKey('https://jobs.lever.co/hooli/1a2b3c/apply')).toBe(posting);
    expect(jobKey('https://www.jobs.lever.co/Hooli/1a2b3c/')).toBe(posting);
    expect(jobKey('https://hooli.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Data-Intern_JR123/apply/applyManually'))
      .toBe(jobKey('https://hooli.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Data-Intern_JR123'));
    expect(jobKey('https://jobs.ashbyhq.com/hooli/9f8e/application')).toBe(jobKey('https://jobs.ashbyhq.com/hooli/9f8e'));
  });

  it('keeps job ids in the query and tells different jobs apart', () => {
    expect(jobKey('https://hooli.com/careers?gh_jid=111&utm_source=x')).toBe(jobKey('https://hooli.com/careers?gh_jid=111'));
    expect(jobKey('https://hooli.com/careers?gh_jid=111')).not.toBe(jobKey('https://hooli.com/careers?gh_jid=222'));
    expect(jobKey('https://jobs.lever.co/hooli/1a2b3c')).not.toBe(jobKey('https://jobs.lever.co/hooli/4d5e6f'));
  });

  const library = [
    r('data'),
    r('old', { tailoredFrom: 'data', tailoredUrl: 'https://jobs.lever.co/hooli/1a2b3c', tailoredFor: 'Data Intern at Hooli', uploadedAt: 1 }),
    r('new', { tailoredFrom: 'data', tailoredUrl: 'https://jobs.lever.co/hooli/1a2b3c/apply', tailoredFor: 'Data Intern at Hooli', uploadedAt: 2 }),
    r('ml-copy', { tailoredFrom: 'ml', tailoredUrl: 'https://jobs.lever.co/hooli/1a2b3c', tailoredFor: 'Data Intern at Hooli', uploadedAt: 3 }),
  ];

  it('finds the newest copy made from the same resume for this job', () => {
    expect(findTailored(library, 'data', 'https://jobs.lever.co/hooli/1a2b3c/apply', '')?.id).toBe('new');
    expect(findTailored(library, 'ml', 'https://jobs.lever.co/hooli/1a2b3c', '')?.id).toBe('ml-copy');
    expect(findTailored(library, 'pm', 'https://jobs.lever.co/hooli/1a2b3c', '')).toBeUndefined();
  });

  it('matches by job title only on the same site', () => {
    expect(findTailored(library, 'data', 'https://jobs.lever.co/hooli/other-url', 'Data Intern at Hooli')?.id).toBe('new');
    expect(findTailored(library, 'data', 'https://boards.greenhouse.io/hooli/jobs/5', 'Data Intern at Hooli')).toBeUndefined();
    expect(findTailored(library, 'data', 'https://jobs.lever.co/hooli/other-url', '')).toBeUndefined();
  });
});

describe('fitting one page', () => {
  const doc = (extra: Record<string, unknown> = {}) => normalizeDoc({
    name: 'Ada Lovelace',
    sections: [
      { heading: 'Education', kind: 'entries', entries: [{ title: 'University', bullets: ['Coursework: A', 'Honors: B'] }] },
      { heading: 'Experience', kind: 'entries', entries: [
        { title: 'Initech', bullets: ['i1', 'i2', 'i3'] },
        { title: 'Globex', bullets: ['g1', 'g2', 'g3'] },
        { title: 'Hooli', bullets: ['h1'] },
      ] },
      { heading: 'Projects', kind: 'entries', entries: [
        { title: 'Engine', bullets: ['e1'] },
        { title: 'Loom', bullets: ['l1'] },
      ] },
    ],
    ...extra,
  });

  it('cuts the last bullet of the longest entry, preferring the less relevant one, never education', () => {
    const d = doc();
    d.sections[1].entries[0].relevance = 5;
    d.sections[1].entries[1].relevance = 2;
    const { doc: out, note } = trimOnce(d);
    expect(out.sections[1].entries[1].bullets).toEqual(['g1', 'g2']);
    expect(out.sections[1].entries[0].bullets).toEqual(['i1', 'i2', 'i3']);
    expect(note).toMatch(/Globex.*g3/);
  });

  it('leaves every entry at least one bullet, then drops the least relevant project but keeps one', () => {
    let d = doc();
    d.sections[2].entries[0].relevance = 1;
    const notes: string[] = [];
    for (let r = trimOnce(d); r; r = trimOnce(d)) {
      d = r.doc;
      notes.push(r.note);
    }
    expect(d.sections[0].entries[0].bullets).toEqual(['Coursework: A', 'Honors: B']);
    expect(d.sections[1].entries.map((e: { bullets: string[] }) => e.bullets)).toEqual([['i1'], ['g1'], ['h1']]);
    expect(d.sections[2].entries.map((e: { title: string }) => e.title)).toEqual(['Loom']);
    expect(notes.at(-1)).toMatch(/Engine project/);
  });
});

describe('tailoring from the resume plus your profile', async () => {
  // @ts-expect-error plain JS helper module
  const { descriptionLines, dateRange, normalizeLibrary } = await import('../scripts/tailor/library.mjs');
  const lib = normalizeLibrary({
    experience: [
      // Same company as the resume entry: its lines become extra sources for that entry.
      { company: 'Initech, Inc.', title: 'Machine Learning Intern', start: '2026-06', end: '2026-08', description: 'Built a churn model in Python with XGBoost on 1.2M records\nMentored 2 new interns on model evaluation' },
      // Not on the resume: may be added.
      { company: 'Hooli', title: 'Data Engineering Intern', location: 'Mountain View, CA', start: '2025-06', end: '2025-08', description: '- Built Airflow DAGs that load 3TB of logs daily into BigQuery\n- Cut pipeline failures by 60% with data quality checks' },
      { company: 'Globex', title: 'Analyst', start: '2026-09', current: true, description: 'Current analytics work in SQL' },
    ],
    projects: [{ name: 'Loom Scheduler', start: '2026-01', end: '2026-03', description: 'Scheduled jobs across 5 workers with Redis queues.' }],
    skills: ['Airflow', 'BigQuery', 'Python'],
  });

  it('reads descriptions one point per line, or sentence by sentence', () => {
    expect(descriptionLines('- One\n• Two\n\nThree')).toEqual(['One', 'Two', 'Three']);
    expect(descriptionLines('Built X. Shipped Y to 3 teams.')).toEqual(['Built X.', 'Shipped Y to 3 teams.']);
    expect(dateRange('2026-09', '', true)).toBe('Sep 2026 – Present');
  });

  it('lets a resume entry cite its matching profile entry', () => {
    // Initech has 3 resume bullets (0-2); profile lines continue at 3.
    const { doc, warnings } = applyTailoring(base, {
      entries: [{ section: 0, entry: 0, titleDetail: '', bullets: [
        { text: 'Built a Python churn model with XGBoost on 1.2M records', from: [0] },
        { text: 'Mentored 2 new interns on model evaluation', from: [4] },
      ] }],
    }, lib);
    expect(warnings).toEqual([]);
    expect(bulletsOf(doc)).toContain('Mentored 2 new interns on model evaluation');
  });

  it('adds a profile entry with fields copied from the profile, and checks its bullets against its own lines', () => {
    const { doc, swaps, warnings } = applyTailoring(base, {
      add: [{ kind: 'experience', index: 1, relevance: 5, bullets: [
        { text: 'Built Airflow DAGs loading 3TB of logs into BigQuery daily', from: [0] },
        { text: 'Cut pipeline failures by 75% with dbt tests', from: [1] },
      ] }],
    }, lib);
    const hooli = doc.sections[0].entries.find((e: { title: string }) => e.title === 'Hooli');
    expect(hooli).toMatchObject({ subtitle: 'Data Engineering Intern', date: 'Jun 2025 – Aug 2025', location: 'Mountain View, CA', relevance: 5 });
    expect(hooli.bullets).toEqual(['Built Airflow DAGs loading 3TB of logs into BigQuery daily', 'Cut pipeline failures by 60% with data quality checks']);
    expect(warnings[0]).toMatch(/"75"/);
    expect(swaps).toEqual(['Added Hooli from your profile.']);
    // Newest first: the 2025 role goes after the 2026 one.
    expect(doc.sections[0].entries.map((e: { title: string }) => e.title)).toEqual(['Initech', 'Hooli']);
  });

  it('never adds an entry that is already on the resume, or one with no supported bullet', () => {
    const { doc } = applyTailoring(base, {
      add: [
        { kind: 'experience', index: 0, bullets: [{ text: 'Mentored 2 new interns', from: [1] }] },
        { kind: 'projects', index: 0, bullets: [{ text: 'x', from: [] }] },
      ],
    }, lib);
    expect(doc.sections[0].entries).toHaveLength(1);
    expect(doc.sections[1].entries).toHaveLength(1);
  });

  it('drops a role or project only when allowed', () => {
    const withCurrent = normalizeDoc({ ...base, sections: [
      { heading: 'Education', kind: 'entries', entries: [{ title: 'University', date: '2027', bullets: [] }] },
      { heading: 'Experience', kind: 'entries', entries: [
        { title: 'Globex', date: 'Sep 2026 – Present', bullets: ['SQL work'] },
        { title: 'Initech', date: 'Jun 2026 – Aug 2026', bullets: ['Churn model'] },
        { title: 'Umbrella', date: '2025', bullets: ['Tests'] },
      ] },
      { heading: 'Projects', kind: 'entries', entries: [{ title: 'Recipe Search', date: '2026', bullets: ['Search'] }] },
    ] });
    const { doc, swaps } = applyTailoring(withCurrent, {
      drop: [{ section: 0, entry: 0 }, { section: 1, entry: 0 }, { section: 1, entry: 2 }, { section: 2, entry: 0 }],
    });
    expect(doc.sections[0].entries).toHaveLength(1); // education
    expect(doc.sections[1].entries.map((e: { title: string }) => e.title)).toEqual(['Globex', 'Initech']); // current role stays
    expect(doc.sections[2].entries).toHaveLength(1); // last project stays
    expect(swaps).toEqual(['Removed Umbrella to make room for more relevant work.']);
  });

  it('allows skills from your profile, once each', () => {
    const { doc } = applyTailoring(base, {
      skills: [{ section: 3, lines: [{ label: 'Languages', items: ['Python', 'SQL'] }, { label: 'Tools', items: ['Airflow', 'Python', 'Kubernetes', 'Docker'] }] }],
    }, lib);
    expect(doc.sections[3].skills).toEqual([
      { label: 'Languages', items: ['Python', 'SQL'] },
      { label: 'Tools', items: ['Airflow', 'Docker'] },
    ]);
  });
});

describe('skills the posting names', async () => {
  // @ts-expect-error plain JS helper module
  const { normalizeLibrary } = await import('../scripts/tailor/library.mjs');
  const lib = normalizeLibrary({ skills: ['Jira', 'Codex', 'Notion', 'Linear', 'Agile/Scrum', 'Product Analytics', 'Kubernetes'] });
  const posting = 'Use AI tools such as Acme Codex. Familiarity with Jira and product analytics is a plus. You will excel in linear algebra and take notes. Join sprint planning with agile teams.';

  it('matches names as the posting writes them, not everyday words', () => {
    expect(namedIn('Codex', posting)).toBe(true);
    expect(namedIn('Product Analytics', posting)).toBe(true);
    expect(namedIn('Agile/Scrum', posting)).toBe(true);
    expect(namedIn('Linear', posting)).toBe(false); // "linear algebra"
    expect(namedIn('Git', 'GitLab experience')).toBe(false);
    expect(namedIn('Excel', 'You will excel here')).toBe(false);
    expect(namedIn('Excel', 'Experience with Excel')).toBe(true);
  });

  it('adds profile skills the tailoring left out, first in the line, without growing it', () => {
    const { doc, swaps } = applyTailoring(base, {
      skills: [{ section: 3, lines: [{ label: 'Languages', items: ['Python', 'SQL', 'Java'] }, { label: 'Tools', items: ['Docker', 'Git'] }] }],
    }, lib, posting);
    const tools = doc.sections[3].skills[1];
    expect(tools.label).toBe('Tools');
    expect(tools.items.slice(0, 4)).toEqual(['Jira', 'Codex', 'Agile/Scrum', 'Product Analytics']);
    expect(tools.items).not.toContain('Kubernetes');
    expect(tools.items).not.toContain('Linear');
    expect(tools.items.join(', ').length).toBeLessThanOrEqual(Math.max(16, 'Jira, Codex, Agile/Scrum, Product Analytics'.length));
    expect(doc.sections[3].skills[0].items).toEqual(['Python', 'SQL', 'Java']);
    expect(swaps).toContain('Added Jira, Codex, Agile/Scrum, Product Analytics to your skills because the posting names them.');
  });

  it('puts back a named resume skill the tailoring dropped, in its own line', () => {
    const { doc } = applyTailoring(base, {
      skills: [{ section: 3, lines: [{ label: 'Languages', items: ['SQL'] }, { label: 'Tools', items: ['Git'] }] }],
    }, { experience: [], projects: [], skills: [] }, 'We use Java and Docker.');
    expect(doc.sections[3].skills).toEqual([
      { label: 'Languages', items: ['Java', 'SQL'] },
      { label: 'Tools', items: ['Docker', 'Git'] },
    ]);
  });
});

describe('finding the job description for an application page', () => {
  const api = (url: string) => postingSource(url)?.api ?? null;

  it('maps Workday application steps to the posting in the public job API', () => {
    const job = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/US-TX-Austin/Data-Engineer_JR123';
    expect(api('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/US-TX-Austin/Data-Engineer_JR123')).toBe(job);
    expect(api('https://acme.wd5.myworkdayjobs.com/Careers/job/US-TX-Austin/Data-Engineer_JR123/apply/applyManually?source=LinkedIn')).toBe(job);
    expect(api('https://acme.wd5.myworkdayjobs.com/en-US/Careers/details/Data-Engineer_JR123')).toBe('https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/Data-Engineer_JR123');
    expect(api('https://wd1.myworkdaysite.com/en-US/recruiting/acme/Careers/job/Austin/Data-Engineer_JR123/apply')).toBe('https://wd1.myworkdaysite.com/wday/cxs/acme/Careers/job/Austin/Data-Engineer_JR123');
    expect(api('https://acme.wd5.myworkdayjobs.com/en-US/Careers')).toBeNull();
  });

  it('maps Lever, Ashby and Greenhouse postings and their application pages', () => {
    expect(api('https://jobs.lever.co/hooli/1a2b-3c/apply')).toBe('https://api.lever.co/v0/postings/hooli/1a2b-3c');
    expect(api('https://jobs.eu.lever.co/hooli/1a2b-3c')).toBe('https://api.eu.lever.co/v0/postings/hooli/1a2b-3c');
    expect(api('https://jobs.ashbyhq.com/hooli/1a2b-3c/application')).toBe('https://api.ashbyhq.com/posting-api/job-board/hooli');
    expect(api('https://job-boards.greenhouse.io/hooli/jobs/4012345')).toBe('https://boards-api.greenhouse.io/v1/boards/hooli/jobs/4012345');
    expect(api('https://job-boards.greenhouse.io/embed/job_app?for=hooli&token=4012345')).toBe('https://boards-api.greenhouse.io/v1/boards/hooli/jobs/4012345');
    expect(api('https://example.com/careers/data-engineer')).toBeNull();
  });

  it('reads the description from each API', () => {
    const workday = postingSource('https://acme.wd5.myworkdayjobs.com/Careers/job/Austin/Data-Engineer_JR123/apply')!;
    expect(workday.read({ jobPostingInfo: { title: 'Data Engineer', jobDescription: '<p>Build pipelines.</p><ul><li>SQL</li><li>Python</li></ul>' } })).toEqual({
      title: 'Data Engineer',
      text: 'Build pipelines.\n- SQL\n- Python',
    });
    const lever = postingSource('https://jobs.lever.co/hooli/abc/apply')!;
    expect(lever.read({ text: 'Data Engineer', descriptionPlain: 'Build pipelines.', lists: [{ text: 'Requirements', content: '<li>SQL</li>' }] })?.text).toBe('Build pipelines.\n\nRequirements\n- SQL');
    const ashby = postingSource('https://jobs.ashbyhq.com/hooli/ABC/application')!;
    expect(ashby.read({ jobs: [{ id: 'xyz', title: 'Other', descriptionPlain: 'No' }, { id: 'abc', title: 'Data Engineer', descriptionPlain: 'Build pipelines.' }] })).toEqual({ title: 'Data Engineer', text: 'Build pipelines.' });
    expect(ashby.read({ jobs: [] })).toBeNull();
  });

  it('turns API HTML into plain text, including Greenhouse\'s escaped HTML', () => {
    expect(htmlToText('&lt;p&gt;Pay: $100K &amp;amp; equity&lt;/p&gt;&lt;p&gt;Remote&lt;/p&gt;')).toBe('Pay: $100K & equity\nRemote');
    expect(htmlToText('<h2>About</h2><p>We&#39;re&nbsp;hiring</p>')).toBe("About\nWe're hiring");
  });
});
