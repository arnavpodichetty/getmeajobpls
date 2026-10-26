// Shared data model. Everything here is persisted locally (chrome.storage.local
// for JSON, IndexedDB for resume files); only the optional Claude features send any of it out, when you click.

export type YesNo = '' | 'Yes' | 'No';
export type YesNoNA = YesNo | 'N/A';

export interface Education {
  id: string;
  school: string;
  degree: string; // e.g. "Bachelor of Arts"
  major: string;
  /** Tried in order when a form has no option for `major` (e.g. Computer Science). */
  majorFallbacks: string[];
  secondMajor: string;
  minor: string;
  gpa: string;
  coursework: string;
  start: string; // "YYYY-MM"
  end: string; // "YYYY-MM" (expected date if still enrolled)
}

export type ExperienceType = '' | 'Full-time' | 'Part-time' | 'Internship' | 'Research' | 'Volunteer' | 'Contract';

export interface Experience {
  id: string;
  company: string;
  title: string;
  type: ExperienceType;
  location: string;
  start: string; // "YYYY-MM", or "YYYY-MM-DD" when you entered the day
  end: string; // same; empty when current
  current: boolean;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  role: string;
  url: string;
  start: string;
  end: string;
  description: string;
}

/** "Native or bilingual", "Fluent", "Professional working", "Limited working", "Elementary". */
export interface Language {
  id: string;
  language: string;
  proficiency: string;
  /** Ticks "I am fluent in this language" (Workday and others). */
  fluent: boolean;
}

