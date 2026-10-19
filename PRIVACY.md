# Privacy policy

_Last updated: October 18, 2026_

getmeajobpls is a browser extension that fills in job applications for you. This policy explains what it does with your information.

## What the extension stores

You enter your own information on the extension's options page: your name, contact details, address, links, education, work history, projects, skills, languages, answers to common application questions, optional demographic (EEO) answers, and the resume files you upload.

All of it is stored **only in your browser**, in the extension's local storage and IndexedDB. It is not sent to the developer or to any server operated by the developer, and the extension has no account or sign-in.

## When your information leaves your browser

Only when **you** start a fill on an application page. The extension then types your information into that page's form and attaches the resume you picked. What happens next is between you and that employer: the information is sent to them only if you submit the application yourself. The extension never clicks Submit.

The extension makes no other network requests. It has no analytics, tracking, advertising or remote code.

## Resume tailoring (optional, off by default)

If you turn on **Resume tailoring** and install its local helper, clicking **Tailor resume** sends the selected resume PDF, the text of the current job page, and your profile's Experience, Projects and skills to a helper program on your computer. The helper passes them to Claude Code, which you install and sign in to with your own Claude account, so they are processed by Anthropic under your account's terms. The tailored resume is saved back in the extension. Nothing is sent until you click the button, and the extension still makes no network requests itself. The helper keeps a structured copy of each resume it has read on your computer (in `~/Library/Application Support/getmeajobpls/tailor/`, or `~/.config/getmeajobpls/tailor/` on Linux) so it doesn't have to read it again.

## Page snapshots

If you turn on **Settings → Developer → Show "Capture page" button**, the button saves an HTML snapshot of the current form to your computer's Downloads folder, without the values typed into it. The snapshot is not sent anywhere.

## Permissions

- **Read and change data on websites:** to find application forms on the many sites employers use (including forms embedded in other sites) and fill them when you ask. Before you start a fill, the extension only looks at a page's form fields to decide whether to show its Fill button; nothing about the pages you visit is stored or sent anywhere.
- **Storage / unlimited storage:** to keep your profile and resume files on your computer.
- **Web navigation:** to find the frame of a page that holds the application form.
- **Native messaging (optional):** requested only when you turn on resume tailoring, to talk to the helper on your computer.

## Your control

You can change or delete anything on the options page at any time. **Backup → Export JSON** saves a copy for you. Removing the extension deletes everything it stored.

## Selling and sharing

Your information is not sold, shared, or used for anything other than filling in applications you choose to fill.

## Contact

Questions about this policy: open an issue on the project's GitHub page, or contact the developer, [Arnav Podichetty](https://github.com/arnavpodichetty).
