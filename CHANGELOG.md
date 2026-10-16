# Changelog

## 1.0.0 (2026-10-16)

The first full release. It covers everything built since the project started.

### The extension
- Chrome extension (Manifest V3, WXT, TypeScript) that autofills job applications. It never clicks Submit, and all data stays in the browser.
- **Fill page** button in the toolbar popup and in a floating panel on application pages. The panel checks the page as soon as it loads and re-checks often, so it appears quickly.
- Uploads the resume first, waits for the site to read it, then fills the rest, keeping anything the site already filled.
- Picks the resume and skill set from the job title and description, with a manual override in the popup and the panel.
- Green outlines on filled fields, orange outlines on fields to check, and a review list in the popup that gives the reason for each.
- Keeps filling new steps and conditional questions as they appear (Workday-style multi-page forms).
- Recovers cleanly when the extension is reloaded mid-session: catches background failures and cleans up stale page scripts. Open application tabs still need a refresh after a reload.
- New logo: a resume that says "pls getme ajob".

### Filling fields
- Handles text boxes, dropdowns, searchable dropdowns, radios, checkboxes, yes/no buttons, rich-text editors, date pickers and shadow DOM, and skips hidden bot-trap fields.
- Checks that dropdown and radio choices actually registered, and reports rejected selections for review instead of counting them as filled.
- Fields a site re-renders mid-fill are retried on the second pass instead of being left blank.
- "Today's date" fields use Pacific time by default instead of UTC, which was a day ahead in the evening. Settings → Time zone changes it.

### Supported sites
- Dedicated adapters for Greenhouse, Lever, Ashby, SmartRecruiters, Workday, iCIMS and SAP SuccessFactors.
- Shared-engine support for Workable, Rippling, Dover, Teamtailor, Recruitee, Jobvite, Breezy HR and about 20 more boards, plus a generic label-based fallback for any site.
- **Workday**
  - Fills each step.
  - Adds and fills a panel for each job, school, language, website and skill.
  - "Meets minimum requirements" always answers Yes.
  - The phone number goes in the number box, not the extension box.
  - Language panels fill every proficiency field (comprehension, overall, reading, speaking and writing) and handle the separate "I am fluent in this language" checkbox.
  - When there's no LinkedIn field, the Websites section lists your portfolio, LinkedIn and GitHub.
  - The first-page question "Have you previously been employed by <employer>… or associated with the University as a student?" answers from Previously employed (No); the student part is Yes only for a school in your education.
- **SmartRecruiters**
  - Supports the `spl-*` web components (radios, selects, autocompletes and multi-select tags).
  - Finds dropdown labels across nested shadow roots and slotted option text, and clicks the inner option control.
  - Checks that a radio choice actually registered and tries the inner control if it didn't.
  - After a resume upload, each parsed school is a closed card; the fill opens the card for each school in your profile, fills Major and Degree, and saves it. Cards for other schools are left alone.
  - "Confirm your email" is re-checked after the fill and matched to what's actually in the email box, since resume parsing can rewrite the email.
  - Fixes for school, degree, GPA, government employment, work authorization, sponsorship, referral source, EEO, screening and foreign-residency questions. Leaves the "other university" field empty when your university is listed.
- **SAP SuccessFactors**
  - Works for every company on SuccessFactors.
  - Opens collapsed sections, but never the site's header menus.
  - Adds a row for each job, school and language and fills it.
  - Fills the UI5 date pickers.
  - Answers SuccessFactors-style radio groups.
  - Never presses Enter or submits the form while filling. This fixes a "Leave site?" prompt that appeared mid-fill.
- **Ashby:** self-identification forms get your full name.

### Answers to common questions

**Identity and contact**
- **Names:** certification/signature fields and plain "Name" fields get your full name. An optional full-name override is in Personal settings.
- **University email:** questions asking for a university or academic email get a dedicated profile field, falling back to your `.edu` address.
- **State residency:** answered from your saved address.
- New answers: email contact consent (Yes) and military spouse (No).

**Work authorization and citizenship**
- Work authorization, sponsorship and relocation questions.
- "Can you work … without sponsorship?" and "Authorized to work … without requiring sponsorship?" in any wording answer Yes when you're authorized and don't need sponsorship, instead of being read as the sponsorship question.
- **US citizen:** picks the US-citizen option on export-control, ITAR and citizenship-status questions, and on any question that offers a US-citizen choice. "This position requires U.S. citizenship; do you meet this qualification?" is answered Yes/No from your citizenship.
- Other / dual citizenship questions.
- **Security clearance:** able / eligible / willing to obtain one answers Yes for U.S. citizens; holding one still comes from your profile, and Yes/No clearance lists are handled.
- **OPT:** separate OPT-status and STEM OPT-extension answers, using N/A or falling back to No. Sponsorship questions that only mention OPT as an example are answered as sponsorship questions.

