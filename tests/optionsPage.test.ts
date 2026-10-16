// Smoke test: the options page renders against a fake browser + in-memory
// IndexedDB, and edits autosave to storage.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { putResume } from '../src/lib/resumeDb';
import { loadProfile, loadSettings, saveRules } from '../src/lib/storage';
import { resolveAnswer } from '../src/lib/engine/answers';


beforeAll(async () => {
  fakeBrowser.reset();
  await putResume({
    id: 'r1', name: 'SWE resume', tags: ['SWE'], skills: ['SQL'], fileName: 'swe.pdf',
    mimeType: 'application/pdf', size: 1000, uploadedAt: 1, isDefault: true, blob: new Blob(['%PDF']),
  });
  await saveRules([{ id: 'rule1', keywords: ['software'], resumeId: 'r1' }]);
  document.body.innerHTML = '<nav id="nav"></nav><main id="main"></main><div id="toast"></div>';
  await import('../src/entrypoints/options/main');
  await vi.waitFor(() => expect(document.querySelector('#backup')).not.toBeNull());
});

describe('options page', () => {
  it('renders every section', () => {
    const ids = [...document.querySelectorAll('section')].map((s) => s.id);
    expect(ids).toEqual([
      'personal', 'links', 'education', 'experience', 'projects', 'skills', 'languages', 'answers', 'eeo',
      'saved-answers', 'resumes', 'rules', 'settings', 'backup',
    ]);
  });

  it('lists stored resumes and rules', () => {
    expect(document.querySelectorAll('#resumes .card')).toHaveLength(1);
    expect(document.querySelectorAll('#rules .rule')).toHaveLength(1);
    expect((document.querySelector('#rules .rule select') as HTMLSelectElement).value).toBe('r1');
  });

  it('autosaves profile edits', async () => {
    const first = document.querySelector('#personal input') as HTMLInputElement;
    first.value = 'Ada';
    first.dispatchEvent(new Event('input'));
    await vi.waitFor(async () => expect((await loadProfile()).personal.firstName).toBe('Ada'), { timeout: 2000 });
  });

  it('adds an education entry', async () => {
    (document.querySelector('#education button.add') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#education .card')).toHaveLength(1);
    await vi.waitFor(async () => expect((await loadProfile()).education).toHaveLength(1), { timeout: 2000 });
  });

  it('defaults EEO to decline', () => {
    const sel = document.querySelector('#eeo select') as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect(sel.selectedOptions[0].textContent).toMatch(/decline/i);
  });

  it('autosaves the new standard answers and uses them when filling', async () => {
    const changes = [
      ['Office location / return-to-office requirements work for you?', 'No', 'officeLocationWorks', 'Do the office location and RTO requirements work for you?'],
      ['Available for the required work hours and program duration?', 'No', 'workScheduleAvailable', 'Can you work 40 hours per week for 12 weeks in San Francisco?'],
      ['Available to attend hiring / recruiting events?', 'No', 'eventAttendance', 'Would you be able to attend both days of the hiring event?'],
      ['Allow employers to contact unlisted references?', 'Yes', 'unlistedReferencesConsent', 'Consent to Contact Unlisted References'],
      ['Travel willingness / percentage', '50-75%', 'travelPercentage', 'Are you willing to travel?'],
      ['Consent to telephone calls / text messages?', 'Yes', 'phoneTextConsent', 'I consent to receive text messages'],
      ['Debarred or suspended from government contracting?', 'Yes', 'governmentDebarment', 'Have you been debarred from government contracting?'],
      ['Retained as a consultant / contractor by the U.S. government?', 'Yes', 'governmentConsulting', 'Have you been retained by the U.S. Government as a consultant?'],
      ['Currently on Optional Practical Training (OPT)?', 'Yes', 'optStatus', 'Are you currently on OPT?'],
      ['Eligible for a STEM OPT extension?', 'No', 'stemOptEligible', 'Are you eligible for a STEM OPT extension?'],
      ['Agree to terms, statements and acknowledgments?', 'No', 'agreeToTerms', 'Applicant statement'],
    ];
    for (const [label, value] of changes) {
      const field = [...document.querySelectorAll('#answers label.field')].find((field) => field.querySelector('span')?.textContent === label);
      const control = field?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      expect(control, label).toBeTruthy();
      control!.value = value;
      control!.dispatchEvent(new Event(control!.tagName === 'SELECT' ? 'change' : 'input'));
    }
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      for (const [_label, value, key, question] of changes) {
        expect(profile.answers[key as keyof typeof profile.answers]).toBe(value);
        expect(resolveAnswer(question, '', null, { profile, skills: [] }, true).answer?.value).toBe(value);
      }
    });
  });

  it('saves editable language proficiency, major fallbacks and full name', async () => {
    (document.querySelector('#languages button.add') as HTMLButtonElement).click();
    const proficiency = document.querySelector<HTMLSelectElement>('#languages select')!;
    expect([...proficiency.options].map((option) => option.value)).toContain('Advanced');
    proficiency.value = 'Advanced';
    proficiency.dispatchEvent(new Event('change'));
    const fields = [
      ['#personal', 'Full name / typed signature override', 'Ada Katherine Lovelace'],
      ['#education', 'Major fallbacks, in order (comma-separated)', 'Statistics, Computer Science'],
    ];
    for (const [section, label, value] of fields) {
      const field = [...document.querySelectorAll(`${section} label.field`)].find((field) => field.querySelector('span')?.textContent === label);
      const input = field!.querySelector('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      expect(profile.personal.fullName).toBe('Ada Katherine Lovelace');
      expect(profile.education[0].majorFallbacks).toEqual(['Statistics', 'Computer Science']);
      expect(profile.languages[0].proficiency).toBe('Advanced');
    });
  });

  it('saves the academic and application preferences', async () => {
    const changes = [
      ['High-school graduation year', '2024', 'highSchoolGraduationYear'],
      ['Standardized test type', 'Not taken', 'standardizedTestType'],
      ['Best SAT result', 'Not taken', 'satScore'], ['Best ACT result', 'Not taken', 'actScore'],
      ['Further education immediately after your current degree?', 'No', 'furtherEducation'],
      ['Do you currently have any offers?', 'No', 'currentOffers'],
    ];
    for (const [label, value] of changes) {
      const field = [...document.querySelectorAll('#answers label.field')].find((field) => field.querySelector('span')?.textContent === label);
      const control = field?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      expect(control, label).toBeTruthy();
      control!.value = value;
      control!.dispatchEvent(new Event(control!.tagName === 'SELECT' ? 'change' : 'input'));
    }
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      for (const [_label, value, key] of changes) expect(profile.answers[key as keyof typeof profile.answers]).toBe(value);
    });
  });

  it('autosaves the location preference order', async () => {
    const field = [...document.querySelectorAll('#answers label.field')].find((field) => field.querySelector('span')?.textContent === 'Preferred work locations, in priority order');
    const input = field!.querySelector('input')!;
    expect(input.value).toBe('');
    input.value = 'New York, California';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      expect(profile.answers.locationPreferences).toEqual(['New York', 'California']);
      expect(resolveAnswer('Preferred office location', '', null, { profile, skills: [] }, true).answer?.locationPreference?.places).toEqual(['New York', 'California']);
    });
  });

  it('allows other users to replace academic, offers, email and residency defaults', async () => {
    const changes = [
      ['#answers', 'High-school graduation year', '2025', 'High school graduation year'],
      ['#answers', 'Academic year / class standing', 'Senior', 'Current year of study'],
      ['#answers', 'Best SAT result', '1540', 'SAT score'],
      ['#answers', 'Best ACT result', '34', 'ACT score'],
      ['#answers', 'Further education immediately after your current degree?', 'I have committed to another degree after my current program', 'Further education plans'],
      ['#answers', 'Do you currently have any offers?', 'Yes', 'Do you currently have any offers?'],
      ['#answers', 'Offer details (company, role, deadline)', 'Example Co, Analyst, December 1', 'Offer details and company deadline'],
      ['#answers', '"How did you hear about us?" default', 'Indeed', 'What led you to apply for this opportunity?'],
      ['#personal', 'University email', 'ada@example.edu', 'Please provide your university email address'],
      ['#personal', 'State / province', 'Maryland', 'Are you a resident of the state of Maryland?'],
    ];
    for (const [section, label, value] of changes) {
      const field = [...document.querySelectorAll(`${section} label.field`)].find((field) => field.querySelector('span')?.textContent === label);
      const control = field?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
      expect(control, label).toBeTruthy();
      control!.value = value;
      control!.dispatchEvent(new Event(control!.tagName === 'SELECT' ? 'change' : 'input'));
    }
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      for (const [_section, label, value, question] of changes) {
        expect(resolveAnswer(question, '', null, { profile, skills: [] }, true).answer?.value, label)
          .toBe(label === 'State / province' ? 'Yes' : value);
      }
      expect(resolveAnswer('Are you a resident of California?', '', null, { profile, skills: [] }, true).answer?.value).toBe('No');
    });
  });

  it('autosaves application source fallbacks and uses their order', async () => {
    const field = [...document.querySelectorAll('#answers label.field')].find((field) => field.querySelector('span')?.textContent === 'Application source fallbacks, in priority order');
    const input = field!.querySelector('input')!;
    input.value = 'Company careers website, LinkedIn';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      expect(profile.answers.referralSourceFallbacks).toEqual(['Company careers website', 'LinkedIn']);
      expect(resolveAnswer('What led you to apply?', '', null, { profile, skills: [] }, true).answer?.tiers)
        .toEqual([['Indeed'], ['Company careers website'], ['LinkedIn']]);
    });
  });

  it('saves coursework, seasonal dates and nearest-window matching', async () => {
    for (const [label, value] of [
      ['Relevant coursework', 'Operating Systems; Compilers'],
      ['Earliest start date', '2027-06-07'],
      ['Winter internship start date', '2027-01-10'],
    ]) {
      const field = [...document.querySelectorAll('label.field')].find((field) => field.querySelector('span')?.textContent === label)!;
      const input = field.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    const field = [...document.querySelectorAll('#answers label.check')].find((field) => field.textContent?.includes('Choose the closest offered start-date window'))!;
    const check = field.querySelector('input')!;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => {
      const profile = await loadProfile();
      expect(profile.education[0].coursework).toBe('Operating Systems; Compilers');
      expect(profile.answers.closestStartDateChoice).toBe(true);
      const ctx = { profile, skills: [], jobTitle: 'Winter 2027 Internship' };
      expect(resolveAnswer('Relevant coursework', '', null, ctx, false).answer?.value).toBe('Operating Systems; Compilers');
      expect(resolveAnswer('When are you available to begin?', '', null, ctx, true).answer?.availabilityDate).toBe('2027-01-10');
    });
  });

  it('autosaves manual-review preferences for business lines and experience', async () => {
    for (const label of ['Let me choose business lines / divisions myself', 'Let me assess experience / proficiency levels myself']) {
      const field = [...document.querySelectorAll('#settings label.check')].find((field) => field.textContent?.includes(label))!;
      const checkbox = field.querySelector('input')!;
      expect(checkbox.checked).toBe(true);
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
    }
    await vi.waitFor(async () => {
      expect((await loadSettings()).reviewBusinessLines).toBe(false);
      expect((await loadSettings()).reviewExperienceLevels).toBe(false);
    });
  });
});
