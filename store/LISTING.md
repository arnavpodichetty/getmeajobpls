# Chrome Web Store listing

Copy-paste text and answers for the Chrome Web Store Developer Dashboard.

## Package

```sh
npm install
npm run build
npm run zip        # → .output/getmeajobpls-<version>-chrome.zip
```

Upload the zip under **Package**. The first upload can use the current version; every later upload needs a higher `version` in `package.json` than the one already in the store.

## Store listing

**Name:** getmeajobpls — Autofill

**Summary** (132 characters max):

> Apply faster: one-click autofill for Workday, Greenhouse, Lever and more, plus tailored resumes. No account; data stored on-device.

**Category:** Workflow & Planning

**Language:** English

**Description:**

> Apply faster. getmeajobpls fills job applications in one click on Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS, SAP SuccessFactors, Workable, Rippling, Jobvite, BambooHR, Taleo and more, plus any other form that labels its fields. That includes the parts that usually take longest: Workday's multi-step forms, searchable dropdowns, custom questions, and forms embedded in a company's own careers site. It can also tailor your resume to each posting.
>
> Your profile and resumes are stored on your device, in your browser. No account, no subscription, no tracking.
>
> BUILT TO BE TRUSTED, NOT JUST FAST
> • Green means filled. Anything it isn't sure of is flagged orange for you to check, instead of being guessed and left looking done.
> • It never clicks Submit. You review every application before you send it.
> • It leaves alone what you or the site already filled in.
>
> BUILT FOR APPLYING A LOT
> • Keep several resumes; the right one is picked for each job from keywords you choose, with a matching set of skills.
> • Common questions are answered from answers you set once: work authorization, sponsorship, relocation, start date, how you heard about the job and more.
> • Save your answer to a custom question and it's filled the next time a similar one appears.
> • Handles dropdowns, searchable lists, radio buttons, checkboxes, date pickers and multi-step forms like Workday's, including forms embedded in a company's own careers site.
> • Shows the role, company, location and pay of the posting you're on.
>
> OPTIONAL, WITH YOUR OWN CLAUDE ACCOUNT
> Through Claude Code on your computer. Both are off by default and send nothing until you click.
> • Fill my profile: set up your profile from your resume, a profile page or pasted text. Every value is checked against the source, and you approve each change.
> • Tailor resume: rewrites a resume for the posting. Every line must trace back to your resume or profile.
>
> Free, with no premium tier. Source code on GitHub.

**Images** (generated with `npm run build && npm run store-assets`):

| Field | File |
| --- | --- |
| Store icon (128×128) | `public/icon/128.png` |
| Screenshots (1280×800) | `store/screenshot-1-profile.png`, `store/screenshot-2-standard-answers.png`, `store/screenshot-3-resumes.png`, `store/screenshot-4-filled-form.png`, `store/screenshot-5-fill-my-profile.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

## Privacy practices

**Single purpose:**

> Helps the user apply for jobs: fills in job application forms with information the user saved in the extension, when the user asks it to. Optional features, off by default, use the user's own Claude account to tailor their resume to a posting and to fill their saved profile from their resume or a page they choose.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's profile, answers and settings locally in the browser. |
| `unlimitedStorage` | Stores the user's resume PDFs locally (IndexedDB) so they can be attached to applications; several resumes can exceed the default quota. |
| `webNavigation` | Lists the frames of the current tab to find the one that holds the application form. Many employers embed their application form (Greenhouse, iCIMS, Workday) in an iframe on their own careers site. |
| `nativeMessaging` (optional) | Requested only when the user turns on resume tailoring in Options. It lets the extension talk to a helper program the user installs on their own computer, which runs Claude Code (signed in with the user's own Claude account) to rewrite the selected resume for the job posting, and, when the user asks, to read their resume, a profile page they choose or text they paste into profile fields for them to review. Not requested otherwise. |
| Host permission (`<all_urls>`) | Employers host application forms on thousands of different domains (their own careers sites, and Workday, Greenhouse, Lever, iCIMS and other applicant tracking systems, often embedded in iframes). The content script must run on those pages to detect the form and fill it when the user clicks Fill. Before that it reads the page to decide whether to show its small fill panel, to pick the right resume and to show the posting's details in that panel; it fills nothing and sends nothing anywhere until the user clicks. |

**Remote code:** No, I am not using remote code.

**Data usage** — check these boxes:

- [x] **Personally identifiable information** (name, address, email, phone, resume): stored locally; filled into application forms only when the user starts a fill. With the optional Claude features, the resume and profile details are sent to the user's own Claude Code on their computer only when they click Tailor resume or Read.
- [x] **Website content** (the job posting's text, or a profile page the user picks): read to pick a resume; with the optional Claude features, sent to the user's own Claude Code on their computer only when they click Tailor resume, or Use this page for my profile and then Read.

Leave everything else unchecked (health, financial, authentication, personal communications, location, web history, user activity).

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://github.com/arnavpodichetty/getmeajobpls/blob/main/PRIVACY.md`

## Test instructions (Distribution → Test instructions)

> No account or login is needed. Open the options page (it opens on install), fill in a few Personal fields (or Backup → import any JSON export), and upload any PDF under Resumes. Then open a public job application, for example any job on boards.greenhouse.io or jobs.lever.co and its Apply form. A small "Fill page" panel appears at the top right; click it and the form is filled. The extension never clicks Submit. Resume tailoring and Fill my profile are optional and need a local helper plus Claude Code, so they can be left off for review (with them off, the extension never uses native messaging). The small script on jobs.ashbyhq.com (ashby-saves.js) runs in the page only to count Ashby's own in-flight save requests so fields are filled one save at a time; it sends nothing.

## Before submitting

- Build from a clean checkout so nothing outside the repo ends up in the zip.
- The developer account needs a contact email and a one-time $5 registration fee.
- Review usually takes a few days; broad host permissions can make it take longer.
