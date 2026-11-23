// Optional cloud sync: keeps the profile, resume rules, settings and resume/transcript files
// the same in every browser signed in to the same Google account, through Drive's app data
// folder (see drive.ts). Off until the user signs in under Options → Cloud sync.
//
// Drive holds one JSON file (profile, rules, settings and the list of files with a SHA-256
// of each) plus one Drive file per distinct PDF, named after its hash. A file's content is
// uploaded once and only downloaded where its hash is missing.
//
// storage.local stays the copy everything reads. The background worker uploads after a
// local change and checks Drive for newer data when it starts; the options page asks it
// to sync when it opens.
import { browser } from 'wxt/browser';
import { normalizeProfile, normalizeSettings } from './defaults';
import { accountEmail, deleteFile, findFile, listFiles, readBlob, readFile, revokeToken, SignInRequired, writeFile } from './drive';
import { deleteResume, FILES_CHANGED_KEY, getResume, listAllFiles, putResume } from './resumeDb';
import { loadProfile, loadRules, loadSettings, saveProfile, saveRules, saveSettings } from './storage';
import type { Profile, ResumeMeta, ResumeRule, Settings } from './types';

export const FILE_NAME = 'getmeajobpls-sync.json';
/** Drive name prefix of a stored resume/transcript; the rest is the SHA-256 of its content. */
export const BLOB_PREFIX = 'getmeajobpls-file-';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const STATE_KEY = 'cloudSync';
/** Local keys whose changes are uploaded. */
export const SYNCED_KEYS = ['profile', 'resumeRules', 'settings', FILES_CHANGED_KEY] as const;
/** Settings that belong to one computer and stay out of sync. */
const LOCAL_ONLY_SETTINGS = ['tailorEnabled'] as const;

export interface SyncState {
  enabled: boolean;
  email: string;
  fileId: string | null;
  /** Hash of the data both sides held after the last sync; tells which side changed since. */
  syncedHash: string | null;
  /**
   * Ids of the files both sides held after the last sync. A file missing on one side is a
   * deletion only if it is listed here; otherwise it is new on the other side and is kept,
   * so the "most recent change wins" rule never throws away a resume.
   */
  syncedFileIds: string[];
  /** When this browser's synced data last changed (ms). */
  localChangedAt: number;
  lastSyncAt: number;
  /** Shown in Options; set when a sync fails. */
  error: string | null;
  /** The last error was Google asking to sign in again. */
  needsSignIn: boolean;
}

