import { h } from '../../lib/dom';
import { normalizeProfile, normalizeSettings } from '../../lib/defaults';
import { base64ToBlob, blobToBase64, getResume, listResumes, putResume } from '../../lib/resumeDb';
import { loadProfile, loadRules, loadSettings, saveProfile, saveRules, saveSettings } from '../../lib/storage';
import type { ResumeMeta, ResumeRule, Settings } from '../../lib/types';
import { showToast } from './toast';

const FORMAT = 'getmeajobpls-backup';

interface Backup {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  profile: unknown;
  settings?: Settings;
  rules?: ResumeRule[];
  resumes?: (ResumeMeta & { base64: string })[];
}

async function exportBackup(includeFiles: boolean): Promise<void> {
  const backup: Backup = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: await loadProfile(),
    settings: await loadSettings(),
    rules: await loadRules(),
  };
  if (includeFiles) {
    backup.resumes = [];
    for (const meta of await listResumes()) {
      const rec = await getResume(meta.id);
      if (rec) backup.resumes.push({ ...meta, base64: await blobToBase64(rec.blob) });
    }
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: `getmeajobpls-${backup.exportedAt.slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function importBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text());
  // Accept either a full backup or a bare profile object.
  const isBackup = data?.format === FORMAT;
  const profileData = isBackup ? data.profile : data;
  if (!profileData || typeof profileData !== 'object' || !('personal' in profileData)) {
    throw new Error('Not a getmeajobpls backup or profile JSON');
  }
  const fileCount = isBackup ? (data.resumes?.length ?? 0) : 0;
  const msg =
    'Replace your current profile' +
    (isBackup ? ', settings and resume rules' : '') +
    ' with this file?' +
    (fileCount ? ` ${fileCount} resume file(s) will be added (same id = replaced).` : '');
  if (!confirm(msg)) return;

  await saveProfile(normalizeProfile(profileData));
  if (isBackup) {
    if (data.settings) {
      await saveSettings(normalizeSettings(data.settings));
    }
    if (Array.isArray(data.rules)) await saveRules(data.rules);
    for (const r of (data.resumes ?? []) as Backup['resumes'] & {}) {
      const { base64, ...meta } = r;
      await putResume({ ...meta, blob: base64ToBlob(base64, meta.mimeType || 'application/pdf') });
    }
  }
  showToast('Imported');
}

export function backupSection(onImported: () => Promise<void>): HTMLElement {
  const includeFiles = h('input', { type: 'checkbox' });
  const importInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onChange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        await importBackup(file);
        await onImported();
      } catch (err) {
        showToast(`Import failed: ${err instanceof Error ? err.message : err}`, true);
      }
    },
  });

  return h(
    'section',
    { id: 'backup' },
    h('h2', {}, 'Backup'),
    h('p', { class: 'intro' }, 'Export everything to a JSON file, or restore from one. Importing a bare profile JSON also works.'),
    h(
      'div',
      { class: 'row' },
      h('button', { onClick: () => exportBackup(includeFiles.checked) }, 'Export JSON'),
      h('label', { class: 'check inline' }, includeFiles, h('span', {}, 'Include resume PDFs')),
      h('button', { class: 'secondary', onClick: () => importInput.click() }, 'Import JSON…'),
      importInput,
    ),
  );
}
