import type { Education, Experience, Language, Profile, Project, SavedAnswer, Settings, SkillSet } from './types';
import { DEFAULT_TIME_ZONE } from './clock';

export const uid = (): string => crypto.randomUUID();

/**
 * A phone number as digits only, without the country code (it has its own field):
 * "+1 (415) 555-0100" → "4155550100". Sites format the number themselves as it's typed.
 */
export function phoneDigits(value: string, countryCode = ''): string {
  const v = value.trim();
  let d = v.replace(/\D/g, '');
  // "00" is the international prefix, like "+".
  const international = v.startsWith('+') || v.startsWith('00');
  if (v.startsWith('00')) d = d.slice(2);
  const cc = countryCode.replace(/\D/g, '');
  if (cc && d.length > cc.length && d.startsWith(cc) && (international || (cc === '1' && d.length === 11))) d = d.slice(cc.length);
  return d;
}

export function emptyProfile(): Profile {
  return {
    personal: {
      firstName: '',
      middleName: '',
      lastName: '',
      fullName: '',
      preferredName: '',
      pronouns: '',
      email: '',
      universityEmail: '',
      phone: '',
      phoneCountryCode: '+1',
      street: '',
      addressLine2: '',
      city: '',
      state: '',
      zip: '',
      country: 'United States',
    },
    links: { linkedin: '', github: '', website: '', portfolio: '', twitter: '', other: '' },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    skillSets: [],
    tailoringSkills: [],
    languages: [],
    answers: {
      workAuthorized: 'Yes',
      needsSponsorship: 'No',
      willingToRelocate: 'Yes',
      officeLocationWorks: 'Yes',
      workScheduleAvailable: 'Yes',
      eventAttendance: 'No',
      locationPreferences: [],
      travelPercentage: '25-50%',
      phoneTextConsent: 'No',
      aiReviewConsent: 'Yes',
      unlistedReferencesConsent: 'Yes',
      governmentDebarment: 'No',
      disciplinaryHistory: 'No',
      fiduciaryRoles: 'No',
      currentEmployerClient: 'No',
      governmentConsulting: 'No',
      internationalStudent: 'No',
      enrollmentStatus: 'Full-time',
      optStatus: 'N/A',
      stemOptEligible: 'N/A',
      highSchoolGraduationYear: '',
      academicYear: '',
      standardizedTestType: 'Not taken',
      satScore: 'Not taken',
      actScore: 'Not taken',
      furtherEducation: 'No',
      returningToSchool: 'Yes',
      currentOffers: 'No',
      offerDetails: '',
      sponsorshipDetails: '',
      over18: 'Yes',
      driversLicense: 'Yes',
      professionalLicense: 'No',
      highSchoolDiploma: 'Yes',
      otherNames: 'No',
      previouslyEmployed: 'No',
      nonCompete: 'No',
      relatedToEmployee: 'No',
      governmentOfficial: 'No',
      conflictOfInterest: 'No',
      meetsRequirements: 'Yes',
      appliedBefore: 'No',
      agreeToTerms: 'Yes',
      citizenship: 'United States',
      securityClearance: 'None',
      earliestStartDate: '',
      winterStartDate: '',
      springStartDate: '',
      fallStartDate: '',
      closestStartDateChoice: true,
      graduationDate: '',
      publications: '',
      referrerName: '',
      hourlyRate: '',
      noticePeriod: 'Immediately',
      referralSource: 'LinkedIn',
      referralSourceFallbacks: ['Company careers website'],
      coverLetter: '',
    },
    eeo: {
      gender: '',
      raceEthnicity: '',
      hispanicLatino: '',
      veteranStatus: '',
      disability: '',
      sexualOrientation: '',
      transgender: '',
    },
    savedAnswers: [],
  };
}

export const emptyEducation = (): Education => ({
  id: uid(),
  school: '',
  degree: '',
  major: '',
  majorFallbacks: [],
  secondMajor: '',
  minor: '',
  gpa: '',
  coursework: '',
  start: '',
  end: '',
});

export const emptyExperience = (): Experience => ({
  id: uid(),
  company: '',
  title: '',
  type: '',
  location: '',
  start: '',
  end: '',
  current: false,
  description: '',
});

export const emptyProject = (): Project => ({
  id: uid(),
  name: '',
  role: '',
  url: '',
  start: '',
  end: '',
  description: '',
});

export const emptySkillSet = (): SkillSet => ({ id: uid(), name: '', keywords: [], skills: [], isDefault: false, resumeId: '' });

/** The proficiency levels offered under Languages, highest first. */
export const LANGUAGE_LEVELS = ['Native or bilingual', 'Fluent', 'Expert', 'Advanced', 'Professional working', 'Intermediate', 'Conversational', 'Limited working', 'Beginner', 'Elementary'];

export const emptyLanguage = (): Language => ({ id: uid(), language: '', proficiency: '', fluent: false });

export const emptySavedAnswer = (): SavedAnswer => ({ id: uid(), question: '', answer: '' });

export const defaultSettings = (): Settings => ({
  reviewBusinessLines: true,
  reviewExperienceLevels: true,
  overwriteExisting: false,
  highlightFields: true,
  workdayAutoAdvance: false,
  watchForNewFields: true,
  showOnPage: true,
  showCaptureButton: false,
  timeZone: DEFAULT_TIME_ZONE,
  tailorEnabled: false,
});

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  // Older settings carried an "ai" block (AI answers were removed); drop it.
  const { ai: _removed, ...rest } = s as Partial<Settings> & { ai?: unknown };
  return { ...base, ...rest };
}


const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Deep-merge stored data onto defaults so older backups / partial imports
 * never leave a field undefined.
 */
export function normalizeProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Profile>;
  return {
    personal: (() => {
      const personal = { ...base.personal, ...p.personal };
      // Older profiles could hold a formatted number; phone numbers are digits only now.
      return { ...personal, phone: phoneDigits(String(personal.phone ?? ''), String(personal.phoneCountryCode ?? '')) };
    })(),
    links: { ...base.links, ...p.links },
    education: (p.education ?? []).map((e) => ({ ...emptyEducation(), ...e, majorFallbacks: list(e.majorFallbacks) })),
    experience: (p.experience ?? []).map((e) => ({ ...emptyExperience(), ...e })),
    projects: (p.projects ?? []).map((e) => ({ ...emptyProject(), ...e })),
    skills: list(p.skills),
    tailoringSkills: list(p.tailoringSkills),
    skillSets: (p.skillSets ?? []).map((x) => ({ ...emptySkillSet(), ...x, keywords: list(x.keywords), skills: list(x.skills) })),
    // Older profiles stored languages as plain strings.
    languages: (Array.isArray(p.languages) ? p.languages : []).map((l: unknown) =>
      typeof l === 'string' ? { ...emptyLanguage(), language: l } : { ...emptyLanguage(), ...(l as Partial<Language>) },
    ),
    answers: { ...base.answers, ...p.answers, locationPreferences: list(p.answers?.locationPreferences ?? base.answers.locationPreferences), referralSourceFallbacks: list(p.answers?.referralSourceFallbacks) },
    eeo: { ...base.eeo, ...p.eeo },
    savedAnswers: (p.savedAnswers ?? []).map((a) => ({ ...emptySavedAnswer(), ...a })),
  };
}