/** Skills for one kind of role; picked by job-title keywords like resume rules. */
export interface SkillSet {
  id: string;
  name: string;
  keywords: string[];
  skills: string[];
  /** Used when no set's keywords match the job. */
  isDefault: boolean;
  /** The resume this set goes with; picking that resume picks this set. '' = match by name. */
  resumeId?: string;
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface Profile {
  personal: {
    firstName: string;
    middleName: string;
    lastName: string;
    /** Optional full-name / typed-signature override; otherwise first + last. */
    fullName: string;
    preferredName: string;
    pronouns: string;
    email: string;
    universityEmail: string;
    phone: string; // digits only, without the country code, e.g. "4155550100"
    phoneCountryCode: string; // e.g. "+1"
    street: string;
    addressLine2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  links: {
    linkedin: string;
    github: string;
    website: string;
    portfolio: string;
    twitter: string;
    other: string;
  };
  education: Education[];
  experience: Experience[];
  projects: Project[];
  skills: string[];
  skillSets: SkillSet[];
  /** Every skill you have, only for resume tailoring to pick from; never filled into forms. */
  tailoringSkills: string[];
  languages: Language[];
  answers: {
    workAuthorized: YesNo;
    needsSponsorship: YesNo;
    willingToRelocate: YesNo;
    officeLocationWorks: YesNo;
    workScheduleAvailable: YesNo;
    eventAttendance: YesNo;
    locationPreferences: string[];
    travelPercentage: string;
    phoneTextConsent: YesNo;
    aiReviewConsent: YesNo;
    unlistedReferencesConsent: YesNo;
    governmentDebarment: YesNo;
    /** Ever fired / asked to resign, or disciplined by a regulator or licensing board. */
    disciplinaryHistory: YesNo;
    /** Board member, trustee, executor or other fiduciary role. */
    fiduciaryRoles: YesNo;
    /** "Is your current employer a <company> client?" */
    currentEmployerClient: YesNo;
    governmentConsulting: YesNo;
    /** "Are you an international student?" (on a student visa such as F-1 or J-1). */
    internationalStudent: YesNo;
    /** "Full-time" or "Part-time" while enrolled; blank leaves full/part-time questions for you. */
    enrollmentStatus: string;
    /** Degree you're working towards ("Bachelor's"), for "must be pursuing a degree" questions that list degree levels. */
    pursuingDegree: string;
    optStatus: YesNoNA;
    stemOptEligible: YesNoNA;
    highSchoolGraduationYear: string;
    academicYear: string;
    standardizedTestType: string;
    satScore: string;
    actScore: string;
    furtherEducation: string;
    /** "Will you return to school after the internship?" */
    returningToSchool: YesNo;
    currentOffers: YesNo;
    offerDetails: string;
    sponsorshipDetails: string;
    over18: YesNo;
    /** Hold a full, valid driving license. */
    driversLicense: YesNo;
    /** Hold any professional license (insurance, real estate, CPA, securities…). */
    professionalLicense: YesNo;
    /** High school diploma or GED. */
    highSchoolDiploma: YesNo;
    /** "Have you ever been employed under any other name?" */
    otherNames: YesNo;
    previouslyEmployed: YesNo; // "Have you worked for <company> before?"
    nonCompete: YesNo; // "Are you bound by a non-compete?"
    relatedToEmployee: YesNo; // unused: relative/family questions are always answered No
    governmentOfficial: YesNo; // "Are you (or family) a public official / government employee?"
    conflictOfInterest: YesNo; // "Do you have any conflict of interest?"
    meetsRequirements: YesNo; // "Do you meet the minimum qualifications for this role?"
    appliedBefore: YesNo; // "Have you applied to <company> in the past N months?"
    agreeToTerms: YesNo; // tick "I have read and agree to the terms / privacy policy" boxes
    citizenship: string;
    securityClearance: string;
    earliestStartDate: string; // "YYYY-MM-DD"
    winterStartDate: string;
    springStartDate: string;
    fallStartDate: string;
    closestStartDateChoice: boolean;
    graduationDate: string; // exact "YYYY-MM-DD", for forms that ask for the day
    /** Publications list, used for "Publications" questions. */
    publications: string;
    /** Who referred you; blank answers "N/A". */
    referrerName: string;
    /** Expected hourly pay in dollars, e.g. "40". Annual pay is 52 × 40 × this. */
    hourlyRate: string;
    noticePeriod: string;
    referralSource: string; // default "How did you hear about us?"
    referralSourceFallbacks: string[];
    coverLetter: string; // default cover-letter text for text boxes
  };
  // Empty string means "decline to answer" when filling.
  eeo: {
    gender: string;
    raceEthnicity: string;
    hispanicLatino: string;
    veteranStatus: string;
    disability: string;
    sexualOrientation: string;
    transgender: string;
  };
  savedAnswers: SavedAnswer[];
}

/** Resume metadata (the PDF blob lives alongside it in IndexedDB). */
export interface ResumeMeta {
  id: string;
  name: string;
  tags: string[];
  skills: string[];
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
  isDefault: boolean;
  /** Set on your transcript, which is stored next to the resumes but never picked as one. */
  kind?: 'transcript';
  /** Set on resumes made by "Tailor resume": the resume it was tailored from. */
  tailoredFrom?: string;
  /** The job it was tailored for, e.g. "Data Engineering Intern · Hooli". */
  tailoredFor?: string;
  /** The page it was tailored on; the same job reuses this copy (see tailorMatch.ts). */
  tailoredUrl?: string;
  /** Claude's change notes and the bullets that were put back, shown again when the copy is reused. */
  tailorNotes?: { changes: string[]; warnings: string[] };
}

export interface ResumeRecord extends ResumeMeta {
  blob: Blob;
}

/** keyword rule → resume. Keywords match whole words, case-insensitive. */
export interface ResumeRule {
  id: string;
  keywords: string[];
  resumeId: string;
}

export interface Settings {
  reviewBusinessLines: boolean;
  reviewExperienceLevels: boolean;
  overwriteExisting: boolean;
  highlightFields: boolean;
  /** Allow clicking "Next" between Workday steps once you have started a fill there. */
  workdayAutoAdvance: boolean;
  /** Keep filling new fields that appear (next step, conditional questions) for a while after a fill. */
  watchForNewFields: boolean;
  /** Show the floating fill panel on application pages. */
  showOnPage: boolean;
  /** Developer: show "Capture page" in the popup and panel. */
  showCaptureButton: boolean;
  /** IANA time zone for "today" on date fields; '' uses the computer's. */
  timeZone: string;
  /** Show "Tailor resume" (needs the local Claude Code helper). */
  tailorEnabled: boolean;
}

export type FieldStatus = 'filled' | 'review' | 'skipped';

export interface FieldResult {
  label: string;
  status: FieldStatus;
  reason?: string;
}

export interface FillReport {
  ats: string;
  filled: number;
  needsReview: number;
  fields: FieldResult[];
  notes: string[];
}
