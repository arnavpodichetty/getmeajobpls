// Optional cloud sync: keeps the profile, resume rules and settings the same in every
// browser signed in to the same Google account, through one JSON file in Drive's app data
// folder (see drive.ts). Off until the user signs in under Options → Cloud sync.
// Resume and transcript PDFs are not synced; Backup moves those.
//
// storage.local stays the copy everything reads. The background worker uploads after a
// local change and checks Drive for newer data when it starts; the options page asks it
// to sync when it opens.
import { browser } from 'wxt/browser';
import { normalizeProfile, normalizeSettings } from './defaults';
import { accountEmail, deleteFile, findFile, readFile, revokeToken, SignInRequired, writeFile } from './drive';
import { loadProfile, loadRules, loadSettings, saveProfile, saveRules, saveSettings } from './storage';
import type { Profile, ResumeRule, Settings } from './types';

export const FILE_NAME = 'getmeajobpls-sync.json';
export const STATE_KEY = 'cloudSync';
/** Local keys whose changes are uploaded. */
export const SYNCED_KEYS = ['profile', 'resumeRules', 'settings'] as const;
/** Settings that belong to one computer and stay out of sync. */
const LOCAL_ONLY_SETTINGS = ['tailorEnabled'] as const;

export interface SyncState {
  enabled: boolean;
  email: string;
  fileId: string | null;
  /** Hash of the data both sides held after the last sync; tells which side changed since. */
  syncedHash: string | null;
  /** When this browser's synced data last changed (ms). */
  localChangedAt: number;
  lastSyncAt: number;
  /** Shown in Options; set when a sync fails. */
  error: string | null;
  /** The last error was Google asking to sign in again. */
  needsSignIn: boolean;
}

export function defaultSyncState(): SyncState {
  return { enabled: false, email: '', fileId: null, syncedHash: null, localChangedAt: 0, lastSyncAt: 0, error: null, needsSignIn: false };
}

export async function loadSyncState(): Promise<SyncState> {
  const res = await browser.storage.local.get(STATE_KEY);
  return { ...defaultSyncState(), ...(res[STATE_KEY] as Partial<SyncState> | undefined) };
}

async function patchSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await loadSyncState()), ...patch };
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}

export interface SyncData {
  profile: Profile;
  rules: ResumeRule[];
  settings: Partial<Settings>;
}

interface SyncFile extends SyncData {
  format: 'getmeajobpls-sync';
  version: 1;
  updatedAt: number;
}

function sharedSettings(settings: Settings): Partial<Settings> {
  const copy: Partial<Settings> = { ...settings };
  for (const key of LOCAL_ONLY_SETTINGS) delete copy[key];
  return copy;
}

export async function collectLocal(): Promise<SyncData> {
  const [profile, rules, settings] = await Promise.all([loadProfile(), loadRules(), loadSettings()]);
  return { profile, rules, settings: sharedSettings(settings) };
}

/** Stable JSON (sorted keys), so the same data always hashes the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function hashData({ profile, rules, settings }: SyncData): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable({ profile, rules, settings })));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type Direction = 'none' | 'upload' | 'download';

/**
 * Which way to sync. Each side "changed" if it differs from what both held after the last
 * sync; when both changed, the one changed most recently wins.
 */
export function decide(o: { localHash: string; remoteHash: string | null; syncedHash: string | null; localChangedAt: number; remoteUpdatedAt: number }): Direction {
  if (o.remoteHash === null) return 'upload';
  if (o.remoteHash === o.localHash) return 'none';
  if (o.localHash === o.syncedHash) return 'download';
  if (o.remoteHash === o.syncedHash) return 'upload';
  return o.remoteUpdatedAt > o.localChangedAt ? 'download' : 'upload';
}

function parseRemote(text: string): (SyncData & { updatedAt: number }) | null {
  let data: Partial<SyncFile>;
  try {
    data = JSON.parse(text) as Partial<SyncFile>;
  } catch {
    return null;
  }
  if (data?.format !== 'getmeajobpls-sync' || !data.profile || typeof data.profile !== 'object') return null;
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  // A rule without its keywords or resume would break picking a resume on every page (as in Backup).
  const rules = (Array.isArray(data.rules) ? data.rules : []).filter((r) => r && typeof r.id === 'string' && typeof r.resumeId === 'string' && Array.isArray(r.keywords));
  return { profile: normalizeProfile(data.profile), rules, settings: sharedSettings(normalizeSettings(settings)), updatedAt: Number(data.updatedAt) || 0 };
}

interface Remote {
  fileId: string | null;
  data: (SyncData & { updatedAt: number }) | null;
  hash: string | null;
}

async function readRemote(state: SyncState): Promise<Remote> {
  const file = await findFile(FILE_NAME, state.email || undefined);
  if (!file) return { fileId: null, data: null, hash: null };
  const data = parseRemote(await readFile(file.id, state.email || undefined));
  return { fileId: file.id, data, hash: data ? await hashData(data) : null };
}

