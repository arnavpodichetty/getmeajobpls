import { browser } from 'wxt/browser';
import { h } from '../../lib/dom';
import { saveSettings } from '../../lib/storage';
import { nativeMessagingReady, PERMISSION, pingHelper, REOPEN_KEY } from '../../lib/tailor';
import type { Settings } from '../../lib/types';
import { showToast } from './toast';

/** Setup for "Tailor resume": the optional permission, the local helper, and a connection test. */
export function tailoringSection(settings: Settings, save: () => void): HTMLElement {
  const installCmd = `npm run tailor-install -- ${browser.runtime.id}`;
  const result = h('span', { class: 'hint' });

  const toggle = h('input', {
    type: 'checkbox',
    checked: settings.tailorEnabled,
    onChange: async () => {
      if (toggle.checked) {
        const granted = await browser.permissions.request(PERMISSION).catch(() => false);
        if (!granted) {
          toggle.checked = false;
          showToast('Permission not granted', true);
          return;
        }
      } else {
        await browser.permissions.remove(PERMISSION).catch(() => false);
      }
      settings.tailorEnabled = toggle.checked;
      await saveSettings(settings);
      // Chrome only exposes native messaging to pages and workers started after the
      // grant, so restart the extension once and come back to this section.
      if (toggle.checked && !nativeMessagingReady()) {
        showToast('Restarting the extension to finish turning on tailoring…');
        await browser.storage.local.set({ [REOPEN_KEY]: 'tailoring' });
        setTimeout(() => browser.runtime.reload(), 800);
        return;
      }
      save();
    },
  });

  const test = h('button', {
    class: 'secondary',
    onClick: async () => {
      test.disabled = true;
      result.textContent = 'Checking…';
      result.className = 'hint';
      try {
        if (!(await browser.permissions.contains(PERMISSION))) throw new Error('Turn on the checkbox above first.');
        const { claude, claudeVersion } = await pingHelper();
        if (!claude) throw new Error('The helper is installed, but Claude Code was not found. Install it (step 1).');
        result.textContent = `Connected. Claude Code ${claudeVersion || ''} at ${claude}`;
      } catch (err) {
        result.textContent = err instanceof Error ? err.message : String(err);
        result.className = 'hint err';
      } finally {
        test.disabled = false;
      }
    },
  }, 'Test connection');

  return h(
    'section',
    { id: 'tailoring' },
    h('h2', {}, 'Resume tailoring'),
    h(
      'p',
      { class: 'intro' },
      'Adds "Tailor resume" to the on-page panel. Your own Claude account rewrites the selected resume for the posting, through Claude Code on this computer (no API key). ' +
        'Claude works from the resume plus your profile: the Experience and Projects descriptions (one point per line) and your skills. It can use those details, swap in a role or project from your profile when it fits the job better, and drop a less relevant one (never education or a current role). ' +
        'Every bullet must trace back to your resume or profile: a rewrite that adds a number or a tool its sources don\'t have is replaced by the original. ' +
        'The tailored PDF keeps your file name, is added under Resumes, and is picked for the upload on that page. The last 10 are kept.',
    ),
    h(
      'p',
      { class: 'notice' },
      h('strong', {}, 'Always check a tailored resume before you submit it. '),
      'It is written by AI, which can misword, overstate or misplace things even with the checks above. ' +
        'Open it with Preview PDF, read every line, and fix or skip anything that isn\'t accurate. You are responsible for what you send to employers.',
    ),
    h('label', { class: 'check' }, toggle, h('span', {}, 'Show "Tailor resume" on application pages', h('small', {}, 'Asks Chrome for permission to talk to the local helper.'))),
    h('h3', {}, 'Setup (once)'),
    h('p', {}, '1. Install Claude Code, then run ', h('code', {}, 'claude'), ' once and sign in with your Claude account:'),
    h('pre', {}, 'curl -fsSL https://claude.ai/install.sh | bash'),
    h('p', {}, '2. In the getmeajobpls folder, register the helper for this extension:'),
    h('pre', {}, installCmd),
    h('div', { class: 'row' }, test, result),
    h(
      'p',
      { class: 'hint' },
      'What is sent: the resume PDF, the text of the job page and your profile\'s experience, projects and skills go to the helper, which passes them to Claude Code under your account. ' +
        'Nothing is sent until you click Tailor resume.',
    ),
  );
}
