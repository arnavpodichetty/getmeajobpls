// Cloud sync: which way data moves, and a round trip between two browsers through a fake Drive.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { ResumeRecord } from '../src/lib/types';

// In-memory Drive app data folder shared by both "browsers".
const drive = new Map<string, string | Blob>();
vi.mock('../src/lib/drive', () => ({
  SignInRequired: class extends Error {},
  accountEmail: async () => 'ada@example.com',
  findFile: async (name: string) => (drive.has(name) ? { id: name, modifiedTime: '' } : null),
  readFile: async (id: string) => (drive.get(id) as string) ?? '',
  readBlob: async (id: string) => drive.get(id) as Blob,
  listFiles: async (prefix: string) => [...drive.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ id: k, name: k })),
  writeFile: async (name: string, content: string | Blob) => (drive.set(name, content), name),
  deleteFile: async (id: string) => void drive.delete(id),
  revokeToken: async () => {},
}));

// Each browser's resume store (IndexedDB in the extension; fake-indexeddb can't hold Blobs in Node).
let store = new Map<string, ResumeRecord>();
vi.mock('../src/lib/resumeDb', () => ({
  FILES_CHANGED_KEY: 'resumeFilesChangedAt',
  listAllFiles: async () => [...store.values()].map(({ blob: _b, ...meta }) => meta),
  getResume: async (id: string) => store.get(id),
  putResume: async (r: ResumeRecord) => void store.set(r.id, r),
  deleteResume: async (id: string) => void store.delete(id),
}));

const { BLOB_PREFIX, decide, disableSync, enableSync, FILE_NAME, inspectRemote, loadSyncState, syncNow } = await import('../src/lib/cloudSync');
const { loadProfile, loadSettings, saveProfile, saveSettings } = await import('../src/lib/storage');

/** Each browser's storage.local, swapped in and out of the fake browser. */
type Snapshot = { local: Record<string, unknown>; files: Map<string, ResumeRecord> };
async function snapshot(): Promise<Snapshot> {
  return { local: await fakeBrowser.storage.local.get(null), files: new Map(store) };
}
async function restore(snap: Snapshot | Record<string, never>): Promise<void> {
  await fakeBrowser.storage.local.clear();
  if ('local' in snap) await fakeBrowser.storage.local.set(snap.local);
  store = 'files' in snap ? new Map(snap.files) : new Map();
}
function addResume(id: string, text: string): void {
  store.set(id, { id, name: id, tags: [], skills: [], fileName: `Ada_Lovelace_${id}.pdf`, mimeType: 'application/pdf', size: text.length, uploadedAt: 1, isDefault: false, blob: new Blob([text], { type: 'application/pdf' }) });
}
async function fileText(id: string): Promise<string | undefined> {
  return store.get(id)?.blob.text();
}
const blobCount = () => [...drive.keys()].filter((k) => k.startsWith(BLOB_PREFIX)).length;
async function rename(first: string): Promise<void> {
  const p = await loadProfile();
  p.personal.firstName = first;
  await saveProfile(p);
}

describe('decide', () => {
  const base = { localHash: 'L', remoteHash: 'R', syncedHash: 'S', localChangedAt: 100, remoteUpdatedAt: 200 };
  it('uploads when Drive has nothing', () => expect(decide({ ...base, remoteHash: null })).toBe('upload'));
  it('does nothing when both match', () => expect(decide({ ...base, remoteHash: 'L' })).toBe('none'));
  it('downloads when only Drive changed', () => expect(decide({ ...base, localHash: 'S' })).toBe('download'));
  it('uploads when only this browser changed', () => expect(decide({ ...base, remoteHash: 'S' })).toBe('upload'));
  it('lets the newest win when both changed', () => {
    expect(decide(base)).toBe('download');
    expect(decide({ ...base, localChangedAt: 300 })).toBe('upload');
  });
});

