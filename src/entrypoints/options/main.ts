import './style.css';
import { browser } from 'wxt/browser';
import { TIME_ZONES } from '../../lib/clock';
import { ACADEMIC_YEARS } from '../../lib/engine/academicYear';
import { payExpectation } from '../../lib/engine/answers';
import { $, h } from '../../lib/dom';
import { emptyEducation, emptyExperience, emptyLanguage, emptyProject, emptySavedAnswer, emptySkillSet } from '../../lib/defaults';
import { listResumes } from '../../lib/resumeDb';
import { loadProfile, loadRules, loadSettings, saveProfile, saveSettings } from '../../lib/storage';
import type { Profile, ResumeMeta, Settings } from '../../lib/types';
import { backupSection } from './backup';
import { checkboxField, grid, listField, selectField, textArea, textField } from './fields';
import { resumeSection, rulesSection } from './resumes';
import { tailoringSection } from './tailoring';
import { debounce } from './toast';

// ---------------------------------------------------------------------------
// Choice lists. Empty value = leave unset ("decline to answer" for EEO).

const YES_NO: [string, string][] = [
  ['', '—'],
  ['Yes', 'Yes'],
  ['No', 'No'],
];
const YES_NO_NA: [string, string][] = [...YES_NO, ['N/A', 'Not applicable (use No if unavailable)']];
const TRAVEL_SUGGESTIONS = ['None', 'Less than 10%', '10-25%', '25-50%', '50-75%', '75-100%', '100%'];
const DECLINE = 'Decline to answer (default)';
const EEO = {
  gender: ['Male', 'Female', 'Non-binary'],
  raceEthnicity: [
    'Hispanic or Latino',
    'White',
    'Black or African American',
    'Asian',
    'South Asian',
    'East Asian',
    'Southeast Asian',
    'Native Hawaiian or Other Pacific Islander',
    'American Indian or Alaska Native',
    'Two or More Races',
  ],
  hispanicLatino: ['Yes', 'No'],
  veteranStatus: ['I am not a protected veteran', 'I am a veteran, but not a protected veteran', 'I identify as one or more of the classifications of protected veteran'],
  disability: ['No, I do not have a disability', 'Yes, I have a disability (or previously had one)'],
  sexualOrientation: ['Heterosexual', 'Gay', 'Lesbian', 'Bisexual', 'Queer', 'Asexual'],
  transgender: ['No', 'Yes'],
};
const eeoOptions = (values: string[]): [string, string][] => [['', DECLINE], ...values.map((v): [string, string] => [v, v])];
const REFERRAL_SUGGESTIONS = ['LinkedIn', 'Company careers website', 'Company website', 'Referral', 'Indeed', 'Glassdoor', 'Handshake', 'Job board'];
const PROFICIENCY: [string, string][] = [
  ['', '—'],
  ...['Native or bilingual', 'Fluent', 'Expert', 'Advanced', 'Professional working', 'Intermediate', 'Conversational', 'Limited working', 'Beginner', 'Elementary'].map((v): [string, string] => [v, v]),
];
const EXPERIENCE_TYPES: [string, string][] = [
  ['', '—'],
  ...(['Internship', 'Full-time', 'Part-time', 'Research', 'Contract', 'Volunteer'] as const).map((t): [string, string] => [t, t]),
];

// ---------------------------------------------------------------------------
// State (autosaved on every edit)

let profile: Profile;
let settings: Settings;
/** Your resumes (not tailored copies), for linking skill sets to them. */
let ownResumes: ResumeMeta[] = [];
const saveP = debounce(() => saveProfile(profile));
const saveS = debounce(() => saveSettings(settings));

// ---------------------------------------------------------------------------
// Sections

