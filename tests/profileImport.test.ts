import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper module (scripts/tailor runs in Node, outside the extension build)
import { appearsIn, checkProfile, checkProfileText, dateSupported, gpaSupported } from '../scripts/tailor/profile.mjs';
// @ts-expect-error plain JS helper module
import { normalizeDoc } from '../scripts/tailor/schema.mjs';
import { emptyEducation, emptyExperience, emptyProfile, normalizeProfile, phoneDigits } from '../src/lib/defaults';
import { applyImport, languageLevel, mergeDrafts, planImport, type ProfileDraft } from '../src/lib/profileImport';

const doc = normalizeDoc({
  name: 'Ada Lovelace',
  contact: ['London, UK', '(415) 555-0100', 'ada.lovelace@example.com', 'linkedin.com/in/ada-example', 'github.com/ada-example'],
  sections: [
    {
      heading: 'Education',
      kind: 'entries',
      entries: [{
        title: 'University of London', date: 'Expected May 2027', subtitle: 'B.S. in Mathematics, Minor in Music', location: 'London, UK',
        bullets: ['GPA: 3.9/4.0', 'Relevant Coursework: Analysis, Number Theory'],
      }],
    },
    {
      heading: 'Experience',
      kind: 'entries',
      entries: [
        {
          title: 'Analytical Engines Ltd', date: 'Jun 2026 – Present', subtitle: 'Software Engineering Intern', location: 'London, UK',
          bullets: ['Wrote the **first** published algorithm for the engine', 'Documented the design in 40 pages of notes'],
        },
        { title: 'Royal Society', date: 'Sept 2025 – Dec 2025', subtitle: 'Research Assistant', location: 'London, UK', bullets: ['Translated a memoir'] },
      ],
    },
    {
      heading: 'Projects',
      kind: 'entries',
      entries: [{ title: 'Bernoulli Numbers', titleDetail: 'Python', date: '2026', bullets: ['Computed the sequence', 'github.com/ada-example/bernoulli'] }],
    },
    { heading: 'Skills', kind: 'skills', skills: [{ label: 'Languages', items: ['Python', 'SQL'] }, { label: 'Certifications', items: ['First Aid'] }] },
  ],
});

/** What Claude would return when it reads the resume faithfully. */
const faithful = {
  personal: { firstName: 'Ada', middleName: '', lastName: 'Lovelace', email: 'ada.lovelace@example.com', phone: '(415) 555-0100', street: '', city: 'London', state: '', zip: '', country: 'UK' },
  links: { linkedin: 'linkedin.com/in/ada-example', github: 'github.com/ada-example', website: '', portfolio: '', twitter: '', other: '' },
  education: [{ section: 0, entry: 0, school: 'University of London', degree: 'B.S.', major: 'Mathematics', minor: 'Music', gpa: '3.9', coursework: 'Analysis, Number Theory', start: '', end: '2027-05' }],
  experience: [
    { section: 1, entry: 0, company: 'Analytical Engines Ltd', title: 'Software Engineering Intern', location: 'London, UK', start: '2026-06', end: '', current: true },
    { section: 1, entry: 1, company: 'Royal Society', title: 'Research Assistant', location: 'London, UK', start: '2025-09', end: '2025-12', current: false },
  ],
  projects: [{ section: 2, entry: 0, name: 'Bernoulli Numbers', role: '', url: 'github.com/ada-example/bernoulli', start: '', end: '' }],
  languages: [] as { language: string; proficiency: string }[],
};