export function defaultSyncState(): SyncState {
  return { enabled: false, email: '', fileId: null, syncedHash: null, syncedFileIds: [], localChangedAt: 0, lastSyncAt: 0, error: null, needsSignIn: false };
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

/** A stored resume or transcript as listed in the sync file. */
export type SyncedFile = ResumeMeta & { sha: string };

export interface SyncData {
  profile: Profile;
  rules: ResumeRule[];
  settings: Partial<Settings>;
  /** Absent in files written before files were synced: leave this browser's files alone. */
  files?: SyncedFile[];
}

/** This browser's data, with the file contents by hash. */
interface Local extends SyncData {
  files: SyncedFile[];
  blobs: Map<string, Blob>;
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

async function sha256(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function collectLocal(): Promise<Local> {
  const [profile, rules, settings, metas] = await Promise.all([loadProfile(), loadRules(), loadSettings(), listAllFiles()]);
  const files: SyncedFile[] = [];
  const blobs = new Map<string, Blob>();
  for (const meta of metas) {
    const blob = (await getResume(meta.id))?.blob;
    // Drive's one-request upload stops at 5 MB; a bigger file stays on this computer
    // (never listed, so other browsers neither get it nor delete their own copy).
    if (!blob || blob.size > MAX_FILE_BYTES) continue;
    const sha = await sha256(await blob.arrayBuffer());
    files.push({ ...meta, sha });
    blobs.set(sha, blob);
  }
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { profile, rules, settings: sharedSettings(settings), files, blobs };
}

function syncData({ profile, rules, settings, files }: SyncData): SyncData {
  return { profile, rules, settings, files };
}

/** Stable JSON (sorted keys), so the same data always hashes the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function hashData(data: SyncData): Promise<string> {
  return sha256(new TextEncoder().encode(stable(syncData(data))));
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
  const files = Array.isArray(data.files) ? data.files.filter(validFile).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : undefined;
  return { profile: normalizeProfile(data.profile), rules, settings: sharedSettings(normalizeSettings(settings)), files, updatedAt: Number(data.updatedAt) || 0 };
}

function validFile(f: unknown): f is SyncedFile {
  const r = f as Partial<SyncedFile> | null;
  return !!r && typeof r.id === 'string' && !!r.id && typeof r.sha === 'string' && /^[0-9a-f]{64}$/.test(r.sha) && typeof r.fileName === 'string' && typeof r.mimeType === 'string';
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

/** Drive's stored files by hash, read once per sync. */
function blobIndex(hint: string | undefined): () => Promise<Map<string, string>> {
  let index: Promise<Map<string, string>> | undefined;
  return () => (index ??= listFiles(BLOB_PREFIX, hint).then((list) => new Map(list.map((f) => [f.name.slice(BLOB_PREFIX.length), f.id]))));
}

/** Upload the files Drive lacks, then the sync file, then remove files nothing lists any more. */
async function upload(state: SyncState, fileId: string | null, local: Local): Promise<string> {
  const hint = state.email || undefined;
  const stored = await blobIndex(hint)();
  for (const [sha, blob] of local.blobs) {
    if (!stored.has(sha)) await writeFile(BLOB_PREFIX + sha, blob, null, hint, blob.type || 'application/octet-stream');
  }
  const file: SyncFile = { format: 'getmeajobpls-sync', version: 1, updatedAt: Date.now(), ...syncData(local) };
  const id = await writeFile(FILE_NAME, JSON.stringify(file), fileId, hint);
  for (const [sha, blobId] of stored) {
    if (!local.blobs.has(sha)) await deleteFile(blobId, hint).catch(() => {});
  }
  return id;
}

/**
 * Bring Drive's files into this browser. `all`: match Drive (a download), except that files
 * added here since the last sync stay. `new-only`: just take files added in Drive since the
 * last sync (before an upload, so it doesn't drop them). Returns whether anything changed.
 */
async function applyFiles(remote: SyncedFile[], local: Local, known: Set<string>, blobs: () => Promise<Map<string, string>>, hint: string | undefined, mode: 'all' | 'new-only'): Promise<boolean> {
  const localById = new Map(local.files.map((f) => [f.id, f]));
  const wanted = remote.filter((f) => {
    const mine = localById.get(f.id);
    if (mode === 'new-only') return !mine && !known.has(f.id);
    return !mine || stable(mine) !== stable(f);
  });
  // Fetch every missing file before changing anything, so a failed download changes nothing.
  const fetched = new Map<string, Blob>();
  for (const f of wanted) {
    if (local.blobs.has(f.sha) || fetched.has(f.sha)) continue;
    const id = (await blobs()).get(f.sha);
    if (!id) throw new Error('A resume is still uploading from another browser; try syncing again in a minute.');
    const blob = await readBlob(id, hint);
    fetched.set(f.sha, blob.type ? blob : new Blob([blob], { type: f.mimeType }));
  }
  for (const { sha, ...meta } of wanted) {
    await putResume({ ...meta, blob: local.blobs.get(sha) ?? fetched.get(sha)! });
  }
  let removed = false;
  if (mode === 'all') {
    const remoteIds = new Set(remote.map((f) => f.id));
    for (const f of local.files) {
      if (!remoteIds.has(f.id) && known.has(f.id)) {
        await deleteResume(f.id);
        removed = true;
      }
    }
  }
  return wanted.length > 0 || removed;
}

/** Set after writing downloaded data, so the options page knows to redraw. */
export const APPLIED_KEY = 'cloudSyncApplied';

async function applyLocal(data: SyncData, local: Local, known: Set<string>, blobs: () => Promise<Map<string, string>>, hint: string | undefined): Promise<void> {
  if (data.files) await applyFiles(data.files, local, known, blobs, hint, 'all');
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
      const hint = state.email || undefined;
      const blobs = blobIndex(hint);
      const known = new Set(state.syncedFileIds);
      let local = await collectLocal();
      const remote = await readRemote(state);
      let localHash = await hashData(local);
      const direction = decide({
        localHash,
        remoteHash: remote.hash,
        syncedHash: state.syncedHash,
        localChangedAt: state.localChangedAt,
        remoteUpdatedAt: remote.data?.updatedAt ?? 0,
      });
      let fileId = remote.fileId;
      if (direction === 'upload') {
        // Files added in another browser since the last sync are never lost to an upload.
        if (remote.data?.files && (await applyFiles(remote.data.files, local, known, blobs, hint, 'new-only'))) {
          local = await collectLocal();
          localHash = await hashData(local);
          await browser.storage.local.set({ [APPLIED_KEY]: Date.now() });
        }
        fileId = await upload(state, fileId, local);
      }
      if (direction === 'download') await applyLocal(remote.data!, local, known, blobs, hint);
      const syncedFiles = direction === 'download' ? (remote.data!.files ?? local.files) : local.files;
      await patchSyncState({ fileId, syncedHash: direction === 'download' ? remote.hash : localHash, syncedFileIds: syncedFiles.map((f) => f.id), lastSyncAt: Date.now(), error: null, needsSignIn: false });
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
    const state = { ...defaultSyncState(), email };
    const blobs = blobIndex(email);
    const none = new Set<string>();
    let local = await collectLocal();
    const remote = await readRemote(state);
    let fileId = remote.fileId;
    let hash: string;
    // Either way, resumes from both sides are kept: nothing has been synced yet, so a file on
    // only one side is new there, not deleted on the other.
    if (keep === 'remote' && remote.data) {
      await applyLocal(remote.data, local, none, blobs, email);
      local = await collectLocal();
      hash = remote.hash!;
      if ((await hashData(local)) !== hash) {
        fileId = await upload(state, fileId, local);
        hash = await hashData(local);
      }
    } else {
      if (remote.data?.files && (await applyFiles(remote.data.files, local, none, blobs, email, 'new-only'))) local = await collectLocal();
      fileId = await upload(state, fileId, local);
      hash = await hashData(local);
    }
    await patchSyncState({ enabled: true, email, fileId, syncedHash: hash, syncedFileIds: local.files.map((f) => f.id), localChangedAt: Date.now(), lastSyncAt: Date.now(), error: null, needsSignIn: false });
  });
}

/** Turn sync off; `deleteRemote` also removes the copy in Drive. Local data stays. */
export function disableSync(deleteRemote: boolean): Promise<void> {
  return exclusive(async () => {
    const state = await loadSyncState();
    if (deleteRemote) {
      const hint = state.email || undefined;
      for (const f of await listFiles(BLOB_PREFIX, hint)) await deleteFile(f.id, hint);
      const file = state.fileId ? { id: state.fileId } : await findFile(FILE_NAME, hint);
      if (file) await deleteFile(file.id, hint);
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