/** Hourly pay input with the annual figure (52 × 40 × hourly) shown live beneath it. */
function payField(p: Profile, onChange: () => void): HTMLElement {
  const annual = h('span', { class: 'hint' });
  const show = () => {
    const { hourly, annual: yearly } = payExpectation(p);
    annual.textContent = hourly ? `Annual questions get $${yearly.toLocaleString('en-US')} (52 × 40 × hourly).` : 'Annual pay is worked out as 52 × 40 × hourly.';
  };
  const field = textField('Expected hourly pay ($/hr)', p.answers, 'hourlyRate', () => { show(); onChange(); }, { placeholder: 'e.g. 40' });
  show();
  field.append(annual);
  return field;
}

function section(id: string, title: string, intro: string | null, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('section', { id }, h('h2', {}, title), intro ? h('p', { class: 'intro' }, intro) : null, ...body);
}

/** A repeatable list of cards (education, experience, projects, saved answers). */
function repeatable<T extends { id: string }>(
  items: T[],
  make: () => T,
  noun: string,
  renderItem: (item: T) => HTMLElement,
  titleOf: (item: T) => string = () => '',
): HTMLElement {
  const list = h('div', { class: 'cards' });
  const draw = () => {
    list.replaceChildren(
      ...items.map((item, i) => {
        const title = h('span', { class: 'card-title' });
        const setTitle = () => title.replaceChildren(titleOf(item) || h('span', { class: 'muted' }, `New ${noun.toLowerCase()}`));
        setTitle();
        const card = h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'card-tools' },
            title,
            h('button', { class: 'ghost', disabled: i === 0, title: 'Move up', onClick: () => move(i, -1) }, '↑'),
            h('button', { class: 'ghost', disabled: i === items.length - 1, title: 'Move down', onClick: () => move(i, 1) }, '↓'),
            h('button', { class: 'ghost danger', onClick: () => remove(i) }, 'Remove'),
          ),
          renderItem(item),
        );
        card.addEventListener('input', setTitle);
        card.addEventListener('change', setTitle);
        return card;
      }),
      h('button', { class: 'add', onClick: add }, `+ Add ${noun.toLowerCase()}`),
    );
  };
  const add = () => {
    items.push(make());
    saveP();
    draw();
  };
  const remove = (i: number) => {
    items.splice(i, 1);
    saveP();
    draw();
  };
  const move = (i: number, delta: number) => {
    const [item] = items.splice(i, 1);
    items.splice(i + delta, 0, item);
    saveP();
    draw();
  };
  draw();
  return list;
}