describe('checking a resume read against the resume itself', () => {
  it('keeps what the resume says, copying descriptions and skills word for word', () => {
    const { draft, dropped } = checkProfile(doc, faithful);
    expect(dropped).toEqual([]);
    expect(draft.personal).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada.lovelace@example.com', phone: '(415) 555-0100', city: 'London' });
    expect(draft.links.linkedin).toBe('https://linkedin.com/in/ada-example');
    expect(draft.education[0]).toMatchObject({ school: 'University of London', degree: 'B.S.', major: 'Mathematics', gpa: '3.9', end: '2027-05' });
    expect(draft.experience[0]).toMatchObject({ current: true, end: '', start: '2026-06' });
    // Bold markers are removed; the text is the resume's own.
    expect(draft.experience[0].description).toBe('Wrote the first published algorithm for the engine\nDocumented the design in 40 pages of notes');
    expect(draft.experience[1]).toMatchObject({ start: '2025-09', end: '2025-12' });
    expect(draft.projects[0].url).toBe('https://github.com/ada-example/bernoulli');
    // Certifications aren't skills.
    expect(draft.skills).toEqual(['Python', 'SQL']);
  });

  it('drops anything the resume does not say', () => {
    const invented = structuredClone(faithful);
    invented.personal.email = 'ada@made-up.com';
    invented.personal.phone = '(212) 555-0199';
    invented.personal.middleName = 'Augusta';
    invented.links.website = 'ada.dev';
    invented.education[0].gpa = '4.0';
    invented.education[0].major = 'Computer Science';
    invented.experience[1].title = 'Senior Research Scientist';
    invented.languages = [{ language: 'French', proficiency: 'Fluent' }];
    const { draft, dropped } = checkProfile(doc, invented);
    expect(draft.personal.email).toBe('');
    expect(draft.personal.phone).toBe('');
    expect(draft.personal.middleName).toBe('');
    expect(draft.links.website).toBe('');
    expect(draft.education[0].gpa).toBe('');
    expect(draft.education[0].major).toBe('');
    expect(draft.experience[1].title).toBe('');
    expect(draft.languages).toEqual([]);
    expect(dropped).toHaveLength(8);
  });

  it('checks every value against its own entry, not the whole resume', () => {
    const swapped = structuredClone(faithful);
    // "Software Engineering Intern" is on the resume, but not in the Royal Society entry.
    swapped.experience[1].title = 'Software Engineering Intern';
    const { draft } = checkProfile(doc, swapped);
    expect(draft.experience[1].title).toBe('');
  });

  it('keeps a date only when the entry\'s date line has that month and year', () => {
    const wrong = structuredClone(faithful);
    wrong.experience[1].start = '2025-10';
    wrong.experience[1].end = '2026-12';
    wrong.projects[0].start = '2026-01'; // the resume gives only the year
    const { draft } = checkProfile(doc, wrong);
    expect(draft.experience[1].start).toBe('');
    expect(draft.experience[1].end).toBe('');
    expect(draft.projects[0].start).toBe('');
  });

  it('only marks a role current when the resume says Present', () => {
    const claimed = structuredClone(faithful);
    claimed.experience[1].current = true;
    expect(checkProfile(doc, claimed).draft.experience[1].current).toBe(false);
  });

  it('ignores entries Claude points at that do not exist', () => {
    const bad = structuredClone(faithful);
    bad.experience.push({ section: 9, entry: 0, company: 'Analytical Engines Ltd', title: '', location: '', start: '', end: '', current: false });
    expect(checkProfile(doc, bad).draft.experience).toHaveLength(2);
  });

  it('matches dates written in different ways', () => {
    expect(dateSupported('2027-05', 'Expected May 2027')).toBe(true);
    expect(dateSupported('2025-09', 'Sept 2025 – Dec 2025')).toBe(true);
    expect(dateSupported('2027-05', '05/2027')).toBe(true);
    expect(dateSupported('2027-05', "May '27")).toBe(true);
    expect(dateSupported('2027-06', 'May 2027')).toBe(false);
    expect(dateSupported('2027', '2027')).toBe(false);
  });

  it('takes the GPA, never the scale it is out of', () => {
    expect(gpaSupported('3.9', 'GPA: 3.9/4.0')).toBe(true);
    expect(gpaSupported('4.0', 'GPA: 3.9/4.0')).toBe(false);
    expect(gpaSupported('4.0', 'GPA: 3.9 / 4.0')).toBe(false);
    expect(gpaSupported('3.9', 'GPA 3.95')).toBe(false);
    expect(gpaSupported('4.0', 'Cumulative GPA: 4.0')).toBe(true);
  });

  it('matches whole words only', () => {
    expect(appearsIn('Music', 'Minor in Music')).toBe(true);
    expect(appearsIn('Art', 'Minor in Martial arts')).toBe(false);
  });
});