describe('two browsers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    drive.clear();
    store = new Map();
  });

  it('carries edits both ways and keeps per-computer settings local', async () => {
    // Browser A turns sync on first; Drive is empty, so A's copy goes up.
    await rename('Ada');
    await saveSettings({ ...(await loadSettings()), tailorEnabled: true, highlightFields: false });
    expect((await inspectRemote()).remoteUpdatedAt).toBeNull();
    await enableSync('ada@example.com', 'local');
    expect(JSON.parse(drive.get(FILE_NAME) as string).profile.personal.firstName).toBe('Ada');
    const a = await snapshot();

    // Browser B has its own profile and picks the Drive copy.
    await restore({});
    await rename('Someone else');
    expect((await inspectRemote()).same).toBe(false);
    await enableSync('ada@example.com', 'remote');
    expect((await loadProfile()).personal.firstName).toBe('Ada');
    expect((await loadSettings()).highlightFields).toBe(false);
    expect((await loadSettings()).tailorEnabled).toBe(false); // needs the helper on each computer

    // B edits; its sync uploads.
    await rename('Ada B');
    expect(await syncNow()).toEqual({ direction: 'upload' });
    const b = await snapshot();

    // A syncs and gets B's edit, keeping its own tailoring setting.
    await restore(a);
    expect(await syncNow()).toEqual({ direction: 'download' });
    expect((await loadProfile()).personal.firstName).toBe('Ada B');
    expect((await loadSettings()).tailorEnabled).toBe(true);
    expect(await syncNow()).toEqual({ direction: 'none' });

    // Turning off on B with delete removes the Drive copy and B's sync state, not B's data.
    await restore(b);
    await disableSync(true);
    expect(drive.has(FILE_NAME)).toBe(false);
    expect((await loadSyncState()).enabled).toBe(false);
    expect((await loadProfile()).personal.firstName).toBe('Ada B');
    expect(await syncNow()).toEqual({ skipped: true });
  });

  it('ignores a Drive file it does not recognise', async () => {
    drive.set(FILE_NAME, 'not json');
    await rename('Ada');
    await enableSync('ada@example.com', 'remote');
    expect((await loadProfile()).personal.firstName).toBe('Ada');
    expect(JSON.parse(drive.get(FILE_NAME) as string).format).toBe('getmeajobpls-sync');
  });

  it('carries resume files to the other browser, including deletions', async () => {
    addResume('r1', '%PDF-1.4 data');
    addResume('transcript', '%PDF-1.4 grades');
    await enableSync('ada@example.com', 'local');
    expect(blobCount()).toBe(2);
    const a = await snapshot();

    // B starts empty and takes the Drive copy: both files arrive with the same content.
    await restore({});
    await enableSync('ada@example.com', 'remote');
    expect(await fileText('r1')).toBe('%PDF-1.4 data');
    expect(await fileText('transcript')).toBe('%PDF-1.4 grades');
    expect(store.get('r1')?.fileName).toBe('Ada_Lovelace_r1.pdf');

    // B removes r1 and adds r2; Drive drops r1's content.
    store.delete('r1');
    addResume('r2', '%PDF-1.4 swe');
    expect(await syncNow()).toEqual({ direction: 'upload' });
    expect(blobCount()).toBe(2);

    // A gets both changes.
    await restore(a);
    expect(await syncNow()).toEqual({ direction: 'download' });
    expect([...store.keys()].sort()).toEqual(['r2', 'transcript']);
    expect(await fileText('r2')).toBe('%PDF-1.4 swe');
    expect(await syncNow()).toEqual({ direction: 'none' });

    // A file over Drive's 5 MB limit stays local and doesn't stop the rest syncing.
    addResume('big', 'x'.repeat(5 * 1024 * 1024 + 1));
    await rename('Ada big');
    expect(await syncNow()).toEqual({ direction: 'upload' });
    expect(JSON.parse(drive.get(FILE_NAME) as string).files.map((f: { id: string }) => f.id)).not.toContain('big');
    expect(store.has('big')).toBe(true);

    // Turning off with delete clears the files from Drive too.
    await disableSync(true);
    expect(drive.size).toBe(0);
  });

  it('never drops a resume added in one browser when the other wins a conflict', async () => {
    await rename('Ada');
    await enableSync('ada@example.com', 'local');
    const a0 = await snapshot();
    await restore({});
    await enableSync('ada@example.com', 'remote');
    const b0 = await snapshot();

    // A adds a resume but hasn't synced; B edits its profile later and syncs first.
    await restore(a0);
    addResume('r3', '%PDF-1.4 new');
    // What the background watcher records for the edit: it happened before B's.
    await fakeBrowser.storage.local.set({ cloudSync: { ...(await loadSyncState()), localChangedAt: Date.now() - 60_000 } });
    const a1 = await snapshot();
    await restore(b0);
    await rename('Ada B');
    await syncNow();
    const b1 = await snapshot();

    // A takes B's newer profile and keeps r3, then sends r3 up; B receives it.
    await restore(a1);
    await syncNow();
    expect((await loadProfile()).personal.firstName).toBe('Ada B');
    expect(await fileText('r3')).toBe('%PDF-1.4 new');
    await syncNow();
    await restore(b1);
    await syncNow();
    expect(await fileText('r3')).toBe('%PDF-1.4 new');
    expect((await loadProfile()).personal.firstName).toBe('Ada B');
  });

  it('keeps local files when Drive holds a sync file from before files were synced', async () => {
    addResume('r1', '%PDF-1.4 data');
    await rename('Ada');
    const old = await snapshot();
    await restore({});
    await rename('Ada old');
    const p = await loadProfile();
    drive.set(FILE_NAME, JSON.stringify({ format: 'getmeajobpls-sync', version: 1, updatedAt: 5, profile: p, rules: [], settings: {} }));
    await restore(old);
    await enableSync('ada@example.com', 'remote');
    expect((await loadProfile()).personal.firstName).toBe('Ada old');
    expect(await fileText('r1')).toBe('%PDF-1.4 data');
    expect(JSON.parse(drive.get(FILE_NAME) as string).files.map((f: { id: string }) => f.id)).toEqual(['r1']);
  });
});
