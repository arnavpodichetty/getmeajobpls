# Chrome Web Store listing

Copy-paste text and answers for the Chrome Web Store Developer Dashboard.

## Package

```sh
npm install
npm run build
npm run zip        # → .output/getmeajobpls-<version>-chrome.zip
```

Upload the zip under **Package**. Bump `version` in `package.json` for every new upload.

## Store listing

**Name:** getmeajobpls — Autofill

**Summary** (132 characters max):

> Fill job applications on Workday, Greenhouse, Lever and more from one profile. Never submits. Your data stays in your browser.

**Category:** Workflow & Planning

**Language:** English

**Description:**

> Fill job applications in one click.
>
> Set up your profile once (contact info, education, work history, links, skills and your answers to common questions), upload your resumes, and getmeajobpls fills application forms for you.
>
> • Works on Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS, SAP SuccessFactors, Workable, Rippling, Jobvite, BambooHR, Taleo and more, plus any other form that labels its fields.
> • Picks the right resume for each job based on keywords you choose.
> • Answers common questions such as work authorization, sponsorship, relocation, start date, relatives at the company and how you heard about the job, from answers you set once.
> • Handles dropdowns, searchable lists, radio buttons, checkboxes, date pickers and multi-step forms like Workday's.
> • Save your answers to custom questions and they're filled the next time a similar one appears.
> • Highlights what it filled in green and what needs your review in orange.
>
> It never clicks Submit: you review every application before sending it.
>
> Private by design: everything is stored only in your browser. No account, no tracking, no servers.

**Images** (generated with `npm run build && npm run store-assets`):

| Field | File |
| --- | --- |
| Store icon (128×128) | `public/icon/128.png` |
| Screenshots (1280×800) | `store/screenshot-1-profile.png`, `store/screenshot-2-standard-answers.png`, `store/screenshot-3-resumes.png`, `store/screenshot-4-filled-form.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

## Privacy practices

**Single purpose:**

> Fills in job application forms with information the user saved in the extension, when the user asks it to.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's profile, answers and settings locally in the browser. |
| `unlimitedStorage` | Stores the user's resume PDFs locally (IndexedDB) so they can be attached to applications; several resumes can exceed the default quota. |
| `webNavigation` | Lists the frames of the current tab to find the one that holds the application form. Many employers embed their application form (Greenhouse, iCIMS, Workday) in an iframe on their own careers site. |
| Host permission (`<all_urls>`) | Employers host application forms on thousands of different domains (their own careers sites, and Workday, Greenhouse, Lever, iCIMS and other applicant tracking systems, often embedded in iframes). The content script must run on those pages to detect the form and fill it when the user clicks Fill. Before that it only looks at the page's form fields to decide whether to show its Fill button; it changes nothing on the page and sends nothing anywhere. |

**Remote code:** No, I am not using remote code.

**Data usage** — check these boxes:

- [x] **Personally identifiable information** (name, address, email, phone, resume): stored locally; filled into application forms only when the user starts a fill.

Leave everything else unchecked (health, financial, authentication, personal communications, location, web history, user activity, website content).

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** a public link to [`PRIVACY.md`](../PRIVACY.md), for example `https://github.com/<you>/getmeajobpls/blob/main/PRIVACY.md` once the repo is public on GitHub.

## Before submitting

- Build from a clean checkout so nothing outside the repo ends up in the zip.
- The developer account needs a contact email and a one-time $5 registration fee.
- Review usually takes a few days; broad host permissions can make it take longer.