const draft = (): ProfileDraft => checkProfile(doc, faithful).draft;

describe('reviewing what the resume adds', () => {
  it('ticks everything for an empty profile and adds it on apply', () => {
    const profile = emptyProfile();
    const items = planImport(profile, draft());
    // Country starts as "United States", so replacing it with the resume's is your call.
    expect(items.filter((i) => !i.checked).map((i) => i.id)).toEqual(['personal:country']);
    applyImport(profile, items, new Set(items.map((i) => i.id)));
    expect(profile.personal.firstName).toBe('Ada');
    expect(profile.education.map((e) => e.school)).toEqual(['University of London']);
    expect(profile.experience.map((e) => e.company)).toEqual(['Analytical Engines Ltd', 'Royal Society']);
    expect(profile.projects).toHaveLength(1);
    expect(profile.skills).toEqual(['Python', 'SQL']);
    // A second read of the same resume has nothing left to add.
    expect(planImport(profile, draft())).toEqual([]);
  });

  it('never replaces what you filled unless you tick it', () => {
    const profile = emptyProfile();
    profile.personal.email = 'ada@work.example';
    const items = planImport(profile, draft());
    const email = items.find((i) => i.id === 'personal:email')!;
    expect(email).toMatchObject({ current: 'ada@work.example', proposed: 'ada.lovelace@example.com', checked: false });
    applyImport(profile, items, new Set(items.filter((i) => i.checked).map((i) => i.id)));
    expect(profile.personal.email).toBe('ada@work.example');
  });

  it('fills the empty fields of an entry you already have instead of adding it again', () => {
    const profile = emptyProfile();
    profile.education.push({ ...emptyEducation(), id: 'e1', school: 'University of London', major: 'Mathematics' });
    profile.experience.push({ ...emptyExperience(), id: 'x1', company: 'Royal Society', title: 'Research Assistant', description: 'My own words' });
    const items = planImport(profile, draft());
    expect(items.some((i) => i.label === 'Add University of London')).toBe(false);
    expect(items.some((i) => i.label === 'Add Research Assistant at Royal Society')).toBe(false);
    const description = items.find((i) => i.id === 'Experience:x1:description')!;
    expect(description.checked).toBe(false);
    applyImport(profile, items, new Set(items.filter((i) => i.checked).map((i) => i.id)));
    expect(profile.education).toHaveLength(1);
    expect(profile.education[0]).toMatchObject({ degree: 'B.S.', gpa: '3.9', end: '2027-05' });
    expect(profile.experience.find((x) => x.id === 'x1')).toMatchObject({ start: '2025-09', end: '2025-12', description: 'My own words' });
  });

  it('proposes the phone as digits only, and sees a saved number as the same', () => {
    const empty = emptyProfile();
    expect(planImport(empty, draft()).find((i) => i.id === 'personal:phone')?.proposed).toBe('4155550100');
    const saved = emptyProfile();
    saved.personal.phone = '4155550100';
    expect(planImport(saved, draft()).some((i) => i.id === 'personal:phone')).toBe(false);
  });

  it('adds only the skills you do not have yet', () => {
    const profile = emptyProfile();
    profile.skills = ['python'];
    const skills = planImport(profile, draft()).find((i) => i.id === 'skills:add')!;
    expect(skills.proposed).toBe('SQL');
  });

  it('leaves standard answers and EEO alone', () => {
    const profile = emptyProfile();
    const before = JSON.stringify({ answers: profile.answers, eeo: profile.eeo });
    const items = planImport(profile, draft());
    applyImport(profile, items, new Set(items.map((i) => i.id)));
    expect(JSON.stringify({ answers: profile.answers, eeo: profile.eeo })).toBe(before);
  });
});

