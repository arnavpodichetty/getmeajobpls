// The Firefox build (Firefox, Zen) shares every line of the Chrome code; these pin down the
// few places where the two browsers differ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { displayVersion, FIREFOX_ID } from '../wxt.config';
import { setNativeValue } from '../src/lib/engine/dom';

type ManifestFn = (env: { browser: string }) => Record<string, unknown>;
const manifestFor = (browser: string) => (config.manifest as unknown as ManifestFn)({ browser });

describe('manifest per browser', () => {
  it('leaves the Chrome manifest without Firefox settings', () => {
    const chrome = manifestFor('chrome');
    expect(chrome.browser_specific_settings).toBeUndefined();
    expect(chrome.host_permissions).toEqual(['<all_urls>']);
    expect(chrome.optional_permissions).toEqual(['nativeMessaging']);
  });

  it('gives Firefox a fixed add-on id and declares no data collection', () => {
    const gecko = (manifestFor('firefox').browser_specific_settings as { gecko: Record<string, unknown> }).gecko;
    expect(gecko.id).toBe(FIREFOX_ID);
    expect(gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  it('registers the tailoring helper for the same Firefox id', () => {
    const installer = readFileSync(resolve(__dirname, '../scripts/tailor/install.mjs'), 'utf8');
    expect(installer).toContain(`export const FIREFOX_ID = '${FIREFOX_ID}';`);
  });
});

describe('React inputs', () => {
  it('resets React\'s value tracker where Chrome shows it (on the element)', () => {
    const input = document.createElement('input');
    const seen: string[] = [];
    Object.assign(input, { _valueTracker: { setValue: (v: string) => seen.push(v) } });
    setNativeValue(input, 'Ada');
    expect([input.value, seen]).toEqual(['Ada', ['']]);
  });

  it('resets it where Firefox hides it from content scripts (wrappedJSObject)', () => {
    const input = document.createElement('input');
    const seen: string[] = [];
    Object.assign(input, { wrappedJSObject: { _valueTracker: { setValue: (v: string) => seen.push(v) } } });
    setNativeValue(input, 'Ada');
    expect([input.value, seen]).toEqual(['Ada', ['']]);
  });
});

describe('version shown in the browser', () => {
  it('drops a trailing .0 and keeps the rest', () => {
    expect(['1.5.0', '1.5.1', '2.0.0', '1.10.0'].map(displayVersion)).toEqual(['1.5', '1.5.1', '2.0', '1.10']);
  });

  it('is the same for Chrome and Firefox', () => {
    expect(manifestFor('chrome').version).toBe(manifestFor('firefox').version);
  });
});

describe('sources zip for addons.mozilla.org', () => {
  it('lists only what rebuilding needs, never your profile, resumes or captures', () => {
    const include = (config.zip as { includeSources?: string[] }).includeSources ?? [];
    expect(include.length).toBeGreaterThan(0); // WXT's default packs the whole folder
    for (const pattern of include) expect(pattern).toMatch(/^(?:src|public)\/\*\*$|^(?:package(?:-lock)?\.json|tsconfig\.json|wxt\.config\.ts|README\.md)$/);
  });
});
