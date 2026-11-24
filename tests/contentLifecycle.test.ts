import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import content from '../src/entrypoints/content';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  sendPanel: vi.fn(),
  show: vi.fn(),
  remove: vi.fn(),
  fill: vi.fn(),
  loadProfile: vi.fn(),
  looksLikeJobForm: vi.fn(() => false),
  panelFill: vi.fn(async () => {}),
  panelShown: false,
}));

vi.mock('../src/lib/engine/jobForm', () => ({ looksLikeJobForm: mocks.looksLikeJobForm }));

vi.mock('../src/lib/storage', () => ({ loadSettings: mocks.loadSettings, loadProfile: mocks.loadProfile }));
vi.mock('../src/lib/messages', () => ({ sendPanel: mocks.sendPanel, requestResumeFile: vi.fn() }));
vi.mock('../src/adapters', () => ({ detectAdapter: () => ({ id: 'workday', name: 'Workday', fill: mocks.fill }) }));
vi.mock('../src/lib/panel', () => ({
  FillPanel: class {
    constructor(onClose: () => void) { closePanel = onClose; }
    get shown() { return mocks.panelShown; }
    show = mocks.show;
    remove = mocks.remove;
    fillFromShortcut = mocks.panelFill;
  },
}));

let closePanel: () => void;