// A profile page as the popup hands it over: the owner's details mixed with navigation and other people.
const PAGE = `Home  My Network  Jobs  Messaging
Ada Lovelace
Mathematician · London, England, United Kingdom
Contact info: ada.lovelace@example.com · github.com/ada-example
Experience
Software Engineering Intern
Analytical Engines Ltd · Internship
Jun 2026 - Present · 5 mos
London, England
Wrote the first published algorithm for the engine
Mentored current students in the reading group
Education
University of London
Bachelor of Science - BS, Mathematics
2023 - May 2027
Skills
Python · Mathematical Modeling
People also viewed
Charles Babbage
Inventor at Difference Engine Co · Cambridge
Jan 2020 - Present`;

const pageRead = {
  personal: { firstName: 'Ada', middleName: '', lastName: 'Lovelace', email: 'ada.lovelace@example.com', phone: '', street: '', city: 'London', state: '', zip: '', country: '' },
  links: { linkedin: '', github: 'github.com/ada-example', website: '', portfolio: '', twitter: '', other: '' },
  education: [{ quote: 'University of London\nBachelor of Science - BS, Mathematics\n2023 - May 2027', school: 'University of London', degree: 'Bachelor of Science', major: 'Mathematics', minor: '', gpa: '', coursework: '', start: '', end: '2027-05' }],
  experience: [{
    quote: 'Software Engineering Intern\nAnalytical Engines Ltd · Internship\nJun 2026 - Present · 5 mos\nLondon, England\nWrote the first published algorithm for the engine\nMentored current students in the reading group',
    bullets: ['Wrote the first published algorithm for the engine', 'Mentored current students in the reading group'],
    company: 'Analytical Engines Ltd', title: 'Software Engineering Intern', location: 'London, England', start: '2026-06', end: '', current: true,
  }],
  projects: [] as unknown[],
  skills: ['Python', 'Mathematical Modeling'],
  languages: [] as unknown[],
};

describe('checking a profile page or pasted text against its own text', () => {
  it('keeps what the page says, with descriptions copied from it', () => {
    const { draft, dropped } = checkProfileText(PAGE, pageRead);
    expect(dropped).toEqual([]);
    expect(draft.personal).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada.lovelace@example.com', city: 'London' });
    expect(draft.links.github).toBe('https://github.com/ada-example');
    expect(draft.experience[0]).toMatchObject({ company: 'Analytical Engines Ltd', start: '2026-06', current: true });
    expect(draft.experience[0].description).toBe('Wrote the first published algorithm for the engine\nMentored current students in the reading group');
    expect(draft.education[0]).toMatchObject({ school: 'University of London', major: 'Mathematics', end: '2027-05' });
    expect(draft.skills).toEqual(['Python', 'Mathematical Modeling']);
  });

  it('drops an entry whose quoted text is not on the page', () => {
    const bad = structuredClone(pageRead);
    bad.experience.push({ quote: 'Lead Engineer\nBabbage Labs\nJan 2020 - Present', bullets: [], company: 'Babbage Labs', title: 'Lead Engineer', location: '', start: '2020-01', end: '', current: true });
    const { draft, dropped } = checkProfileText(PAGE, bad);
    expect(draft.experience.map((e: { company: string }) => e.company)).toEqual(['Analytical Engines Ltd']);
    expect(dropped.join(' ')).toContain('Babbage Labs');
  });

  it('keeps only description lines that are in the entry, and skills that are on the page', () => {
    const bad = structuredClone(pageRead);
    bad.experience[0].bullets.push('Led a team of 12 engineers');
    bad.skills.push('Kubernetes');
    const { draft, dropped } = checkProfileText(PAGE, bad);
    expect(draft.experience[0].description).not.toContain('team of 12');
    expect(draft.skills).not.toContain('Kubernetes');
    expect(dropped).toHaveLength(2);
  });

  it('does not take a field from another part of the page', () => {
    const bad = structuredClone(pageRead);
    // "Cambridge" is on the page, but in someone else's entry, not this one's quote.
    bad.experience[0].location = 'Cambridge';
    expect(checkProfileText(PAGE, bad).draft.experience[0].location).toBe('');
  });

  it('reads "Present" from the dates, not from a description that says "current"', () => {
    const quote = 'Teaching Assistant\nUniversity of London\nSep 2025 - Dec 2025\nHelped current students with proofs';
    const read = { ...structuredClone(pageRead), experience: [{ quote, bullets: ['Helped current students with proofs'], company: 'University of London', title: 'Teaching Assistant', location: '', start: '2025-09', end: '2025-12', current: true }] };
    const job = checkProfileText(`${PAGE}\n${quote}`, read).draft.experience[0];
    expect(job.current).toBe(false);
    expect(job.end).toBe('2025-12');
  });

  it('says where a dropped value was missing from', () => {
    const bad = structuredClone(pageRead);
    bad.personal.phone = '(415) 555-0100';
    expect(checkProfileText(PAGE, bad, 'paste').dropped).toEqual(['Phone: "(415) 555-0100" is not on the pasted text.']);
  });
});

