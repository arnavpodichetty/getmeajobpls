// Resume tailoring through the local helper (scripts/tailor), which runs your
// own Claude Code. Runs in the background worker: it sends the picked resume
// and the posting's text to the helper and saves the tailored PDF as a new
// resume, so a normal fill uploads it.
import { browser } from 'wxt/browser';
import { uid } from './defaults';
import { pageContext } from './orchestrate';
import { findPosting } from './posting';
import { base64ToBlob, blobToBase64, deleteResume, getResume, listResumes, putResume } from './resumeDb';
import type { PageSource, ProfileDraft } from './profileImport';
import { loadProfile } from './storage';
import { findTailored, jobLabel } from './tailorMatch';

export { jobLabel };

export const HOST_NAME = 'com.getmeajobpls.tailor';
/** Tailored copies kept; older ones are deleted. */
const KEEP_TAILORED = 10;

export interface TailorResult {
  resumeId: string;
  name: string;
  changes: string[];
  warnings: string[];
  /** True when an earlier tailored copy for this job was used instead of asking Claude again. */
  reused: boolean;
}

interface HostReply {
  ok: boolean;
  error?: string;
  draft?: ProfileDraft;
  dropped?: string[];
  base64?: string;
  changes?: string[];
  warnings?: string[];
  claude?: string | null;
  claudeVersion?: string;
}

export const PERMISSION = { permissions: ['nativeMessaging' as const] };

/** Storage key: reopen Options at this section after the restart that follows granting the permission. */
export const REOPEN_KEY = 'reopenOptionsAt';

export function nativeMessagingReady(): boolean {
  return typeof browser.runtime.sendNativeMessage === 'function';
}

async function sendHost(msg: object): Promise<HostReply> {
  if (!(await browser.permissions.contains(PERMISSION))) {
    throw new Error('Resume tailoring is not set up. Turn it on in Options → Resume tailoring.');
  }
  // Chrome only adds sendNativeMessage to contexts started after the permission was granted.
  if (!nativeMessagingReady()) {
    throw new Error('Chrome needs the extension restarted once after turning on tailoring: open chrome://extensions, click ↻ on getmeajobpls, then refresh this page.');
  }
  try {
    return (await browser.runtime.sendNativeMessage(HOST_NAME, msg)) as HostReply;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/not found|forbidden|not allowed/i.test(text)) {
      throw new Error(`The tailoring helper isn't installed for this extension. Run: npm run tailor-install -- ${browser.runtime.id}`);
    }
    throw new Error(`Tailoring helper failed: ${text}`);
  }
}

/** Check the helper is installed and can find Claude Code. */
export async function pingHelper(): Promise<{ claude: string | null; claudeVersion: string }> {
  const reply = await sendHost({ type: 'ping' });
  if (!reply.ok) throw new Error(reply.error ?? 'The helper did not answer.');
  return { claude: reply.claude ?? null, claudeVersion: reply.claudeVersion ?? '' };
}

/** Read a resume into profile fields (Options → Fill from resume). Every value is checked against the resume by the helper. */
export async function readResumeForProfile(resumeId: string): Promise<{ draft: ProfileDraft; dropped: string[] }> {
  const rec = await getResume(resumeId);
  if (!rec) throw new Error('That resume is no longer in your library.');
  const reply = await sendHost({ type: 'profile', resume: { name: rec.name, base64: await blobToBase64(rec.blob) } });
  if (!reply.ok || !reply.draft) throw new Error(reply.error ?? 'Claude could not read this resume.');
  return { draft: reply.draft, dropped: reply.dropped ?? [] };
}

/** Read a profile page or pasted text into profile fields; entries count only when their quoted text is really there. */
export async function readTextForProfile(source: PageSource & { kind: 'page' | 'paste' }): Promise<{ draft: ProfileDraft; dropped: string[] }> {
  const reply = await sendHost({ type: 'profileText', source });
  if (!reply.ok || !reply.draft) throw new Error(reply.error ?? 'Claude could not read this text.');
  return { draft: reply.draft, dropped: reply.dropped ?? [] };
}

export async function tailorForTab(tabId: number, resumeId: string): Promise<TailorResult> {
  const base = await getResume(resumeId);
  if (!base) throw new Error('Pick a resume to tailor first.');
  if (base.tailoredFrom) throw new Error('Pick one of your own resumes, not a tailored copy.');
  const tab = await browser.tabs.get(tabId);
  const label = jobLabel(tab.title ?? '');
  const url = tab.url ?? '';

  // One tailored copy per job and resume: delete it under Resumes to tailor again.
  const existing = findTailored(await listResumes(), base.id, url, tab.title ? label : '');
  if (existing) {
    const notes = existing.tailorNotes ?? { changes: [], warnings: [] };
    return { resumeId: existing.id, name: existing.tailoredFor ?? label, ...notes, reused: true };
  }

  const page = await pageContext(tabId);
  // Application pages often leave the description out (Workday's steps, Lever's /apply): put it first.
  const posting = await findPosting(tabId, url);
  const text = posting ? `${posting.text}\n\n${page.text}` : page.text;
  const name = posting?.title ? jobLabel(posting.title) : label;
  // Your profile is extra source material: Claude may use its Experience and
  // Projects descriptions and skills, and swap in entries that aren't on the resume.
  const p = await loadProfile();
  const profile = {
    experience: p.experience,
    projects: p.projects,
    skills: [...new Set([...p.skills, ...p.skillSets.flatMap((s) => s.skills), ...p.tailoringSkills])],
  };

  const reply = await sendHost({
    type: 'tailor',
    resume: { name: base.name, base64: await blobToBase64(base.blob) },
    page: { title: posting?.title || tab.title || page.title, url, text },
    profile,
  });
  if (!reply.ok || !reply.base64) throw new Error(reply.error ?? 'Tailoring failed.');

  const blob = base64ToBlob(reply.base64, 'application/pdf');
  const notes = { changes: reply.changes ?? [], warnings: reply.warnings ?? [] };
  const id = uid();
  await putResume({
    id,
    name: `${base.name} · tailored for ${name}`,
    tags: [],
    skills: base.skills,
    // Same file name as the original: employers see this name.
    fileName: base.fileName,
    mimeType: 'application/pdf',
    size: blob.size,
    uploadedAt: Date.now(),
    isDefault: false,
    tailoredFrom: base.id,
    tailoredFor: name,
    tailoredUrl: url,
    tailorNotes: notes,
    blob,
  });
  const tailored = (await listResumes()).filter((r) => r.tailoredFrom).sort((a, b) => b.uploadedAt - a.uploadedAt);
  for (const old of tailored.slice(KEEP_TAILORED)) await deleteResume(old.id);
  return { resumeId: id, name, ...notes, reused: false };
}