function profileSections(): HTMLElement[] {
  const p = profile;
  const s = saveP;
  return [
    section(
      'personal',
      'Personal',
      null,
      grid(
        textField('First name', p.personal, 'firstName', s, { placeholder: 'Ada' }),
        textField('Middle name', p.personal, 'middleName', s, { placeholder: 'Optional' }),
        textField('Last name', p.personal, 'lastName', s, { placeholder: 'Lovelace' }),
        textField('Full name / typed signature override', p.personal, 'fullName', s, { placeholder: 'Blank uses first and last name', wide: true }),
        textField('Preferred name', p.personal, 'preferredName', s, { placeholder: 'Optional, e.g. Ada' }),
        textField('Pronouns', p.personal, 'pronouns', s, { placeholder: 'e.g. she/her' }),
        textField('Email', p.personal, 'email', s, { type: 'email', placeholder: 'ada.lovelace@example.com' }),
        textField('University email', p.personal, 'universityEmail', s, { type: 'email', placeholder: 'Blank uses your main email only if it ends in .edu' }),
        textField('Phone', p.personal, 'phone', s, { type: 'tel', placeholder: '(415) 555-0100' }),
        textField('Phone country code', p.personal, 'phoneCountryCode', s, { placeholder: '+1' }),
      ),
      h('h3', {}, 'Address'),
      h('p', { class: 'intro' }, 'State residency questions use the state / province below. Use its full name or abbreviation.'),
      grid(
        textField('Street', p.personal, 'street', s, { wide: true, placeholder: '1 Analytical Way' }),
        textField('Address line 2', p.personal, 'addressLine2', s, { placeholder: 'Apt, suite…' }),
        textField('City', p.personal, 'city', s, { placeholder: 'San Francisco' }),
        textField('State / province', p.personal, 'state', s, { placeholder: 'CA' }),
        textField('ZIP / postal code', p.personal, 'zip', s, { placeholder: '94105' }),
        textField('Country', p.personal, 'country', s, { placeholder: 'United States' }),
      ),
    ),
    section(
      'links',
      'Links',
      null,
      grid(
        textField('LinkedIn', p.links, 'linkedin', s, { type: 'url', placeholder: 'https://linkedin.com/in/ada-lovelace' }),
        textField('GitHub', p.links, 'github', s, { type: 'url', placeholder: 'https://github.com/ada-lovelace' }),
        textField('Personal website', p.links, 'website', s, { type: 'url', placeholder: 'https://adalovelace.dev' }),
        textField('Portfolio', p.links, 'portfolio', s, { type: 'url', placeholder: 'https://adalovelace.dev/work' }),
        textField('Twitter / X', p.links, 'twitter', s, { type: 'url', placeholder: 'https://x.com/ada_lovelace' }),
        textField('Other link', p.links, 'other', s, { type: 'url', placeholder: 'Optional' }),
      ),
    ),
    section(
      'education',
      'Education',
      'Most recent first. The first entry answers "school", "degree", "GPA" questions; Workday adds one panel per entry. Major fallbacks are tried in order after your major and its variations when those are unavailable.',
      repeatable(p.education, emptyEducation, 'School', (e) =>
        grid(
          textField('School', e, 'school', s, { wide: true, placeholder: 'University of London' }),
          textField('Degree', e, 'degree', s, { placeholder: 'Bachelor of Arts' }),
          textField('Major', e, 'major', s, { placeholder: 'Mathematics' }),
          listField('Major fallbacks, in order (comma-separated)', e, 'majorFallbacks', s, { placeholder: 'Computer Science, Statistics' }),
          textField('Second major', e, 'secondMajor', s, { placeholder: 'Optional' }),
          textField('Minor', e, 'minor', s, { placeholder: 'Optional' }),
          textField('GPA', e, 'gpa', s, { placeholder: '3.8' }),
          textArea('Relevant coursework', e, 'coursework', s, { rows: 4, placeholder: 'Course names, separated by semicolons.' }),
          textField('Start', e, 'start', s, { type: 'month' }),
          textField('End (or expected)', e, 'end', s, { type: 'month' }),
        ),
        (e) => [e.school, e.major].filter(Boolean).join(' · '),
      ),
    ),
    section(
      'experience',
      'Work experience',
      'Most recent first. Volunteer entries are not added to Workday\'s work-history panels.',
      repeatable(p.experience, emptyExperience, 'Job', (x) =>
        h(
          'div',
          {},
          grid(
            textField('Company', x, 'company', s, { placeholder: 'Analytical Engines' }),
            textField('Title', x, 'title', s, { placeholder: 'Software Engineering Intern' }),
            selectField('Type', x, 'type', EXPERIENCE_TYPES, s),
            textField('Location', x, 'location', s, { placeholder: 'San Francisco, CA' }),
            textField('Start', x, 'start', s, { type: 'month' }),
            textField('End', x, 'end', s, { type: 'month' }),
            checkboxField('I currently work here', x, 'current', s),
          ),
          textArea('Description', x, 'description', s, { rows: 4, placeholder: 'What you built and its impact, one point per line.' }),
        ),
        (x) => [x.company, x.title].filter(Boolean).join(' · '),
      ),
    ),
    section(
      'projects',
      'Projects',
      'Pasted where a form asks for projects.',
      repeatable(p.projects, emptyProject, 'Project', (x) =>
        h(
          'div',
          {},
          grid(
            textField('Name', x, 'name', s, { placeholder: 'Bernoulli Number Program' }),
            textField('Role', x, 'role', s, { placeholder: 'Creator' }),
            textField('Link', x, 'url', s, { type: 'url', placeholder: 'https://github.com/ada-lovelace/bernoulli' }),
            textField('Start', x, 'start', s, { type: 'month' }),
            textField('End', x, 'end', s, { type: 'month' }),
          ),
          textArea('Description', x, 'description', s, { rows: 3, placeholder: 'What it does and how you built it.' }),
        ),
        (x) => x.name,
      ),
    ),
    section(
      'skills',
      'Skill sets',
      'The skills for each kind of role, used for skills fields and typeaheads. Each set goes with a resume: picking a resume picks its set, so the two always start out matching. Link them with "Use with resume", or leave it on "Match by name" to pair sets and resumes with matching names (e.g. "ML" and "AI/ML"). Keywords are only used for a resume with no set. You can still switch either one in the popup or the on-page panel.',
      repeatable(
        p.skillSets,
        emptySkillSet,
        'Skill set',
        (x) =>
          h(
            'div',
            {},
            grid(
              textField('Name', x, 'name', s, { placeholder: 'SWE' }),
              selectField('Use with resume', x, 'resumeId', [['', 'Match by name'], ...ownResumes.map((r): [string, string] => [r.id, r.name])], s),
              checkboxField('Use when nothing matches', x, 'isDefault', s),
              listField('Job-title keywords', x, 'keywords', s, { placeholder: 'software, backend, full stack' }),
            ),
            listField('Skills', x, 'skills', s, { placeholder: 'Python, Java, SQL' }),
          ),
        (x) => (x.name ? `${x.name}${x.isDefault ? ' (default)' : ''} · ${x.skills.slice(0, 5).join(', ')}` : ''),
      ),
      h('h3', {}, 'Fallback skills'),
      listField('Used only if you have no skill sets', p, 'skills', s, { placeholder: 'Python, SQL' }),
      h('h3', {}, 'Skills for tailoring only'),
      h(
        'p',
        { class: 'hint' },
        'Every skill you have, as long as you like, comma- or line-separated. Resume tailoring picks the few a posting asks for and adds them to the matching skill line; ' +
          'they are never filled into application forms, so a long list here doesn\'t turn into a skill dump.',
      ),
      listField('All skills', p, 'tailoringSkills', s, { placeholder: 'Python, SQL, Airflow, dbt, Spark, Tableau, Excel, A/B testing, …', multiline: true, rows: 6 }),
    ),
    section(
      'languages',
      'Languages',
      'Proficiency answers every language skill field, including reading, writing, speaking, comprehension and overall. The fluent checkbox is answered separately.',
      repeatable(p.languages, emptyLanguage, 'Language', (l) =>
        grid(
          textField('Language', l, 'language', s, { placeholder: 'English' }),
          selectField('Proficiency', l, 'proficiency', PROFICIENCY, s),
          checkboxField('I am fluent in this language', l, 'fluent', s),
        ),
        (l) => [l.language, l.proficiency].filter(Boolean).join(' · '),
      ),
    ),
    section(
      'answers',
      'Standard answers',
      'Set your defaults for eligibility, travel, consent, statements, location preferences and application status here. Blank answers are left for you to fill (they show up as "needs review" when required). Preferred work locations are comma-separated, highest priority first; clear the list to choose manually.',
      grid(
        selectField('Authorized to work in the US?', p.answers, 'workAuthorized', YES_NO, s),
        selectField('Will you need visa sponsorship?', p.answers, 'needsSponsorship', YES_NO, s),
        selectField('Willing to relocate?', p.answers, 'willingToRelocate', YES_NO, s),
        selectField('Office location / return-to-office requirements work for you?', p.answers, 'officeLocationWorks', YES_NO, s),
        selectField('Available for the required work hours and program duration?', p.answers, 'workScheduleAvailable', YES_NO, s),
        selectField('Available to attend hiring / recruiting events?', p.answers, 'eventAttendance', YES_NO, s),
        listField('Preferred work locations, in priority order', p.answers, 'locationPreferences', s, { placeholder: 'California, New York' }),
        textField('Travel willingness / percentage', p.answers, 'travelPercentage', s, { list: 'travel-list', placeholder: 'e.g. 25-50%' }),
        selectField('Consent to telephone calls / text messages?', p.answers, 'phoneTextConsent', YES_NO, s),
        selectField('Allow AI / automated tools to review your application?', p.answers, 'aiReviewConsent', YES_NO, s),
        selectField('Allow employers to contact unlisted references?', p.answers, 'unlistedReferencesConsent', YES_NO, s),
        selectField('Debarred or suspended from government contracting?', p.answers, 'governmentDebarment', YES_NO, s),
        selectField('Ever fired, asked to resign, or disciplined by a regulator / licensing board?', p.answers, 'disciplinaryHistory', YES_NO, s),
        selectField('Serve as a board member, trustee, executor or other fiduciary?', p.answers, 'fiduciaryRoles', YES_NO, s),
        selectField('Current employer is a client of the company you are applying to?', p.answers, 'currentEmployerClient', YES_NO, s),
        selectField('Retained as a consultant / contractor by the U.S. government?', p.answers, 'governmentConsulting', YES_NO, s),
        selectField('Enrollment status while in school', p.answers, 'enrollmentStatus', [['', '—'], ['Full-time', 'Full-time'], ['Part-time', 'Part-time']], s),
        selectField('International student?', p.answers, 'internationalStudent', YES_NO, s),
        selectField('Currently on Optional Practical Training (OPT)?', p.answers, 'optStatus', YES_NO_NA, s),
        selectField('Eligible for a STEM OPT extension?', p.answers, 'stemOptEligible', YES_NO_NA, s),
        selectField('At least 18 years old?', p.answers, 'over18', YES_NO, s),
        selectField("Hold a valid driver's license?", p.answers, 'driversLicense', YES_NO, s),
        selectField('Hold a professional license (insurance, real estate, CPA…)?', p.answers, 'professionalLicense', YES_NO, s),
        selectField('High school diploma or GED?', p.answers, 'highSchoolDiploma', YES_NO, s),
        selectField('Ever employed under any other name?', p.answers, 'otherNames', YES_NO, s),
        selectField('Default for "worked here before?"', p.answers, 'previouslyEmployed', YES_NO, s),
        selectField('Bound by a non-compete?', p.answers, 'nonCompete', YES_NO, s),
        selectField('You or family a public official?', p.answers, 'governmentOfficial', YES_NO, s),
        selectField('Any conflict of interest?', p.answers, 'conflictOfInterest', YES_NO, s),
        selectField('Meet the minimum qualifications?', p.answers, 'meetsRequirements', YES_NO, s),
        selectField('Applied there in the last 6–12 months?', p.answers, 'appliedBefore', YES_NO, s),
        selectField('Agree to terms, statements and acknowledgments?', p.answers, 'agreeToTerms', YES_NO, s),
        textField('Citizenship', p.answers, 'citizenship', s, { placeholder: 'United States' }),
        textField('Security clearance', p.answers, 'securityClearance', s, { placeholder: 'None' }),
        textField('Earliest start date', p.answers, 'earliestStartDate', s, { type: 'date' }),
        textField('Winter internship start date', p.answers, 'winterStartDate', s, { type: 'date' }),
        textField('Spring internship start date', p.answers, 'springStartDate', s, { type: 'date' }),
        textField('Fall internship start date', p.answers, 'fallStartDate', s, { type: 'date' }),
        checkboxField('Choose the closest offered start-date window', p.answers, 'closestStartDateChoice', s, 'Titles without a season use the main date. Other seasons use your date override, an advertised start date, or January 1 (winter), March 1 (spring), September 1 (fall).'),
        textField('Exact graduation date', p.answers, 'graduationDate', s, { type: 'date' }),
        payField(p, s),
        textField('Notice period', p.answers, 'noticePeriod', s, { placeholder: 'e.g. 2 weeks' }),
        textField('Who referred you?', p.answers, 'referrerName', s, { placeholder: 'Blank = N/A' }),
        textArea('Publications', p.answers, 'publications', s, { rows: 3, placeholder: 'Title, venue, link — one per line' }),
        textField('"How did you hear about us?" default', p.answers, 'referralSource', s, { list: 'referral-list' }),
        listField('Application source fallbacks, in priority order', p.answers, 'referralSourceFallbacks', s, { placeholder: 'Company careers website, LinkedIn' }),
      ),
      h('datalist', { id: 'referral-list' }, ...REFERRAL_SUGGESTIONS.map((v) => h('option', { value: v }))),
      h('datalist', { id: 'travel-list' }, ...TRAVEL_SUGGESTIONS.map((v) => h('option', { value: v }))),
      h('h3', {}, 'Academic tests and application status'),
      grid(
        textField('High-school graduation year', p.answers, 'highSchoolGraduationYear', s, { placeholder: 'e.g. 2024' }),
        selectField('Academic year / class standing', p.answers, 'academicYear', [['', '—'], ...ACADEMIC_YEARS.map((year): [string, string] => [year, year])], s),
        textField('Standardized test type', p.answers, 'standardizedTestType', s, { list: 'test-type-list', placeholder: 'SAT, ACT, or Not taken' }),
        textField('Best SAT result', p.answers, 'satScore', s, { placeholder: 'Score or Not taken' }),
        textField('Best ACT result', p.answers, 'actScore', s, { placeholder: 'Score or Not taken' }),
        selectField('Returning to school after the internship?', p.answers, 'returningToSchool', YES_NO, s),
        selectField('Further education immediately after your current degree?', p.answers, 'furtherEducation', [
          ['', '—'], ['No', 'No'],
          ['I am considering further education after my current program', 'Considering further education'],
          ['I have committed to another degree after my current program', 'Committed to another degree'],
        ], s),
        selectField('Do you currently have any offers?', p.answers, 'currentOffers', YES_NO, s),
      ),
      h('datalist', { id: 'test-type-list' }, ...['SAT', 'ACT', 'SAT and ACT', 'Not taken'].map((value) => h('option', { value }))),
      textArea('Offer details (company, role, deadline)', p.answers, 'offerDetails', s, { rows: 2, placeholder: 'Used when current offers is Yes; No answers use N/A.' }),
      textArea('Additional sponsorship context', p.answers, 'sponsorshipDetails', s, { rows: 2, placeholder: 'Blank uses N/A when you do not need sponsorship.' }),
      textArea('Default cover letter (for cover-letter text boxes)', p.answers, 'coverLetter', s, { rows: 4, placeholder: 'Dear Hiring Manager, …' }),
    ),
    section(
      'eeo',
      'EEO / demographics',
      'Anything left blank is answered "decline to answer" (or the closest option the form offers).',
      grid(
        selectField('Gender', p.eeo, 'gender', eeoOptions(EEO.gender), s),
        selectField('Race / ethnicity', p.eeo, 'raceEthnicity', eeoOptions(EEO.raceEthnicity), s),
        selectField('Hispanic or Latino?', p.eeo, 'hispanicLatino', eeoOptions(EEO.hispanicLatino), s),
        selectField('Veteran status', p.eeo, 'veteranStatus', eeoOptions(EEO.veteranStatus), s),
        selectField('Disability', p.eeo, 'disability', eeoOptions(EEO.disability), s),
        selectField('Sexual orientation', p.eeo, 'sexualOrientation', eeoOptions(EEO.sexualOrientation), s),
        selectField('Transgender?', p.eeo, 'transgender', eeoOptions(EEO.transgender), s),
      ),
    ),
    section(
      'saved-answers',
      'Saved answers',
      'Answers to recurring custom questions. On a form, the closest-worded question gets your answer; weaker matches are marked for review. The popup\'s "Save my answers from this page" adds to this list.',
      repeatable(p.savedAnswers, emptySavedAnswer, 'Answer', (a) =>
        h(
          'div',
          {},
          textArea('Question', a, 'question', s, { rows: 2, placeholder: 'Why do you want to work here?' }),
          textArea('Answer', a, 'answer', s, { rows: 4, placeholder: 'Your answer, filled whenever a similar question appears.' }),
        ),
        (a) => a.question,
      ),
    ),
  ];
}

