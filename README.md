# getmeajobpls

A Chrome extension that autofills job applications. Open an application, click **Fill page**, and it uploads your resume and answers the form from your profile. It never clicks Submit, and everything stays in your browser.

![A form filled by getmeajobpls, with filled fields outlined in green and the Fill page panel on the right](store/screenshot-4-filled-form.png)

![The options page, where you set up your profile](docs/options.png)

## Features

- **One-click fill** from a panel on the page or the toolbar popup. Uploads your resume first, then fills the rest without overwriting what the site already filled.
- **Picks the right resume and skills** for each job from keywords in the title and description.
- **Review highlights**: green for filled, orange for fields to check, with the reason in the popup.
- **Multi-page forms**: keeps filling each new step of Workday-style flows.
- **Saved answers**: answer a custom question once and similar questions are filled later.
- **Standard and EEO questions**: work authorization, sponsorship, relocation, start dates, referral source and more, all editable. Blank EEO answers become "decline to answer".
- **Every kind of field**, including searchable dropdowns, rich-text editors, date pickers and shadow DOM.
- **Resume tailoring (optional)**: rewrites a resume for the posting with your own Claude account. See [below](#resume-tailoring).

## Supported sites

| Site | Support |
| --- | --- |
| Greenhouse, Lever, Ashby, SmartRecruiters | Dedicated, tested live |
| Workday, iCIMS, SAP SuccessFactors | Dedicated |
| Workable, Rippling, Dover, Teamtailor, Recruitee, Jobvite, Breezy HR | Supported and tested |
| BambooHR, JazzHR, Taleo, Oracle, ADP, UKG, Dayforce, Paylocity, Phenom, Eightfold, Avature and more | Supported, not yet tested live |
| Any other site | Generic, matches fields by their labels |

## Install

Requires Node 20+ and Chrome (or another Chromium browser).

```sh
npm install
npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `.output/chrome-mv3`. Fill in your profile and upload your resumes on the options page.

After rebuilding, click ↻ on the extension and reload open application pages. To move to another browser, use **Backup → Export JSON** and **Import JSON…**.

## Resume tailoring

Optional. **Tailor resume** rewrites the selected resume for a posting from your resume and profile, using your own Claude account through [Claude Code](https://claude.com/claude-code) (no API key), and keeps it to one page. To set it up, open **Resume tailoring** on the options page and follow the steps there.

> **Always read a tailored resume before you submit it.** It is written by AI, which can get things wrong.

## Privacy

Everything is stored only in your browser, and the extension makes no network requests of its own. Resume tailoring, if you turn it on, sends the resume, the job page's text and your profile to Claude through your own Claude Code. See [PRIVACY.md](PRIVACY.md).

## Credits

Designed and built by [Arnav Podichetty](https://github.com/arnavpodichetty).