describe('combining sources', () => {
  it('keeps the resume\'s values and fills its gaps from the page', () => {
    const resume = draft();
    const page = checkProfileText(PAGE, pageRead).draft as ProfileDraft;
    const merged = mergeDrafts([resume, page]);
    // The same school and job become one entry each.
    expect(merged.education.map((e) => e.school)).toEqual(['University of London']);
    expect(merged.experience.filter((e) => e.company === 'Analytical Engines Ltd')).toHaveLength(1);
    // The resume's wording wins where both have a value.
    expect(merged.education[0].degree).toBe('B.S.');
    expect(merged.experience[0].description).toBe(resume.experience[0].description);
    // Skills from both, once each.
    expect(merged.skills).toEqual(['Python', 'SQL', 'Mathematical Modeling']);
  });

  it('fills a value the resume left empty', () => {
    const resume = draft();
    resume.links.github = '';
    const page = checkProfileText(PAGE, pageRead).draft as ProfileDraft;
    expect(mergeDrafts([resume, page]).links.github).toBe('https://github.com/ada-example');
  });
});

describe('spoken languages', () => {
  it('maps a stated level onto the levels Options offers', () => {
    expect(languageLevel('Native or bilingual proficiency')).toEqual({ proficiency: 'Native or bilingual', fluent: true });
    expect(languageLevel('Professional working proficiency')).toEqual({ proficiency: 'Professional working', fluent: false });
    expect(languageLevel('fluent')).toEqual({ proficiency: 'Fluent', fluent: true });
    expect(languageLevel('Native')).toEqual({ proficiency: 'Native or bilingual', fluent: true });
    // Not one of the levels: left for you to pick.
    expect(languageLevel('Pretty good')).toEqual({ proficiency: '', fluent: false });
  });

  it('adds a language with its level', () => {
    const profile = emptyProfile();
    const d = draft();
    d.languages = [{ language: 'Italian', proficiency: 'Professional working proficiency' }];
    const items = planImport(profile, d);
    applyImport(profile, items, new Set(items.map((i) => i.id)));
    expect(profile.languages[0]).toMatchObject({ language: 'Italian', proficiency: 'Professional working', fluent: false });
  });
});

describe('phone numbers are digits only', () => {
  it('keeps only the digits, without the country code', () => {
    expect(phoneDigits('(415) 555-0100', '+1')).toBe('4155550100');
    expect(phoneDigits('+1 (415) 555-0100', '+1')).toBe('4155550100');
    expect(phoneDigits('1-415-555-0100', '+1')).toBe('4155550100');
    expect(phoneDigits('0044 20 7946 0958', '+44')).toBe('2079460958');
    expect(phoneDigits('+44 20 7946 0958', '+44')).toBe('2079460958');
    // A number that only starts with the same digits as the country code is left alone.
    expect(phoneDigits('4415550100', '+44')).toBe('4415550100');
    expect(phoneDigits('', '+1')).toBe('');
  });

  it('converts a number saved before this change when the profile loads', () => {
    const p = normalizeProfile({ personal: { phone: '+1 (415) 555-0100', phoneCountryCode: '+1' } });
    expect(p.personal.phone).toBe('4155550100');
  });
});