**Employment history and conflicts**
- **Always No, at any company and in any wording:**
  - Currently or formerly employed by or contracting for the company. Answers plain "No", not "None" or "N/A", unless the question is a "select none" list.
  - Any question about relatives, immediate family, in-laws, a spouse or partner: working at the company, holding a government post, or "such a position". This no longer depends on a setting.
  - Government entity employee.
  - Other work while employed there (conflict of interest).
  - Plans to start a postgraduate degree.
- Past government / DoD employment questions (post-government employment, NDAA Section 847) answer No, including options like "I have never been employed by the U.S. government…". State/local government employment is also covered.
- "Have you worked with us before?" answers from Previously employed.
- "Are you currently employed?" (your employment status) is separate from "Do you work here?".
- **"If yes" follow-ups:** follow-ups about past employment at the company stay empty when they don't apply. Referral follow-ups ("Were you referred…? If so, provide their name") get your referrer's name or N/A, and relatives' names get N/A.

**Education**
- **Class standing:** associate years, Freshman through Senior, and graduate levels. "Third year", "3rd year" and "Year 3" match Junior without being confused with degree type or graduation year.
- **Highest completed education:** answers your completed level (High School Diploma while still studying), even when the question mentions a graduation date.
- "Currently working towards a Bachelor's or Master's degree?" is answered from your education, not as an employment question.
- **GPA and graduation:** choices match the right numeric or date range, and long degree and GPA questions no longer receive a graduation date.
- **Graduation date:** free-text questions are formatted the way they ask. "(Month/Year)" gives "June 2028".
- **Majors:** tries variations of your major first, then your fallbacks in order. One rule covers every "<Field> Science", "<Field> Engineering" and "<Field> Studies" major: an option must name the whole field, so a bare "Science" or "Engineering" never answers it, and a different field that shares words ("Computer and Information Science" for "Computer Science") is never chosen. An exact option wins over a plural ("Sciences"). A bare head word already selected in Major, or a full degree description mistakenly placed there, is corrected even with overwriting off.
- **Coursework:** relevant coursework from your education, separating completed courses from those in progress.
- **High school and tests:** high-school graduation year, test type, SAT/ACT results, further-education plans, and current offers with details.

**Availability, start dates and pay**
- **Availability:** "Are you available for an internship starting …?", office-location/return-to-office, required work hours and program-duration questions answer Yes.
- **Start dates:** one start date per season (summer, fall, winter, spring), each set in the options page. Optional nearest-window matching picks the closest listed start date within six months and skips past semesters. When an internship title gives no season, summer is assumed.
- **Pay:** you set one hourly rate (blank by default).
  - Annual pay is calculated as hourly × 40 × 52.
  - Hourly and annual questions get the matching amount.
  - Salary-range dropdowns get the range that contains it.
- **Preferred work locations:** an ordered list with first/second/third-choice ranking, common city names, and mapping to U.S. regions when only regions are offered. A California city name followed by another country or region ("Los Angeles, Chile") doesn't count as California; notes like CA, the US, Bay Area, remote, hybrid or on-site may follow it.

**EEO**
- Blank answers pick the "decline to answer" option. A "Disabled" dropdown is recognized as the disability question.
- **Veteran status** is read by meaning in any wording ("I identify as a veteran, just not a protected veteran", "Non-Protected Veteran", "Veteran - Not Protected", "I have served… but am not protected"). "I am not a protected veteran" picks "I am not a veteran" and never an option saying you are a veteran.
- **Race:** profile options include South Asian, East Asian and Southeast Asian, defined in one table. Forms that list the subgroup (or another spelling such as "Asian Indian") get it; forms that don't get "Asian". A subgroup never matches a neighboring subgroup or American Indian, and East Asian never matches "South East Asian".

