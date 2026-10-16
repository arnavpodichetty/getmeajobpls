# getmeajobpls

A Chrome extension that autofills job applications. Open an application, click **Fill page**, and it uploads your resume and answers the form from your profile.

It never clicks Submit. Everything stays in your browser. Your profile and resumes are stored locally, and nothing is sent anywhere.

## Features

- **One-click fill**: a **Fill page** button on the page (or in the toolbar popup) fills the whole form from top to bottom. Close the on-page panel with **×** to hide it and stop autofill on that page.
- **Resume upload first**: attaches your resume, waits for the site to read it, then fills what's left. Fields the site already filled are kept.
- **Resume and skill rules**: picks the right resume and skill set for each job from keywords in the title and description (e.g. `software` → SWE resume).
- **Review highlights**: filled fields get a green outline. Fields that need a check get an orange outline and show up in the popup with the reason.
- **Multi-page forms**: keeps filling each new step as you move through Workday-style flows.
- **Saved answers**: answer a custom question once, click **Save my answers from this page**, and similar questions on later forms are filled for you.
- **Smart matching**: handles different spellings of schools, degrees, majors (with fallbacks), states, countries, dates, GPA and graduation ranges, yes/no wordings, and decline options.
- **Standard questions**: work authorization, sponsorship, US citizen and export-control status, employment and regulatory history, board or trustee roles, relocation, start dates and internship terms, class standing, test scores, referral source, agreements, and more. All of these are editable on the options page.
- **EEO questions**: blank answers become the form's "decline to answer" option. Race subgroups (e.g. East Asian) pick the subgroup when listed and the broad category otherwise.
- **Location preferences**: ranks offered office locations by your preferred states and cities, if you set them.
- **Every kind of field**: text boxes, dropdowns, searchable dropdowns, radios, checkboxes, yes/no buttons, rich-text editors and date pickers, including inside shadow DOM. It also skips hidden bot-trap fields.
- **Page capture (developer)**: turn on **Settings → Developer → Show "Capture page" button** to save a snapshot of a form, so support for a site can be fixed. Snapshots download to your Downloads folder; `npm run pull-captures` moves them into the git-ignored `captures/` folder (add `-- --watch` to keep moving new ones).

## Supported sites

| Site | Support |
| --- | --- |
| Greenhouse | Dedicated support, tested live |
| Lever | Dedicated support, tested live |
| Ashby | Dedicated support, tested live |
| SmartRecruiters | Dedicated support, tested live |
| Workday | Dedicated support for each step, repeating sections and skills |
| iCIMS | Dedicated support |
| SAP SuccessFactors | Dedicated support: opens sections and adds a row for each job, school and language |
| Workable, Rippling, Dover, Teamtailor, Recruitee, Jobvite, Breezy HR | Supported and tested |
| BambooHR, JazzHR, Taleo, Oracle Recruiting, ADP, UKG, Dayforce, Paylocity, Phenom, Eightfold, Avature, Pinpoint, Personio, Wellfound, Gem, Comeet, JobScore, Freshteam, Zoho Recruit, Cornerstone | Supported, not yet tested live |
| Any other site | Generic support that matches fields by their labels |

## Install

Requires Node 20+ and Google Chrome (or another Chromium browser).

1. Install and build:
   ```sh
   npm install
   npm run build
   ```
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Pin the extension from the puzzle-piece menu.
5. Fill in your profile and upload your resumes on the options page, which opens on install or from the popup's **Profile ↗** link.

After rebuilding, click ↻ on the extension in `chrome://extensions` and reload any open application pages.

To move your profile to another browser or computer, use **Backup → Export JSON** (tick **Include resume PDFs**) and **Import JSON…** on the other side.

## Privacy

Everything you enter is stored only in your browser. The extension makes no network requests of its own; your information goes to an employer only when you submit an application yourself. See [PRIVACY.md](PRIVACY.md).

## Credits

Designed and built by [Arnav Podichetty](https://github.com/arnavpodichetty).

Workday's step names and `data-automation-id` conventions were cross-checked against
[Autofill-Jobs](https://github.com/andrewmillercode/Autofill-Jobs) (MIT). No code was copied.