function settingsSection(): HTMLElement {
  const s = saveS;
  return section(
    'settings',
    'Settings',
    'Personal autofill defaults are under Personal, Education, Languages and Standard answers in the sidebar. Use Saved answers for other recurring questions. Changes save automatically.',
    checkboxField('Let me choose business lines / divisions myself', settings, 'reviewBusinessLines', s, 'Leaves these questions for your review.'),
    checkboxField('Let me assess experience / proficiency levels myself', settings, 'reviewExperienceLevels', s, 'Leaves skill-level questions for your review. Language proficiency still uses your Languages settings.'),
    checkboxField('Overwrite fields that already have a value', settings, 'overwriteExisting', s, 'Off: fields you or the site already filled are left alone.'),
    checkboxField('Highlight filled fields and fields that need review', settings, 'highlightFields', s, 'Green = filled, orange = check this one.'),
    checkboxField(
      'Show the fill panel on application pages',
      settings,
      'showOnPage',
      s,
      'A small panel on the right of application forms, so you don\'t need to open the toolbar popup.',
    ),
    checkboxField(
      'Keep filling as new fields appear',
      settings,
      'watchForNewFields',
      s,
      'For 20 minutes after a fill: next steps of multi-page forms and follow-up questions are filled too. Never overwrites.',
    ),
    checkboxField(
      'Workday: click "Next" between steps for me',
      settings,
      'workdayAutoAdvance',
      s,
      'Only after you start a fill on Workday, and only when nothing on the step needs review. Submit is never clicked.',
    ),
    selectField('Time zone for today\'s date', settings, 'timeZone', TIME_ZONES, s),
    h('h3', {}, 'Developer'),
    checkboxField(
      'Show "Capture page" button',
      settings,
      'showCaptureButton',
      s,
      'Adds a button to the popup and the on-page panel that downloads an HTML snapshot of the form, for fixing support for a site.',
    ),
  );
}