**Other questions**
- Referral source, agreements, internship terms, driver's license, travel percentage, phone/text consent, debarment, U.S. government consulting, hiring-event attendance and unlisted-reference consent, each answered from its own setting.
- **Application source:** "How did you hear about us?", "Where did you first learn about this job?", "Source", "What led you to apply?" and "source of your application" try your sources in order (LinkedIn, then the company careers website by default), choosing one even in checkbox lists. The careers-website fallback accepts "Career Site", "Corporate website", "<Company> Careers", "<Company>.com" and similar, and isn't confused with career fairs.
- **Acknowledgments:** statement questions pick the affirmative option (Understand, Understood, Acknowledged, Agree or Yes), even when it's the only one listed. Call/text consent is answered separately, and personal statements and self-assessment questions are never blanket-agreed.
- Background checks and drug screens, identity verification upon hire (Yes), and essential functions with or without accommodation.
- **AI review consent:** "We may use automated tools such as AI to review your application… you can opt out" questions answer from a new setting, Yes by default.
- **Languages:** tries only "Native" / "Native speaker", then "Fluent", and moves on if neither is offered. With no in-between levels, typeahead dropdowns are fast.
- **New rules:** referrer name, publications, and self-assessment statements.
- **Manual-review settings:** business-line preferences and experience/proficiency levels can be left for you to answer.
- **"Why are you interested?" questions** are left for you instead of getting a canned answer. There are no per-question saved answers; the standard-answer rules cover them.

### Matching accuracy ("green means certain")
- A field is marked green only for an exact answer, a known synonym, a clear Yes/No, or a deliberate fallback. Fuzzy word overlap is always orange.
- Options that mean the opposite of your answer are never chosen, however many words they share ("I am a protected veteran" vs "I am not…", "Not Hispanic" vs "Hispanic").
- Hedged options ("Yes, but I will need sponsorship later") and near-ties between two options are never green.
- Whole-word matching only: "Female" no longer matches "Male"; spelling-level similarity is used only for long names like schools.
- The location rule ("San Francisco, CA" in "San Francisco, California, United States") only applies to places. It was matching statements, which is how a veteran option was picked and marked green.
- Questions are matched on the sentence that asks something, then without parenthetical notes, then the full label, so legal background ("military departments", "(select No if…)") can't decide the answer.
- Numbered questions ("6. Do you hold…") are read the same as unnumbered ones.
- Majors, race subgroups and locations use general rules rather than special cases for particular values, so every profile gets the same behavior.

### Profile and settings
- Complete profile: personal info, links, education, experience, projects, languages, standard answers, EEO and skill sets. Personal fields start empty with example placeholders (Ada Lovelace). Standard answers come prefilled with common defaults, except pay, start dates, graduation details and publications.
- **Skills:** one skill set per kind of role (for example SWE or Data), each with its own skills, picked by job-title keywords.
- **Options page:**
  - Every answer listed above is editable, and edits are saved and used by autofill.
  - Clear dividers and header bars between sections.
  - Pay field with a live annual-pay preview.
  - Seasonal start-date overrides.
- **Removed:**
  - The automatic "California" preferred location.
  - "Completed" from coursework.
  - Resume tags.
  - The separate resume skills list, which is now merged into Skill sets.
- "Resume" is spelled without accents everywhere.

### Privacy and Chrome Web Store
- No network requests: the AI answer step and the Claude Code helper were removed, along with the `nativeMessaging` permission and the Anthropic SDK.
- The profile is no longer built into the extension from a local folder; move it between browsers with Backup → Export / Import.
- Privacy policy (`PRIVACY.md`), store listing text and permission justifications (`store/LISTING.md`), and `npm run store-assets` for screenshots and the promo tile, using a fictional profile and a neutral demo form.

### Development
- **Capture page** in the popup and the floating panel saves an HTML snapshot of a form, including shadow DOM and without typed values, so support for a site can be fixed. It's a developer tool, hidden unless you turn it on under Settings → Developer. `npm run pull-captures` moves snapshots from Downloads into the git-ignored `captures/` folder, once or continuously with `--watch`.
- Regression tests for matching rules, captured forms and settings persistence: 649 tests passing, plus TypeScript checks and production builds.
- `tests/questionBank.test.ts`: about 140 wordings across 18 question types, plus realistic option lists, each with the answer it must give and whether it may be green.
- Test fixtures are anonymized: employer names, domains, job-board slugs, job IDs and capture URLs are replaced with "Acme" / example.com, and fixtures are named by ATS (`greenhouse-a`, `workday-b-1`). The fictional test profile uses no real person's school, location, dates or job titles.
- `npm run live-test` needs the application URLs you want to test; it no longer ships a default list of real postings.
- README rewritten to cover features, settings, matching behavior, supported sites and install steps, with credits kept.
- Version set to 1.0.0.
