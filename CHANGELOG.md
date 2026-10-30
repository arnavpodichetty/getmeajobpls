# Changelog

## 1.3.2 (2026-10-23)

### New
- **Transcript upload:** save your unofficial transcript under Options → Transcript, and it's attached to uploads that ask for one (Greenhouse, Workday and others). A required one with no transcript saved is flagged for you.
- **Exact job dates:** work experience Start and End take an optional day. Forms that ask for the full date (Workday, SuccessFactors date pickers) get it; most forms still get the month and year. When a form asks for the day and you haven't added one, the 1st is used and flagged for you.

### Fixes
- **Export-control country lists:** "Have you held citizenship in any of the countries listed above?" was answered Yes (as if it asked about U.S. citizenship). It answers No when your citizenship isn't on the list, and the "If yes, please specify which country" box gets N/A.
- **Clearance agency follow-up:** "Which agency sponsored the clearance?" was read as a visa-sponsorship question. It has its own rule now and picks "I do not possess an active security clearance" (or N/A) when your profile has no clearance.
- **"Will you require employer support to obtain or maintain authorization to work?":** it was read as "are you authorized to work?" and answered Yes. It's a sponsorship question now and uses your sponsorship answer (No by default).
- **Links without "https://":** Oracle pre-fills Link 1 / Link 2 from your resume text (e.g. "example.com"), then rejects them. A box holding one of your profile links without "https://" gets the full link from your profile. Any other bare web address in a link box (type="url", or labeled Link / Website / Portfolio) gets "https://" in front, a profile link saved without it is filled with it, and links the site fills in after the first pass are fixed at the end of the fill.
- **Errors after an extension reload:** old content scripts now stop safely when Chrome removes the runtime API, including during message-listener cleanup, instead of throwing "Cannot read properties of undefined (reading 'onMessage')".
- **Fill startup:** load profile, settings and document files in parallel; skip the resume label scan on pages without an upload. Deep lookups stop at their first match.
- **Separate radio questions:** radios with the same name in different forms or shadow roots are no longer combined.
- **Saved radio answers:** save the visible answer instead of the site's internal option ID, so it can be reused on another form.
- **Upload selection:** a lone portfolio, writing sample or other document upload is no longer used as a fallback resume field.
- **Skills dropdowns:** ignored selections are reported as skipped after the retry instead of counted as added.
- **Panel and highlights:** closing the panel during a fill no longer loses its report or restarts watching; a fresh fill also clears old highlights inside shadow roots.
- **Faster Workday My Experience:** jobs, schools and websites fill about 2–3x faster. Dates move on as soon as Workday shows the value, instead of always waiting, and every value is still checked.
- **"You must be currently pursuing a degree…":** Workday lists Bachelors / Masters / Doctorate as the choices, and it was flagged for review. It picks your "Degree you are pursuing" now (Standard answers, Bachelor's by default).
- **Resume in a transcript box:** on Workday, the resume could go into an "upload your transcript" question. It never does now.
- **Race / ethnicity choices:** the South Asian, East Asian and Southeast Asian options are gone from Options → EEO. A saved subgroup becomes Asian.
- **Language levels with no Fluent option:** Workday's "1 - Beginner / 2 - Intermediate / 3 - Advanced" scales were left for review. A fluent speaker now gets the top of the scale (Expert, then Advanced) in every level box: Comprehension, Overall, Reading, Speaking, Writing and the rest.
- **Fill on pages with an embedded form:** if one frame reloaded during a fill, the whole fill showed an error. The other frames' results show now.
- **Popup "Save my answers":** errors weren't shown, and a double click could save twice.
- **Fill my profile:** clicking Apply twice added new entries twice.
- **Options sidebar:** stopped highlighting the current section after Fill my profile or a backup import.
- **Resumes:** "Uploaded" no longer covers the "not a PDF" message when nothing was uploaded, and Replace file works when you pick the same file again.
- **Tailoring on some job URLs:** a stray "%" in the link made tailoring fail.
- **Capture page:** text typed into some rich-text boxes could end up in the snapshot. It's left out now.

## 1.3.1 (2026-10-22)

### New
- **Greenhouse phone format:** a Greenhouse Phone box on its own gets your number as country code, then the number in groups: "1-415-555-0100". A Phone box next to its own country-code picker still gets just the number (the site adds the +1 and formats it). Other sites are unchanged.

### Fixes
- **Greenhouse phone country flagged for review:** after picking "United States +1", Greenhouse shows only "+1", which looked like the pick hadn't stuck. It counts as picked now.
- **Oracle required Yes/No questions:** required pill questions the filler couldn't answer were skipped silently, because Oracle marks them required with a class, not a "*". They're flagged for you now.
- **"Have you or do you currently work for a public agency or institution?":** was answered as "worked for this company before". It's a government question now. If one of your jobs is at a university, school or public body, it's left for you.
- **"Will you also be involved in any other jobs, business investments, board memberships…?":** is left for you when you have a current job, since keeping it counts.
- **More conflict questions answered:** "restrictions from a former employer" (non-compete), "supervised, approved, evaluated or awarded <company> work", "selection committee … awarding work to <company>", "Did a <company> employee refer you?" and "Do you meet the minimum years of experience…?" use your standard answers.
- **Veteran discharge date:** a non-veteran's "Newly Separated Veteran Discharge Date" was flagged for review. It's left empty now.
- **"What month and year did you begin your undergraduate studies?":** got your graduation date, because "undergraduate" contains "graduate". It gets when your school started now. The same mix-up could leave "Which undergraduate university…?" empty; fixed too.
- **Format and N/A from the help text under a question:** Greenhouse puts "MM/YYYY" or 'Enter "N/A" if not' under the box, and it was ignored ("May 2028", "No"). Both are followed now ("08/2024", "N/A").
- **"What other country are you a citizen of?":** got "No". It's "N/A" now when you have one citizenship.
- **Oracle extras left alone:** the data retention "I Agree" box (keep your data for future job alerts) is no longer ticked, and the hidden AI "Work Summary" popup is ignored.

## 1.3.0 (2026-10-21)

### New
- **Fill my profile:** set up your profile from your resume, a profile page or pasted text instead of typing it in. Your own Claude account reads them through the resume tailoring helper (Options → Fill my profile). For a page such as your Simplify, LinkedIn or Handshake profile, open it and click **Use this page for my profile** in the toolbar popup.
  - Only what the source says is used: every value must appear in its text, in the entry it belongs to; dates must match that entry's dates; a role is current only if it says Present; a GPA is never taken from its scale ("3.9/4.0" gives 3.9). Descriptions and skills are copied word for word. Anything that fails a check is listed under "Left out".
  - You review each change first. Empty fields and new entries start ticked; anything that would replace what you wrote starts unticked. Schools, jobs and projects you already have are matched, not added again.
  - Standard answers and EEO are never changed.
- **New logo:** a resume with a check mark and a cursor, on a mint square, in the toolbar, the extensions page and the store.
- **Phone numbers are digits only:** the Phone box takes only digits, and a pasted "+1 (415) 555-0100" becomes 4155550100 (the country code has its own box). Sites format the number themselves as it's filled. Numbers you saved before are converted the same way.

### Fixes
- **Company on the panel:** Lever postings showed "Acme logo" instead of "Acme". The word "logo" from the site's logo is dropped now.

## 1.2.0 (2026-10-20)

### New
- **Job details on the panel:** the role, company, location, pay and posting date, read from the posting and kept on its application pages. Locations show as city and state; hover over "+ 2 more" for the rest.
- **Panel on job postings:** shows on the posting page before you apply, so you can see the details and tailor your resume first.
- **Oracle Recruiting Education and Experience:** adds one entry per job and one for your latest school, fills each from that entry and saves it. Entries already listed are skipped.

### Fixes
- **Oracle entry forms you open yourself:** were filled with your latest job every time. They now get the next job that isn't listed yet.
- **Dates with a format in the question:** "month and year … as MM/YYYY" got "May 2028". A format the question spells out is used now: "05/2028".
- **SuccessFactors "From Date" / "To Date":** job and school dates labeled this way were left empty. They fill now.
- **"Are you capable of performing the essential functions of the job…?":** was left for you because "performing" wasn't recognized. It's answered "Yes" now.
- **Tailored resume skills:** skills the posting names, like Jira or Codex, were often left out even when they were in your profile. They're listed now, first in their line, and the least relevant items make room so lines don't get longer.
- **Workday schools on some sites:** where the field is called "School or University" (not "School Name"), schools were never filled and extra empty Education entries kept getting added. Schools fill now, and an Add click that doesn't produce an entry is never repeated.
- **Workday dropdowns that reset themselves:** Workday can put an earlier answer back to "Select One" while you fill the rest, and it stayed green. It's flagged for you now.
- **More application questions answered:** "Minimum Pay Desired", "Are you willing to travel?" as Yes/No, agreements not to compete or solicit, "under investigation by your current employer", "Are you a California resident?" (from your state) and "consider your application for other roles… Opt In".
- **Acknowledgements that quote legal text:** an "I acknowledge" dropdown was answered as an "essential functions" question because of a state notice inside it. It's answered as an acknowledgement now.
- **Options edits lost on close:** an edit made less than half a second before closing the Options tab wasn't saved. Pending edits are saved as soon as the tab is hidden or closed.
- **Hidden fields on pages that drew late:** if a page (or an embedded form's frame) was still empty when first checked, fields inside hidden sections could count as visible for the rest of that page. Visibility is checked properly once the page has drawn.
- **Faster:** each form scan reads the page once instead of three times; watching a multi-step form for new steps no longer rescans for the resume upload after it's attached; dropdown option matching does less repeated work; the panel and popup load their data in parallel; and on sites that aren't recognized, busy pages (mail, chat, docs) are checked for an application form at most once a second instead of after every change.
- **Tailoring helper:** a malformed request from Chrome now gets an error reply instead of the helper exiting without an answer.

## 1.1.1 (2026-10-19)

### Fixes
- **Ashby "Missing entry for required field" on submit:** Ashby saves each answer to its server as it's picked, and answers saved at the same moment overwrote each other there, so questions that looked answered came back as missing. The filler now waits for each save to finish before answering the next question.
- **Questions with help text under them:** a question like Ashby's "Are you legally authorized to work in the United States?" with "(If hired, verification will be required…)" below it was read as the help text, so it was skipped without being flagged. The question is read from its title now, and required questions marked only by a style (no "*") are recognized, so unanswered ones are flagged for review.
- **Workday jobs and links under other section names:** work experience under "Professional Experience" and links under "Portfolio" (instead of "Work Experience" and "Websites") were left empty. Panels are now recognized by their fields, whatever the section is called.
- **Tailored resumes no longer look squished:** spacing now matches Jake's LaTeX template: 12pt line spacing in bullets, more room around section headings and under the header, a small gap between bullets, the template's bullet indent, and dates and locations aligned to its right edge.
- **Tailored resume details:** the name prints in plain bold as pdflatex does, `--` in dates becomes an en dash, the `|` and tech stack after a project name are no longer italic, and a web address in a project line is linked.
- **Tailoring on application pages without the job description:** Workday's steps, Lever's /apply and Ashby's Application tab now get the description from the ATS's public job listing, or from the posting page you opened earlier in the same tab.
- **Oracle Recruiting dropdowns:** Country, City, State, Postal Code, phone country code, graduation month and year, and the EEO dropdowns were all flagged "the dropdown showed no options". Oracle lists its choices as grid cells, which are now read, and a pick only counts once Oracle shows it in the box. Values already in these dropdowns are no longer overwritten.
- **"Title" with Mr. / Ms. / Dr. options:** was answered with your job title and flagged. A Title choice is left for you; a Title text box still gets your job title.
- **"What type of degree program are you currently enrolled in?":** was answered "Yes" (as if asking whether you're enrolled). It now picks your degree.
- **Graduation month and year asked separately:** a dropdown asking only for the month now gets the month name ("June"), and one asking only for the year gets the year.
- **On-page panel position:** starts in the top-right corner instead of the middle of the right edge. A spot you dragged it to is still remembered.

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
- **Multi-campus school names:** "University of California, Los Angeles", "UC Los Angeles" and "University of California-Los Angeles" are treated as the same school, and the same goes for other systems.
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