function startContent() {
  let invalid = false;
  const cleanup: (() => void)[] = [];
  const timers: number[] = [];
  const ctx = {
    get isInvalid() { return invalid; },
    onInvalidated: (callback: () => void) => { cleanup.push(callback); },
    setTimeout: (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => { if (!invalid) callback(); }, delay);
      timers.push(timer);
      return timer;
    },
    notifyInvalidated: vi.fn(() => {
      if (invalid) return;
      invalid = true;
      timers.forEach(clearTimeout);
      cleanup.forEach((callback) => callback());
    }),
  };
  content.main(ctx as unknown as ContentScriptContext);
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fakeBrowser.reset();
  document.body.innerHTML = '';
  mocks.panelShown = false;
  mocks.loadSettings.mockResolvedValue({ showOnPage: true });
  mocks.sendPanel.mockResolvedValue({ kind: 'state', isApplication: true });
  mocks.loadProfile.mockResolvedValue({ skillSets: [] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('content script reload lifecycle', () => {
  it('does not start when Chrome has already removed runtime', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(browser, 'runtime')!;
    try {
      Object.defineProperty(browser, 'runtime', { configurable: true, value: undefined });
      expect(() => startContent()).not.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.loadSettings).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(browser, 'runtime', descriptor);
    }
  });

  it('cleans up safely after Chrome removes runtime from an existing script', async () => {
    const ctx = startContent();
    const descriptor = Object.getOwnPropertyDescriptor(browser, 'runtime')!;
    try {
      Object.defineProperty(browser, 'runtime', { configurable: true, value: undefined });
      expect(() => ctx.notifyInvalidated()).not.toThrow();
      document.body.append(document.createElement('input'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.remove).toHaveBeenCalledOnce();
      expect(mocks.loadSettings).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(browser, 'runtime', descriptor);
    }
  });

  it('tolerates an event object that rejects cleanup after an extension reload', () => {
    const ctx = startContent();
    vi.spyOn(browser.runtime.onMessage, 'removeListener').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => ctx.notifyInvalidated()).not.toThrow();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('returns the fill report when the panel closes during a fill', async () => {
    mocks.loadSettings.mockResolvedValue({ showOnPage: true, watchForNewFields: true });
    const report = { ats: 'Workday', filled: 1, needsReview: 0, fields: [], notes: [] };
    let finish!: (value: unknown) => void;
    mocks.fill.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const ctx = startContent();
    const response = fakeBrowser.runtime.sendMessage({ type: 'fill', resumeId: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fill).toHaveBeenCalledOnce();
    closePanel();
    finish(report);
    expect(await response).toEqual(report);
    document.body.append(document.createElement('input'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.fill).toHaveBeenCalledOnce();
    ctx.notifyInvalidated();
  });

  it('runs a fill asked for during a pass on new fields once that pass ends', async () => {
    mocks.loadSettings.mockResolvedValue({ showOnPage: true, watchForNewFields: true });
    const report = (filled: number) => ({ ats: 'Workday', filled, needsReview: 0, fields: [], notes: [] });
    let finishPass!: (value: unknown) => void;
    mocks.fill
      .mockResolvedValueOnce(report(3))
      .mockImplementationOnce(() => new Promise((resolve) => { finishPass = resolve; }))
      .mockResolvedValueOnce(report(5));
    const ctx = startContent();
    expect(await fakeBrowser.runtime.sendMessage({ type: 'fill', resumeId: null })).toEqual(report(3));
    // The page changes: after a quiet moment the new fields are filled.
    document.body.append(document.createElement('input'));
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.fill).toHaveBeenCalledTimes(2);
    expect(mocks.fill.mock.calls[1][0].incremental).toBe(true);
    // Fill page clicked meanwhile: it waits for that pass instead of saying a fill is running.
    const response = fakeBrowser.runtime.sendMessage({ type: 'fill', resumeId: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fill).toHaveBeenCalledTimes(2);
    finishPass(report(0));
    expect(await response).toEqual(report(5));
    expect(mocks.fill).toHaveBeenCalledTimes(3);
    expect(mocks.fill.mock.calls[2][0].incremental).toBeUndefined();
    ctx.notifyInvalidated();
  });

  it('answers a failed request in its own shape, so the frame is skipped rather than mistaken for a form', async () => {
    const ctx = startContent();
    mocks.looksLikeJobForm.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(await fakeBrowser.runtime.sendMessage({ type: 'detect' })).toMatchObject({ atsId: 'workday', atsName: 'Workday', fieldCount: 0, jobForm: false });
    // Not a fill report, which "Save my answers" would have stored as a blank answer.
    mocks.loadProfile.mockRejectedValueOnce(new Error('boom'));
    expect(await fakeBrowser.runtime.sendMessage({ type: 'collectAnswers' })).toEqual([]);
    // A fill still says what went wrong.
    mocks.fill.mockRejectedValueOnce(new Error('boom'));
    expect(await fakeBrowser.runtime.sendMessage({ type: 'fill', resumeId: null })).toMatchObject({ filled: 0, notes: ['Error: boom'] });
    ctx.notifyInvalidated();
  });

  it('cleans up an invalid-context rejection from the settings check', async () => {
    mocks.loadSettings.mockRejectedValue(new Error('Extension context invalidated.'));
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    expect(ctx.notifyInvalidated).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.sendPanel).not.toHaveBeenCalled();
    document.body.append(document.createElement('input'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.loadSettings).toHaveBeenCalledOnce();
  });

  it('stops panel checks when the background reports an invalid context', async () => {
    mocks.sendPanel.mockResolvedValue({ kind: 'error', error: 'Extension context invalidated.' });
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    expect(ctx.notifyInvalidated).toHaveBeenCalledOnce();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('does not show a stale panel when invalidation happens during a request', async () => {
    let resolveState!: (value: unknown) => void;
    mocks.sendPanel.mockImplementation(() => new Promise((resolve) => { resolveState = resolve; }));
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    ctx.notifyInvalidated();
    resolveState({ kind: 'state', isApplication: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('cancels pending panel checks when the extension is reloaded', async () => {
    const ctx = startContent();
    ctx.notifyInvalidated();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.loadSettings).not.toHaveBeenCalled();
    expect(mocks.sendPanel).not.toHaveBeenCalled();
  });

  it('reads settings for its checks once, then follows changes made in Options', async () => {
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    expect(mocks.show).toHaveBeenCalled();
    // The page keeps changing: more checks, no more storage reads.
    for (let i = 0; i < 5; i++) {
      document.body.append(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(mocks.sendPanel.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.loadSettings).toHaveBeenCalledOnce();
    // Turning the panel off in Options applies at the next check.
    await fakeBrowser.storage.local.set({ settings: { showOnPage: false } });
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.remove).toHaveBeenCalled();
    expect(mocks.loadSettings).toHaveBeenCalledOnce();
    ctx.notifyInvalidated();
  });

  it('fills from the keyboard shortcut like Fill page when the panel is on screen', async () => {
    mocks.panelShown = true;
    const ctx = startContent();
    expect(await fakeBrowser.runtime.sendMessage({ type: 'shortcutFill' })).toEqual({ started: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.panelFill).toHaveBeenCalledOnce();
    expect(mocks.sendPanel).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'panel:fill' }));
    ctx.notifyInvalidated();
  });

  it('fills from the keyboard shortcut with the picked resume when the panel is closed', async () => {
    mocks.sendPanel.mockImplementation(async (msg: { type: string }) =>
      msg.type === 'panel:fill'
        ? { kind: 'reports', reports: [{ ats: 'Workday', filled: 3, needsReview: 1, fields: [{ label: 'Essay', status: 'review' }], notes: [] }] }
        : { kind: 'state', isApplication: true, pickedResumeId: 'r1', pickedSkillSetId: 's1' });
    const ctx = startContent();
    const before = document.documentElement.children.length;
    await fakeBrowser.runtime.sendMessage({ type: 'shortcutFill' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.panelFill).not.toHaveBeenCalled();
    expect(mocks.sendPanel).toHaveBeenCalledWith({ type: 'panel:fill', resumeId: 'r1', skillSetId: 's1' });
    // A summary toast instead of the panel's report.
    expect(document.documentElement.children.length).toBe(before + 1);
    ctx.notifyInvalidated();
  });

  it('still shows the panel while the extension is connected', async () => {
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(ctx.isInvalid).toBe(false);
    ctx.notifyInvalidated();
  });
});
