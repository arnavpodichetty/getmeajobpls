// Restoring a backup file through the options page's Import button: profile,
// resume rules and resume PDFs all come back.
// BACKUP_FILE=<path> npx vitest run tests/backupImport.test.ts checks a real export instead.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { backupSection } from '../src/entrypoints/options/backup';
import { base64ToBlob, getResume, listResumes } from '../src/lib/resumeDb';
import { loadProfile, loadRules } from '../src/lib/storage';
import { testProfile } from './helpers/fixture';

function fictionalBackup(): string {
  return JSON.stringify({
    format: 'getmeajobpls-backup',
    version: 1,
    exportedAt: '2026-10-16T00:00:00.000Z',
    profile: testProfile(),
    rules: [{ id: 'rule-r1', keywords: ['data', 'analyst'], resumeId: 'r1' }],
    resumes: [{ id: 'r1', name: 'Data', tags: ['Data'], skills: ['SQL'], fileName: 'Ada_Lovelace_Resume.pdf', mimeType: 'application/pdf', size: 13, uploadedAt: 0, isDefault: true, base64: btoa('%PDF-1.4 test') }],
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '<div id="toast"></div>';
  vi.stubGlobal('confirm', () => true);
});

describe('backup import', () => {
  it('restores the profile, resume rules and resume files', async () => {
    const text = process.env.BACKUP_FILE ? readFileSync(process.env.BACKUP_FILE, 'utf8') : fictionalBackup();
    const backup = JSON.parse(text);
    let imported = false;
    const section = backupSection(async () => { imported = true; });
    const input = section.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File([text], 'backup.json', { type: 'application/json' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(imported).toBe(true), { timeout: 10_000 });
    expect(document.querySelector('#toast')!.textContent).toMatch(/import/i);

    const profile = await loadProfile();
    expect(profile.personal.email).toBe(backup.profile.personal.email);
    expect(profile.education.map((e) => e.school)).toEqual(backup.profile.education.map((e: { school: string }) => e.school));
    expect(profile.experience).toHaveLength(backup.profile.experience.length);
    expect((await loadRules()).map((r) => r.resumeId)).toEqual(backup.rules.map((r: { resumeId: string }) => r.resumeId));
    const resumes = await listResumes();
    expect(resumes.map((r) => r.id).sort()).toEqual(backup.resumes.map((r: { id: string }) => r.id).sort());
    for (const r of backup.resumes) {
      // fake-indexeddb can't clone Blobs in Node, so check the decoded PDF and that a file was stored.
      expect(base64ToBlob(r.base64, r.mimeType).size).toBe(r.size);
      const rec = await getResume(r.id);
      expect(rec?.blob).toBeTruthy();
      expect(rec?.fileName).toBe(r.fileName);
    }
  });
});