const REPO = 'https://github.com/arnavpodichetty/getmeajobpls';

function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener' }, text);
}

/** Version, links, and every credit, at the bottom of the page. */
function creditsSection(): HTMLElement {
  return section(
    'credits',
    'Credits',
    null,
    h(
      'p',
      {},
      h('strong', {}, `getmeajobpls ${browser.runtime.getManifest().version}`),
      ' — designed and built by ',
      link('https://github.com/arnavpodichetty', 'Arnav Podichetty'),
      '.',
    ),
    h('p', { class: 'about-links' }, link(REPO, 'Source code'), link(`${REPO}/blob/main/CHANGELOG.md`, 'Changelog'), link(`${REPO}/blob/main/PRIVACY.md`, 'Privacy policy')),
    h(
      'ul',
      { class: 'credits' },
      h(
        'li',
        {},
        'Workday step names and data-automation-id conventions were cross-checked against ',
        link('https://github.com/andrewmillercode/Autofill-Jobs', 'Autofill-Jobs'),
        ' (MIT). No code was copied.',
      ),
      h(
        'li',
        {},
        'Resume tailoring runs ',
        link('https://claude.com/claude-code', 'Claude Code'),
        ' by Anthropic on your computer, under your own Claude account. getmeajobpls is not affiliated with or endorsed by Anthropic.',
      ),
      h(
        'li',
        {},
        'Tailored resumes follow the layout of ',
        link('https://github.com/jakegut/resume', "Jake's resume template"),
        ' (MIT), rebuilt in HTML and CSS; no code was copied.',
      ),
      h(
        'li',
        {},
        'Tailored resumes are set in Computer Modern by Donald Knuth, using the ',
        link('https://github.com/stevenpetryk/computer-modern', 'CMU fonts'),
        ' (SIL Open Font License).',
      ),
    ),
  );
}

