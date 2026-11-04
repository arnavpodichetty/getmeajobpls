// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../src/lib/defaults';
import { linesFromDoc } from '../src/lib/pdfText';
import { planImport } from '../src/lib/profileImport';
import { monthYear, parseResume } from '../src/lib/resumeParse';

async function read(name: string) {
  const data = new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
  const doc = await pdfjs.getDocument({ data }).promise;
  const { lines, links } = await linesFromDoc(doc as never);
  return parseResume(lines, links);
}

describe('resume PDF without Claude', () => {
  it('reads a one-column resume with right-aligned dates (resume-a.pdf)', async () => {
    const d = await read('resume-a');
    expect(d.personal).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada.lovelace@example.com', phone: '(415) 555-0100' });
    // "London, UK" is a city and country, not a US state.
    expect(d.personal.state).toBe('');
    expect(d.links).toMatchObject({ linkedin: 'https://linkedin.com/in/ada-example', github: 'https://github.com/ada-example', website: '' });
    expect(d.education).toEqual([
      { school: 'University of London', degree: 'B.S.', major: 'Mathematics', minor: 'Music', gpa: '3.92', coursework: 'Analysis, Number Theory, Probability', start: '2024-09', end: '2028-05' },
    ]);
    expect(d.experience).toHaveLength(2);
    expect(d.experience[0]).toMatchObject({ company: 'Analytical Engines Ltd', title: 'Software Engineering Intern', location: 'London, UK', start: '2026-06', end: '', current: true });
    // A bullet that wraps onto a second line stays one line.
    expect(d.experience[0].description.split('\n')).toHaveLength(2);
    expect(d.experience[0].description).toContain('across the full card deck of the machine');
    expect(d.experience[1]).toMatchObject({ company: 'Royal Society', title: 'Research Assistant', location: 'Remote', start: '2025-09', end: '2025-12', current: false });
    expect(d.projects).toEqual([{ name: 'Loom Planner', role: '', url: '', start: '', end: '2026-01', description: 'Scheduled punch cards for a weaving loom' }]);
    // Programming languages are skills, and a skill that wraps stays whole.
    expect(d.skills).toEqual(['Python', 'SQL', 'Java', 'Git', 'pandas', 'Statistical Modeling', 'A/B Testing', 'Experiment Design', 'Data Visualization', 'Technical Writing']);
    expect(d.languages).toEqual([]);
  });

  it('reads a resume with the title first, inline dates and hidden links (resume-b.pdf)', async () => {
    const d = await read('resume-b');
    expect(d.personal).toMatchObject({ firstName: 'Ada', middleName: 'K', lastName: 'Lovelace', street: '12 Example St', city: 'Springfield', state: 'IL', zip: '62701', email: 'ada@example.com' });
    expect(d.personal.phone.replace(/\D/g, '')).toBe('14155550100');
    // "LinkedIn" and "Portfolio site" are words with the address behind them.
    expect(d.links.linkedin).toBe('https://www.linkedin.com/in/ada-example/');
    expect(d.links.website || d.links.portfolio).toBe('https://ada.example.dev/');
    expect(d.experience[0]).toMatchObject({ company: 'Example Group', title: 'Data Analyst', location: 'Chicago, IL', start: '2025-06', end: '2025-08' });
    expect(d.experience[0].description).toBe('Built weekly sales dashboards\nCut report time in half');
    expect(d.experience[1]).toMatchObject({ company: 'Acme College', title: 'Teaching Assistant', start: '2024-01', end: '2024-05' });
    expect(d.education[0]).toMatchObject({ school: 'Acme College', degree: 'Bachelor of Science', major: 'Statistics', gpa: '3.7', end: '2025-05' });
    expect(d.skills).toEqual(['Excel', 'Tableau', 'R']);
    expect(d.languages).toEqual([{ language: 'English', proficiency: 'Native' }, { language: 'Spanish', proficiency: 'Fluent' }]);
  });

  it('feeds the same review list as the Claude reader', async () => {
    const items = planImport(emptyProfile(), await read('resume-a'));
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(['First name', 'Email', 'Add University of London', 'Add Software Engineering Intern at Analytical Engines Ltd', 'Add Loom Planner']));
  });

  it('reads month and year', () => {
    expect(monthYear('Sept 2025')).toBe('2025-09');
    expect(monthYear('May, 2027')).toBe('2027-05');
    expect(monthYear('06/2026')).toBe('2026-06');
    expect(monthYear('Summer 2026')).toBe('');
    expect(monthYear('2026')).toBe('');
  });
});
