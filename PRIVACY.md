# Privacy policy

_Last updated: November 23, 2026_

getmeajobpls is a browser extension that fills in job applications for you. This policy explains what it does with your information. It covers the Chrome version and the Firefox version (including Firefox-based browsers such as Zen), which work the same way.

## What the extension stores

You enter your own information on the extension's options page: your name, contact details, address, links, education, work history, projects, skills, languages, answers to common application questions, optional demographic (EEO) answers, and the resume files you upload.

All of it is stored in your browser, in the extension's local storage and IndexedDB. It is not sent to the developer or to any server operated by the developer, and the extension has no account of its own. If you turn on optional Cloud sync (below), a copy of your profile, resume rules, settings, resume files and transcript is also kept in your own Google Drive.

## When your information leaves your browser

Only when **you** ask: when you start a fill on an application page, when you turn on Cloud sync, or when you use one of the optional Claude features below. For a fill, the extension types your information into that page's form and attaches the resume you picked. What happens next is between you and that employer: the information is sent to them only if you submit the application yourself. The extension never clicks Submit.

Apart from Cloud sync and resume tailoring (below), the extension makes no other network requests. It has no analytics, tracking, advertising or remote code.

## Resume tailoring (optional, off by default)

If you turn on **Resume tailoring** and install its local helper, clicking **Tailor resume** sends the selected resume PDF, the text of the current job page, and your profile's Experience, Projects and skills to a helper program on your computer. The helper passes them to Claude Code, which you install and sign in to with your own Claude account, so they are processed by Anthropic under your account's terms. The tailored resume is saved back in the extension. Nothing is sent until you click the button.

Application pages often leave out the job description (Workday's steps, Lever's /apply page). When you click **Tailor resume** on a Workday, Lever, Ashby or Greenhouse page, the extension asks that site's public job listing for the posting's description. The request contains only the job's address, never your information, and goes to the same company's applicant tracking system you are already on. Apart from Cloud sync, this is the only network request the extension makes itself. The helper keeps a structured copy of each resume it has read on your computer (in `~/Library/Application Support/getmeajobpls/tailor/`, or `~/.config/getmeajobpls/tailor/` on Linux) so it doesn't have to read it again.

## Cloud sync (optional, off by default)

If you click **Sign in with Google** under **Options → Cloud sync**, Google asks you to let the extension store its own data in your Google Drive. With your permission, the extension saves your profile (including saved and EEO answers), resume rules, settings, resume files and transcript in Drive's hidden app data folder, and keeps it in step with every browser where you turn on Cloud sync with the same Google account. The extension asks only for access to that folder: it cannot see or change anything else in your Drive, and other apps cannot see the folder. Resume and transcript files over 5 MB are not synced.

Your data goes directly from your browser to Google and is stored under your Google account, subject to Google's terms and privacy policy. It is never sent to the developer. The sign-in token is kept in the browser's session storage, which is cleared when the browser closes. **Turn off** stops syncing and withdraws the extension's access; **Turn off and delete from Drive** also deletes everything the extension stored in Drive. Your data in the browser stays either way. You can also remove the extension's access at any time in your Google Account's security settings.

## Filling your profile with Claude (optional, off by default)

This uses the same local helper as resume tailoring, and only works once tailoring is set up. On the options page, **Fill my profile** can read up to three sources you choose, when you click **Read**:

- **A resume** from your library: the PDF is sent to the helper, as for tailoring.
- **A profile page**: on a page about you (for example your Simplify, LinkedIn or Handshake profile, or your website), clicking **Use this page for my profile** in the toolbar popup reads that page's visible text. The text is held in the browser's session storage, which is cleared when the browser closes, and is removed as soon as you apply or remove it. The extension reads only the page you have open; it does not sign in anywhere or load other pages.
- **Text you paste** into the box.

The helper passes the source to Claude Code under your own Claude account, as for tailoring. The answer comes back to the extension, which checks every value against the source's own text and shows you each proposed change. Nothing is saved to your profile until you tick it and click **Apply**. Your standard answers and EEO answers are never changed.

## Page snapshots

If you turn on **Settings → Developer → Show "Capture page" button**, the button saves an HTML snapshot of the current form to your computer's Downloads folder, without the values typed into it. The snapshot is not sent anywhere.

## Permissions

- **Read and change data on websites:** to find application forms on the many sites employers use (including forms embedded in other sites) and fill them when you ask. Before you start a fill, the extension reads the page to decide whether to show its panel, to pick a resume, and to show the posting's role, company, location and pay. On a job posting, it keeps the posting's text and details for that tab in the browser's session storage, which is cleared when the browser closes, so they are still available on the application pages that follow (for example for tailoring). None of this is sent anywhere.
- **Storage / unlimited storage:** to keep your profile and resume files on your computer.
- **Web navigation:** to find the frame of a page that holds the application form.
- **Identity:** to show Google's sign-in window when you turn on Cloud sync. It does nothing until you click **Sign in with Google**.
- **Native messaging (optional):** requested only when you turn on resume tailoring, to talk to the helper on your computer (for tailoring and for filling your profile).

## Your control

You can change or delete anything on the options page at any time. **Backup → Export JSON** saves a copy for you. Removing the extension deletes everything it stored in your browser; if you used Cloud sync, use **Turn off and delete from Drive** first, or remove the extension's access in your Google Account, which lets you delete its data there. If you installed the tailoring helper, `npm run tailor-install -- --uninstall` removes it; its cached resume reads are in the folder named above, which you can delete.

## Selling and sharing

Your information is not sold, shared, or used for anything other than helping you apply: filling in applications you choose to fill, and the optional Claude features you use.

## Contact

Questions about this policy: open an issue on the project's GitHub page, or contact the developer, [Arnav Podichetty](https://github.com/arnavpodichetty).
