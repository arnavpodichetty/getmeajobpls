// Resume library in IndexedDB. This database belongs to the extension origin,
// so only extension pages and the background worker can open it. Content
// scripts run in the page's origin and must ask the background for files
// (see messages.ts → 'getResumeFile').
import type { ResumeMeta, ResumeRecord } from './types';

const DB_NAME = 'getmeajobpls';
const DB_VERSION = 1;
const STORE = 'resumes';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function listResumes(): Promise<ResumeMeta[]> {
  const all = (await promisify((await tx('readonly')).getAll())) as ResumeRecord[];
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => a.uploadedAt - b.uploadedAt);
}

export async function getResume(id: string): Promise<ResumeRecord | undefined> {
  return (await promisify((await tx('readonly')).get(id))) as ResumeRecord | undefined;
}

export async function putResume(record: ResumeRecord): Promise<void> {
  await promisify((await tx('readwrite')).put(record));
}

/** Patch metadata fields, keeping the stored blob. */
export async function updateResumeMeta(id: string, patch: Partial<Omit<ResumeMeta, 'id'>>): Promise<void> {
  const existing = await getResume(id);
  if (!existing) return;
  await putResume({ ...existing, ...patch, id, blob: existing.blob });
}

export async function deleteResume(id: string): Promise<void> {
  await promisify((await tx('readwrite')).delete(id));
}

/** Make exactly one resume the default. */
export async function setDefaultResume(id: string): Promise<void> {
  for (const meta of await listResumes()) {
    const isDefault = meta.id === id;
    if (meta.isDefault !== isDefault) await updateResumeMeta(meta.id, { isDefault });
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