/** Light / dark switch at the bottom of the sidebar. Dark is the default; the choice is kept in this browser. */
function themeToggle(): HTMLElement {
  const root = document.documentElement;
  const buttons = (['dark', 'light'] as const).map((theme) =>
    h('button', { type: 'button', 'data-theme-choice': theme, onClick: () => set(theme) }, theme === 'dark' ? '☾ Dark' : '☀ Light'),
  );
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (root.dataset.theme ?? 'dark'))));
  function set(theme: 'dark' | 'light') {
    root.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {}
    sync();
  }
  sync();
  return h('div', { class: 'theme-toggle', role: 'group', 'aria-label': 'Theme' }, ...buttons);
}

const NAV: [string, string][] = [
  ['#Profile', ''],
  ['personal', 'Personal'],
  ['links', 'Links'],
  ['education', 'Education'],
  ['experience', 'Experience'],
  ['projects', 'Projects'],
  ['skills', 'Skills'],
  ['languages', 'Languages'],
  ['#Answers', ''],
  ['answers', 'Standard answers'],
  ['eeo', 'EEO'],
  ['saved-answers', 'Saved answers'],
  ['#Files', ''],
  ['resumes', 'Resumes'],
  ['rules', 'Resume rules'],
  ['tailoring', 'Resume tailoring'],
  ['#App', ''],
  ['settings', 'Settings'],
  ['backup', 'Backup'],
  ['credits', 'Credits'],
];

