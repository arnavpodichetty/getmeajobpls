// Cloud sync: which way data moves, and a round trip between two browsers through a fake Drive.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// In-memory Drive app data folder shared by both "browsers".
const drive = new Map<string, string>();
vi.mock('../src/lib/drive', () => ({
  SignInRequired: class extends Error {},
  accountEmail: async () => 'ada@example.com',
  findFile: async (name: string) => (drive.has(name) ? { id: name, modifiedTime: '' } : null),
  readFile: async (id: string) => drive.get(id) ?? '',
  writeFile: async (name: string, content: string) => (drive.set(name, content), name),
  deleteFile: async (id: string) => void drive.delete(id),
  revokeToken: async () => {},
}));

const { decide, disableSync, enableSync, FILE_NAME, inspectRemote, loadSyncState, syncNow } = await import('../src/lib/cloudSync');
const { loadProfile, loadSettings, saveProfile, saveSettings } = await import('../src/lib/storage');

/** Each browser's storage.local, swapped in and out of the fake browser. */
type Snapshot = Record<string, unknown>;
async function snapshot(): Promise<Snapshot> {
  return fakeBrowser.storage.local.get(null);
}
async function restore(snap: Snapshot): Promise<void> {
  await fakeBrowser.storage.local.clear();
  await fakeBrowser.storage.local.set(snap);
}
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
  });

  it('carries edits both ways and keeps per-computer settings local', async () => {
    // Browser A turns sync on first; Drive is empty, so A's copy goes up.
    await rename('Ada');
    await saveSettings({ ...(await loadSettings()), tailorEnabled: true, highlightFields: false });
    expect((await inspectRemote()).remoteUpdatedAt).toBeNull();
    await enableSync('ada@example.com', 'local');
    expect(JSON.parse(drive.get(FILE_NAME)!).profile.personal.firstName).toBe('Ada');
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
    expect(JSON.parse(drive.get(FILE_NAME)!).format).toBe('getmeajobpls-sync');
  });
});