async function upload(state: SyncState, fileId: string | null, data: SyncData): Promise<string> {
  const file: SyncFile = { format: 'getmeajobpls-sync', version: 1, updatedAt: Date.now(), ...data };
  return writeFile(FILE_NAME, JSON.stringify(file), fileId, state.email || undefined);
}

/** Set after writing downloaded data, so the options page knows to redraw. */
export const APPLIED_KEY = 'cloudSyncApplied';

async function applyLocal(data: SyncData): Promise<void> {
  const current = await loadSettings();
  const settings = normalizeSettings({ ...current, ...data.settings });
  for (const key of LOCAL_ONLY_SETTINGS) (settings as unknown as Record<string, unknown>)[key] = current[key];
  await saveProfile(normalizeProfile(data.profile));
  await saveRules(data.rules);
  await saveSettings(settings);
  await browser.storage.local.set({ [APPLIED_KEY]: Date.now() });
}

// One sync at a time in this context; a sync asked for while one runs waits for it.
let running: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = running.then(fn, fn);
  running = next.catch(() => {});
  return next;
}

export type SyncResult = { direction: Direction } | { skipped: true };

/** Bring this browser and Drive level. Does nothing while sync is off. */
export function syncNow(): Promise<SyncResult> {
  return exclusive(async () => {
    const state = await loadSyncState();
    if (!state.enabled) return { skipped: true };
    try {
      const local = await collectLocal();
      const localHash = await hashData(local);
      const remote = await readRemote(state);
      const direction = decide({
        localHash,
        remoteHash: remote.hash,
        syncedHash: state.syncedHash,
        localChangedAt: state.localChangedAt,
        remoteUpdatedAt: remote.data?.updatedAt ?? 0,
      });
      let fileId = remote.fileId;
      if (direction === 'upload') fileId = await upload(state, fileId, local);
      if (direction === 'download') await applyLocal(remote.data!);
      await patchSyncState({ fileId, syncedHash: direction === 'download' ? remote.hash : localHash, lastSyncAt: Date.now(), error: null, needsSignIn: false });
      return { direction };
    } catch (err) {
      await patchSyncState({ error: err instanceof Error ? err.message : String(err), needsSignIn: err instanceof SignInRequired });
      throw err;
    }
  });
}

/** What Drive holds before turning sync on, so the user can pick which copy to keep. */
export async function inspectRemote(): Promise<{ email: string; remoteUpdatedAt: number | null; same: boolean }> {
  const email = await accountEmail();
  const remote = await readRemote({ ...defaultSyncState(), email });
  const same = remote.hash !== null && remote.hash === (await hashData(await collectLocal()));
  return { email, remoteUpdatedAt: remote.data ? remote.data.updatedAt : null, same };
}

/** Turn sync on after sign-in. `keep` says which copy wins when Drive already has data. */
export function enableSync(email: string, keep: 'local' | 'remote'): Promise<void> {
  return exclusive(async () => {
    const local = await collectLocal();
    const remote = await readRemote({ ...defaultSyncState(), email });
    let fileId = remote.fileId;
    let hash: string;
    if (keep === 'remote' && remote.data) {
      await applyLocal(remote.data);
      hash = remote.hash!;
    } else {
      fileId = await upload({ ...defaultSyncState(), email }, fileId, local);
      hash = await hashData(local);
    }
    await patchSyncState({ enabled: true, email, fileId, syncedHash: hash, localChangedAt: Date.now(), lastSyncAt: Date.now(), error: null, needsSignIn: false });
  });
}

/** Turn sync off; `deleteRemote` also removes the copy in Drive. Local data stays. */
export function disableSync(deleteRemote: boolean): Promise<void> {
  return exclusive(async () => {
    const state = await loadSyncState();
    if (deleteRemote) {
      const file = state.fileId ? { id: state.fileId } : await findFile(FILE_NAME, state.email || undefined);
      if (file) await deleteFile(file.id, state.email || undefined);
    }
    await revokeToken();
    await browser.storage.local.set({ [STATE_KEY]: defaultSyncState() });
  });
}

/** Background: note local edits and upload them shortly after the last one. */
export function watchLocalChanges(delayMs = 3000): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !SYNCED_KEYS.some((k) => k in changes)) return;
    void (async () => {
      const state = await loadSyncState();
      if (!state.enabled) return;
      await patchSyncState({ localChangedAt: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow().catch(() => {}), delayMs);
    })();
  });
}

/** Background start: look for changes made in other browsers, at most every few minutes. */
export async function syncOnWake(minGapMs = 5 * 60_000): Promise<void> {
  const state = await loadSyncState();
  if (!state.enabled || state.needsSignIn || Date.now() - state.lastSyncAt < minGapMs) return;
  await syncNow().catch(() => {});
}
