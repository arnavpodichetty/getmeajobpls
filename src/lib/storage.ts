// JSON data (profile, rules, settings) in chrome.storage.local, which content
// scripts can read directly. Resume files live in IndexedDB (see resumeDb.ts).
import { browser } from 'wxt/browser';
import { normalizeProfile, normalizeSettings } from './defaults';
import type { Profile, ResumeRule, Settings } from './types';

const KEYS = { profile: 'profile', rules: 'resumeRules', settings: 'settings' } as const;

async function get<T>(key: string): Promise<T | undefined> {
  const res = await browser.storage.local.get(key);
  return res[key] as T | undefined;
}

export async function loadProfile(): Promise<Profile> {
  return normalizeProfile(await get(KEYS.profile));
}

export async function saveProfile(profile: Profile): Promise<void> {
  await browser.storage.local.set({ [KEYS.profile]: profile });
}

export async function loadRules(): Promise<ResumeRule[]> {
  return (await get<ResumeRule[]>(KEYS.rules)) ?? [];
}

export async function saveRules(rules: ResumeRule[]): Promise<void> {
  await browser.storage.local.set({ [KEYS.rules]: rules });
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await get(KEYS.settings));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEYS.settings]: settings });
}
