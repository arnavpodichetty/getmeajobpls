import { describe, expect, it } from 'vitest';
import { countMatches, pickResume, pickSkillSetFor, skillSetForResume } from '../src/lib/resumeRules';
import type { ResumeMeta, ResumeRule, SkillSet } from '../src/lib/types';

const resume = (id: string, isDefault = false): ResumeMeta => ({
  id,
  name: id,
  tags: [],
  skills: [],
  fileName: `${id}.pdf`,
  mimeType: 'application/pdf',
  size: 1,
  uploadedAt: 0,
  isDefault,
});

const resumes = [resume('general', true), resume('swe'), resume('data')];
const rules: ResumeRule[] = [
  { id: 'r-swe', keywords: ['software', 'backend'], resumeId: 'swe' },
  { id: 'r-data', keywords: ['data', 'analyst'], resumeId: 'data' },
];

describe('countMatches', () => {
  it('matches whole words case-insensitively', () => {
    expect(countMatches('ML', 'Senior ML Engineer')).toBe(1);
    expect(countMatches('ml', 'ML engineer')).toBe(1);
  });

  it('does not match inside other words', () => {
    expect(countMatches('ML', 'HTML and XML experience')).toBe(0);
    expect(countMatches('data', 'metadata')).toBe(0);
  });

  it('allows a trailing plural s', () => {
    expect(countMatches('analyst', 'We are hiring analysts')).toBe(1);
    expect(countMatches('engineer', 'We are hiring engineers')).toBe(1);
  });

  it('treats spaces in a keyword as space-or-hyphen', () => {
    expect(countMatches('machine learning', 'machine-learning platform')).toBe(1);
    expect(countMatches('machine learning', 'Machine  Learning')).toBe(1);
  });

  it('handles regex characters in keywords', () => {
    expect(countMatches('C++', 'Strong C++ skills')).toBe(1);
    expect(countMatches('C++', 'C skills')).toBe(0);
  });
});

describe('pickResume', () => {
  it('returns null with no resumes', () => {
    expect(pickResume([], rules, { title: 'Software Engineer', text: '' })).toBeNull();
  });

  it('picks by job title', () => {
    expect(pickResume(resumes, rules, { title: 'Software Engineer, Payments', text: '' })?.resumeId).toBe('swe');
    expect(pickResume(resumes, rules, { title: 'Data Analyst', text: '' })?.resumeId).toBe('data');
  });

  it('prefers the rule matching more distinct title keywords', () => {
    const pick = pickResume(resumes, rules, { title: 'Data Analyst, Software', text: '' });
    expect(pick?.resumeId).toBe('data');
  });

  it('breaks title ties by rule order', () => {
    const pick = pickResume(resumes, rules, { title: 'Software Data Lead', text: '' });
    expect(pick?.resumeId).toBe('swe');
  });

  it('title beats page text', () => {
    const text = 'data data data data data analyst analyst';
    expect(pickResume(resumes, rules, { title: 'Backend Software Engineer', text })?.resumeId).toBe('swe');
  });

  it('falls back to page text when the title has no match', () => {
    const text = 'You will build data pipelines and partner with each analyst on the team.';
    expect(pickResume(resumes, rules, { title: 'Engineering Intern', text })?.resumeId).toBe('data');
  });

  it('ignores a single incidental mention in page text', () => {
    const pick = pickResume(resumes, rules, { title: 'Engineering Intern', text: 'We are data-driven.' });
    expect(pick?.resumeId).toBe('general');
    expect(pick?.ruleId).toBeUndefined();
  });

  it('falls back to the default resume, then the first one', () => {
    expect(pickResume(resumes, rules, { title: 'Chef', text: '' })?.resumeId).toBe('general');
    const noDefault = [resume('a'), resume('b')];
    expect(pickResume(noDefault, [], { title: 'Chef', text: '' })?.resumeId).toBe('a');
  });

  it('skips rules pointing at deleted resumes', () => {
    const stale: ResumeRule[] = [{ id: 'x', keywords: ['software'], resumeId: 'gone' }, ...rules];
    expect(pickResume(resumes, stale, { title: 'Software Engineer', text: '' })?.resumeId).toBe('swe');
  });
});

describe('skill set follows the resume', () => {
  const set = (id: string, name: string, extra: Partial<SkillSet> = {}): SkillSet => ({ id, name, keywords: [], skills: [], isDefault: false, ...extra });
  const named = (id: string, name: string, extra: Partial<ResumeMeta> = {}): ResumeMeta => ({ ...resume(id), name, ...extra });
  const lib = [named('r-ml', 'AI/ML'), named('r-data', 'Data'), named('r-pm', 'PM'), named('r-tail', 'Data · tailored', { tailoredFrom: 'r-data' })];

  it('uses the set linked to the resume, even when names differ', () => {
    const sets = [set('s-a', 'Analytics', { resumeId: 'r-data' }), set('s-data', 'Data')];
    expect(skillSetForResume(sets, lib, 'r-data')).toBe('s-a');
  });

  it('pairs unlinked sets by name, including partial names like ML and AI/ML', () => {
    const sets = [set('s-data', 'Data'), set('s-ml', 'ML'), set('s-pm', 'pm')];
    expect(skillSetForResume(sets, lib, 'r-ml')).toBe('s-ml');
    expect(skillSetForResume(sets, lib, 'r-data')).toBe('s-data');
    expect(skillSetForResume(sets, lib, 'r-pm')).toBe('s-pm');
  });

  it('a tailored copy goes with the set of the resume it came from', () => {
    expect(skillSetForResume([set('s-data', 'Data'), set('s-ml', 'ML')], lib, 'r-tail')).toBe('s-data');
  });

  it('does not guess when several sets could match', () => {
    expect(skillSetForResume([set('a', 'ML Research'), set('b', 'Applied ML')], lib, 'r-ml')).toBeNull();
  });

  it('the resume decides, not the skill set keywords', () => {
    // "data" in the title would pick the Data set by keywords, but the picked resume is AI/ML.
    const sets = [set('s-data', 'Data', { keywords: ['data'] }), set('s-ml', 'ML', { keywords: ['machine learning'] })];
    expect(pickSkillSetFor(sets, lib, 'r-ml', { title: 'Data Scientist', text: '' })).toBe('s-ml');
  });

  it('falls back to keywords only for a resume with no matching set', () => {
    const sets = [set('s-swe', 'SWE', { keywords: ['software'] })];
    expect(pickSkillSetFor(sets, lib, 'r-pm', { title: 'Software Engineer', text: '' })).toBe('s-swe');
  });
});
