// Google sign-in and the Google Drive calls behind optional cloud sync (see cloudSync.ts).
// Files go to Drive's app data folder: hidden from the user's Drive and from every other
// app, and the only part of Drive the drive.appdata scope can reach.
import { browser } from 'wxt/browser';

/**
 * OAuth client id ("Web application" type) from Google Cloud. Set WXT_GOOGLE_CLIENT_ID in
 * .env before building; without it the Cloud sync section explains how to set it up.
 * Its authorized redirect URIs must include each browser's redirectUrl() below.
 */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'driveToken';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Thrown when Google needs the user to sign in again (a click on "Sign in with Google"). */
export class SignInRequired extends Error {
  constructor(message = 'Sign in with Google again to keep syncing.') {
    super(message);
    this.name = 'SignInRequired';
  }
}

/** Firefox for Android and some Chromium forks have no identity API. */
export function identityAvailable(): boolean {
  return typeof browser.identity?.launchWebAuthFlow === 'function';
}

/** The address Google sends the user back to; register it on the OAuth client. */
export function redirectUrl(): string {
  try {
    return identityAvailable() ? browser.identity.getRedirectURL() : '';
  } catch {
    return '';
  }
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

// Kept in session storage: gone when the browser closes, and never synced or backed up.
async function storedToken(): Promise<StoredToken | undefined> {
  const res = await browser.storage.session.get(TOKEN_KEY).catch(() => ({}) as Record<string, unknown>);
  return res[TOKEN_KEY] as StoredToken | undefined;
}

export async function forgetToken(): Promise<void> {
  await browser.storage.session.remove(TOKEN_KEY).catch(() => {});
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * An access token for Drive. `interactive` shows Google's sign-in window (needs a click);
 * otherwise Google is asked silently, which works while the user is still signed in to
 * Google in this browser and fails with SignInRequired when not.
 */
export async function getToken(interactive: boolean, loginHint?: string): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Cloud sync is not set up in this build (no Google client id).');
  if (!identityAvailable()) throw new Error('This browser does not support signing in from extensions.');
  const cached = await storedToken();
  if (!interactive && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const state = randomState();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUrl(),
    scope: SCOPE,
    state,
    prompt: interactive ? 'select_account' : 'none',
    ...(loginHint && { login_hint: loginHint }),
  }).toString();

  let result: string | undefined;
  try {
    result = await browser.identity.launchWebAuthFlow({ url: url.toString(), interactive });
  } catch (err) {
    if (!interactive) throw new SignInRequired();
    throw new Error(`Google sign-in did not finish${err instanceof Error && err.message ? ` (${err.message})` : ''}.`);
  }
  const params = new URLSearchParams(new URL(result ?? '').hash.slice(1));
  if (params.get('state') !== state) throw new Error('Google sign-in returned an unexpected answer; try again.');
  const token = params.get('access_token');
  if (!token) {
    const error = params.get('error') ?? 'no token';
    if (!interactive || error === 'access_denied') throw new SignInRequired(error === 'access_denied' ? 'Google access was not allowed.' : undefined);
    throw new Error(`Google sign-in failed (${error}).`);
  }
  const expiresIn = Number(params.get('expires_in')) || 3600;
  await browser.storage.session.set({ [TOKEN_KEY]: { token, expiresAt: Date.now() + expiresIn * 1000 } satisfies StoredToken });
  return token;
}

/** Let go of Drive access: Google forgets the grant, and this browser forgets the token. */
export async function revokeToken(): Promise<void> {
  const cached = await storedToken();
  await forgetToken();
  if (cached) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cached.token)}`, { method: 'POST' }).catch(() => {});
}

/** One Drive request, signing in silently again once if the token has expired. */
async function call(path: string, init: RequestInit = {}, loginHint?: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken(false, loginHint);
    const res = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401 && attempt === 0) {
      await forgetToken();
      continue;
    }
    if (res.status === 401) throw new SignInRequired();
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? res.statusText;
      throw new Error(`Google Drive: ${reason || res.status}`);
    }
    return res;
  }
}

export interface DriveFile {
  id: string;
  modifiedTime: string;
}

export async function findFile(name: string, loginHint?: string): Promise<DriveFile | null> {
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${name}' and trashed = false`, fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc' });
  const { files } = (await (await call(`${API}/files?${q}`, {}, loginHint)).json()) as { files: DriveFile[] };
  return files[0] ?? null;
}

export async function readFile(id: string, loginHint?: string): Promise<string> {
  return (await call(`${API}/files/${id}?alt=media`, {}, loginHint)).text();
}

export async function readBlob(id: string, loginHint?: string): Promise<Blob> {
  return (await call(`${API}/files/${id}?alt=media`, {}, loginHint)).blob();
}

/** Every file in the app data folder whose name starts with `prefix`. */
export async function listFiles(prefix: string, loginHint?: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name contains '${prefix}' and trashed = false`, fields: 'nextPageToken,files(id,name)', pageSize: '1000', ...(pageToken && { pageToken }) });
    const res = (await (await call(`${API}/files?${q}`, {}, loginHint)).json()) as { files: { id: string; name: string }[]; nextPageToken?: string };
    out.push(...res.files.filter((f) => f.name.startsWith(prefix)));
    pageToken = res.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Create the file in the app data folder, or replace the contents of `id`. Returns its id. */
export async function writeFile(name: string, content: string | Blob, id: string | null, loginHint?: string, mimeType = 'application/json'): Promise<string> {
  if (id) {
    await call(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: content }, loginHint);
    return id;
  }
  const boundary = `gmjp${randomState()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, loginHint);
  return ((await res.json()) as { id: string }).id;
}

export async function deleteFile(id: string, loginHint?: string): Promise<void> {
  await call(`${API}/files/${id}`, { method: 'DELETE' }, loginHint);
}

/** The signed-in account's address, to show which account sync uses. */
export async function accountEmail(): Promise<string> {
  const res = await call(`${API}/about?fields=user(emailAddress)`);
  return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
}
