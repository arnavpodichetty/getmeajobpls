import { browser } from 'wxt/browser';
import { disableSync, enableSync, inspectRemote, loadSyncState, STATE_KEY, type SyncState } from '../../lib/cloudSync';
import { h } from '../../lib/dom';
import { getToken, GOOGLE_CLIENT_ID, identityAvailable, redirectUrl } from '../../lib/drive';
import { showToast } from './toast';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
}

/** Ask the background (the one place syncs run) to sync now. */
async function requestSync(): Promise<void> {
  const res = (await browser.runtime.sendMessage({ type: 'sync:now' })) as { ok: boolean; error?: string } | undefined;
  if (res && !res.ok) throw new Error(res.error);
}

/** The section on screen; the page re-renders it after imports and syncs. */
let redraw: (() => Promise<void>) | null = null;

// Keep the status current while the page is open (syncs run in the background). Skipped while a
// choice is on screen, so a background update can't wipe it.
browser.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && STATE_KEY in changes && !document.querySelector('#sync .notice')) void redraw?.();
});

// Pick up edits made in other browsers once, when Options opens.
void loadSyncState().then((s) => (s.enabled ? requestSync() : undefined)).catch(() => {});

/** Options → Cloud sync: optional Google Drive sync of the profile, rules and settings. */
export function cloudSyncSection(): HTMLElement {
  const body = h('div', {});
  const intro = h(
    'p',
    { class: 'intro' },
    'Optional. Sign in with Google to keep your profile, saved answers, resume rules and settings the same in every browser where you sign in, Chrome and Firefox alike. ' +
      'They are saved in a hidden app folder in your own Google Drive, which only this extension can open; nothing goes to the developer. ' +
      'Your resumes and transcript sync too, except files over 5 MB. Off until you sign in.',
  );

  const render = async () => {
    if (!GOOGLE_CLIENT_ID) {
      body.replaceChildren(
        h('p', { class: 'hint' }, 'Cloud sync is not set up in this build. To set it up, create a Google OAuth client (Web application) with the Drive API, add this redirect URI to it, and build with WXT_GOOGLE_CLIENT_ID set in .env.'),
        h('p', {}, h('code', {}, redirectUrl() || 'This browser does not support extension sign-in.')),
      );
      return;
    }
    if (!identityAvailable()) {
      body.replaceChildren(h('p', { class: 'hint' }, 'This browser does not let extensions sign in to Google, so cloud sync is not available here.'));
      return;
    }
    const state = await loadSyncState();
    body.replaceChildren(...(state.enabled ? connected(state) : disconnected()));
  };

  /** Run a button's action; redraw afterwards unless it returns false (it drew something itself). */
  const busy = async (button: HTMLButtonElement, fn: () => Promise<void | false>) => {
    button.disabled = true;
    let redraw = true;
    try {
      redraw = (await fn()) !== false;
    } catch (err) {
      showToast(message(err), true);
    } finally {
      button.disabled = false;
      if (redraw) await render();
    }
  };

  function disconnected(): HTMLElement[] {
    const signIn: HTMLButtonElement = h('button', {
      onClick: () =>
        busy(signIn, async () => {
          await getToken(true);
          const { email, remoteUpdatedAt, same } = await inspectRemote();
          if (remoteUpdatedAt === null || same) {
            await enableSync(email, 'local');
            showToast('Cloud sync is on');
            return;
          }
          // Drive already has data from another browser: the user picks which copy to keep.
          body.replaceChildren(choose(email, remoteUpdatedAt));
          return false;
        }),
    }, 'Sign in with Google');
    return [h('div', { class: 'row' }, signIn)];
  }

  function choose(email: string, remoteUpdatedAt: number): HTMLElement {
    const pick = (keep: 'local' | 'remote') => async (e: Event) => {
      const button = e.currentTarget as HTMLButtonElement;
      await busy(button, async () => {
        await enableSync(email, keep);
        showToast(keep === 'remote' ? 'Loaded your profile from Google Drive' : 'Saved this browser\'s profile to Google Drive');
      });
    };
    return h(
      'div',
      { class: 'notice' },
      h('p', {}, h('strong', {}, `${email}'s Google Drive already has a profile`), ` (saved ${when(remoteUpdatedAt)}), and it differs from this browser's. Which one do you want to keep? The other's profile, answers, rules and settings are replaced; resumes from both are kept.`),
      h(
        'div',
        { class: 'row' },
        h('button', { onClick: pick('remote') }, 'Use the Google Drive copy'),
        h('button', { class: 'secondary', onClick: pick('local') }, 'Use this browser\'s copy'),
        h('button', { class: 'secondary', onClick: () => void render() }, 'Cancel'),
      ),
    );
  }

  function connected(state: SyncState): HTMLElement[] {
    const status = state.error
      ? h('p', { class: 'hint err' }, state.needsSignIn ? 'Google asked you to sign in again. ' : 'Last sync failed: ', state.needsSignIn ? '' : state.error)
      : h('p', { class: 'hint' }, `Last synced ${when(state.lastSyncAt)}.`);
    const signInAgain: HTMLButtonElement = h('button', {
      onClick: () => busy(signInAgain, async () => {
        await getToken(true, state.email || undefined);
        await requestSync();
        showToast('Synced');
      }),
    }, 'Sign in again');
    const syncButton: HTMLButtonElement = h('button', {
      class: 'secondary',
      onClick: () => busy(syncButton, async () => {
        await requestSync();
        showToast('Synced');
      }),
    }, 'Sync now');
    const off: HTMLButtonElement = h('button', {
      class: 'secondary',
      onClick: () => busy(off, async () => {
        await disableSync(false);
        showToast('Cloud sync is off');
      }),
    }, 'Turn off');
    const offAndDelete: HTMLButtonElement = h('button', {
      class: 'secondary',
      onClick: () => busy(offAndDelete, async () => {
        if (!confirm('Turn off cloud sync and delete the copy in your Google Drive? Your data in this browser stays. Turn sync off in your other browsers too, or they will save their copy to Drive again.')) return;
        await disableSync(true);
        showToast('Cloud sync is off; the Google Drive copy is deleted');
      }),
    }, 'Turn off and delete from Drive');
    return [
      h('p', {}, 'Syncing with ', h('strong', {}, state.email || 'your Google account'), '.'),
      status,
      h('div', { class: 'row' }, ...(state.needsSignIn ? [signInAgain] : []), syncButton, off, offAndDelete),
    ];
  }

  redraw = render;
  void render();

  return h('section', { id: 'sync' }, h('h2', {}, 'Cloud sync'), intro, body);
}
