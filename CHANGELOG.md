# Changelog

## 1.1.0 (2026-10-18)

### New
- **Resume tailoring (optional):** **Tailor resume** on the on-page panel rewrites the selected resume for the posting with your own Claude account, through Claude Code on your computer, and uses it for the upload. Off by default; set it up under Options → Resume tailoring.
  - Uses your resume plus your profile's experience, projects and skills, and can swap in a role or project from your profile that fits the job better.
  - Every bullet must trace back to your resume or profile. A rewrite that adds a number or tool that isn't there is replaced by the original.
  - Always one page, in the layout of Jake's resume template.
  - Shows what changed and a reminder to read the resume before submitting.
  - Tailored copies are kept under Resumes → Tailored resumes, and a job you already tailored for reuses its copy.
- **Skills for tailoring only:** a long list of every skill you have, under Skill sets. Only tailoring uses it, never form filling.
- **Move the on-page panel:** drag it by its bar. It stays where you put it on every site; double-click the grip to reset.
- **Credits:** a section at the bottom of the options page.
- **Light and dark mode:** a switch at the bottom of the options sidebar. Dark is the default.

### Fixes
- **Resume and skills always match:** the skill set now follows the picked resume. Link them with **Use with resume** under Skill sets, or let matching names pair them.
- **Options page layout:** even spacing between fields, inputs in a row line up when a label wraps, resume rules fit on one line, and Backup's buttons share a row. Descriptions use the full width, the sidebar highlights the section you click, and the empty space at the bottom is gone.
- **Resume rules for a deleted resume:** show "choose resume" instead of a blank box.
- **README:** shortened, with screenshots.

## 1.0.1 (2026-10-16)

### Fixes
- **Resume uploaded twice:** the resume is attached once per page, and an upload box that already lists a file is left alone. A resume you remove by hand stays removed.
- **Degree on Workday:** lists like "Bachelor Degree/Int'l Equiv" now match a specific degree such as "Bachelor of Arts", and a BA is never filed as a Bachelor of Science.
- **Closing the panel:** × keeps the panel closed for the rest of the page and stops filling fields that appear later.
- **Multi-campus school names:** "University of California, Berkeley", "UC Berkeley" and "University of California-Berkeley" are treated as the same school, and the same goes for other systems.
- **Summer availability:** "available for 10 to 12 weeks during the summer" questions answer from your availability setting instead of being flagged.
- **Work authorization:** "legal right and necessary documentation to work" questions answer from your work-authorization setting.
- **High school or GED:** answered Yes/No instead of with your highest degree.

### New
- **New standard answers:** employment and regulatory history (No), board or fiduciary roles (No), returning to school after the internship (Yes), current employer is a client (No), employed under another name (No), professional license (No), high school diploma or GED (Yes), international student (No), and enrollment status (Full-time). Each is editable in the options page.

## 1.0.0 (2026-10-16)

The first full release. It covers everything built since the project started.

### The extension
- **Autofill:** a Chrome extension (Manifest V3) that fills job applications. It never clicks Submit, and all data stays in the browser.
- **Fill page:** in the toolbar popup and a floating panel on application pages.
- **Resume upload first:** uploads the resume, waits for the site to read it, then fills the rest without overwriting what the site filled.
- **Resume and skill picking:** chosen from the job title and description, with a manual override.
- **Review highlights:** green for filled fields, orange for fields to check, with the reason in the popup.
- **Multi-page forms:** keeps filling new steps and follow-up questions as they appear.
- **Extension reloads:** handled cleanly mid-session; open application tabs still need a refresh.
- **New logo:** a resume that says "pls getme ajob".

### Filling fields
- **Every kind of field:** text boxes, dropdowns, searchable dropdowns, radios, checkboxes, yes/no buttons, rich-text editors, date pickers and shadow DOM. Hidden bot-trap fields are skipped.
- **Verified choices:** dropdown and radio selections are checked, and rejected ones are flagged for review.
- **Re-rendered fields:** retried on a second pass instead of being left blank.
- **Today's date:** uses Pacific time by default; change it under Settings → Time zone.

### Supported sites
- **Dedicated support:** Greenhouse, Lever, Ashby, SmartRecruiters, Workday, iCIMS and SAP SuccessFactors.
- **Shared support:** Workable, Rippling, Dover, Teamtailor, Recruitee, Jobvite, Breezy HR and about 20 more boards, plus a label-based fallback for any site.
- **Workday:** fills each step, adds a panel for each job, school, language, website and skill, and handles phone, language proficiency and previous-employment questions.
- **SmartRecruiters:** supports its web components, school cards, the confirm-email field and its common screening questions.
- **SAP SuccessFactors:** works for every company on it, opens collapsed sections, adds rows for jobs, schools and languages, and never submits the form while filling.
- **Ashby:** self-identification forms get your full name.

### Answers to common questions
- **Identity and contact:** names, university email, state residency, email consent and military spouse.
- **Work authorization and citizenship:** authorization, sponsorship, relocation, US citizenship, export control, security clearance and OPT.
- **Employment history and conflicts:** past employment at the company, relatives at the company or in government, government employment and other conflicts answer No, and "if yes" follow-ups stay empty.
- **Education:** class standing, highest completed level, GPA and graduation ranges, graduation date formats, majors with fallbacks, coursework, and high school and test scores.
- **Availability, start dates and pay:** availability questions, a start date per season, one hourly rate converted for annual and range questions, and ranked preferred locations.
- **EEO:** blank answers pick "decline to answer", veteran status is read by meaning in any wording, and race subgroups pick the subgroup when listed and the broad category otherwise.
- **Other questions:** referral source, how you heard about the job, acknowledgments, background checks, AI review consent and languages, each from its own setting. "Why are you interested?" questions are left for you.

### Matching accuracy ("green means certain")
- **Green only when certain:** an exact answer, a known synonym, a clear Yes/No or a deliberate fallback. Fuzzy matches are always orange.
- **No opposite or hedged answers:** options that mean the opposite of your answer, or hedge it, are never chosen as certain.
- **Whole-word matching:** "Female" no longer matches "Male".
- **Question parsing:** questions are matched on the sentence that asks something, so legal background and numbering can't decide the answer.
- **General rules:** majors, race subgroups and locations use the same rules for every profile, not special cases.

### Profile and settings
- **Complete profile:** personal info, links, education, experience, projects, languages, standard answers, EEO and skill sets. Personal fields start empty; standard answers start with common defaults.
- **Skill sets:** one per kind of role, picked by job-title keywords.
- **Options page:** every answer is editable, with a live annual-pay preview and seasonal start dates.
- **Removed:** the automatic "California" location, "Completed" from coursework, resume tags and the separate resume skills list.

### Privacy and Chrome Web Store
- **No network requests:** the AI answer step and the Claude Code helper were removed, along with the `nativeMessaging` permission.
- **Profile in the browser:** no longer built in from a local folder; move it with Backup → Export / Import.
- **Store materials:** privacy policy, listing text, permission justifications and `npm run store-assets` for screenshots.

### Development
- **Capture page:** a developer option that saves an HTML snapshot of a form for fixing a site, with `npm run pull-captures` to collect them.
- **Tests:** 649 tests, including about 140 question wordings in `tests/questionBank.test.ts`, plus TypeScript checks and builds. Test fixtures are anonymized.
- **Live tests:** `npm run live-test` takes the application URLs you want to test.
- **README:** rewritten to cover features, supported sites and install steps.