export async function renderAll(): Promise<void> {
  [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  ownResumes = (await listResumes()).filter((r) => !r.tailoredFrom);
  const rules = await loadRules();
  $('#nav').replaceChildren(
    h('div', { class: 'brand' }, h('img', { class: 'logo', src: '/icon/48.png', alt: '' }), 'getmeajobpls'),
    ...NAV.map(([id, label]) =>
      id.startsWith('#') ? h('div', { class: 'nav-group' }, id.slice(1)) : h('a', { href: `#${id}`, 'data-section': id }, label),
    ),
    themeToggle(),
  );
  $('#main').replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Your profile'), h('p', {}, 'Everything here stays in this browser.')),
      h('div', { class: 'save-state' }, 'Changes save automatically'),
    ),
    ...profileSections(),
    await resumeSection(),
    await rulesSection(rules),
    tailoringSection(settings, saveS),
    settingsSection(),
    backupSection(renderAll),
    creditsSection(),
  );
}

/** Highlight the sidebar link for the section at the top of the screen. */
function trackActiveSection(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('nav a[data-section]')];
  let frame = 0;
  // A section you click stays highlighted until you scroll yourself. Sections near
  // the end can't scroll to the top, so position alone would highlight the last one.
  let clicked: string | null = null;
  for (const a of links) a.addEventListener('click', () => { clicked = a.dataset.section ?? null; update(); });
  for (const type of ['wheel', 'touchmove', 'keydown'] as const) window.addEventListener(type, () => (clicked = null), { passive: true });
  const update = () => {
    frame = 0;
    if (clicked) {
      for (const a of links) a.classList.toggle('active', a.dataset.section === clicked);
      return;
    }
    const sections = [...document.querySelectorAll<HTMLElement>('main section[id]')];
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = sections[0]?.id;
    for (const sec of sections) if (sec.getBoundingClientRect().top <= 140) current = sec.id;
    if (atBottom) current = sections[sections.length - 1]?.id;
    for (const a of links) a.classList.toggle('active', a.dataset.section === current);
  };
  window.addEventListener('scroll', () => (frame ||= requestAnimationFrame(update)), { passive: true });
  update();
}

renderAll().then(trackActiveSection);
