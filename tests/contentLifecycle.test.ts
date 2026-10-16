import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import content from '../src/entrypoints/content';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  sendPanel: vi.fn(),
  show: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../src/lib/storage', () => ({ loadSettings: mocks.loadSettings, loadProfile: vi.fn() }));
vi.mock('../src/lib/messages', () => ({ sendPanel: mocks.sendPanel, requestResumeFile: vi.fn() }));
vi.mock('../src/adapters', () => ({ detectAdapter: () => ({ id: 'workday', name: 'Workday' }) }));
vi.mock('../src/lib/panel', () => ({
  FillPanel: class {
    shown = false;
    show = mocks.show;
    remove = mocks.remove;
  },
}));

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
  mocks.loadSettings.mockResolvedValue({ showOnPage: true });
  mocks.sendPanel.mockResolvedValue({ kind: 'state', isApplication: true });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('content script reload lifecycle', () => {
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

  it('still shows the panel while the extension is connected', async () => {
    const ctx = startContent();
    await vi.advanceTimersByTimeAsync(1200);
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(ctx.isInvalid).toBe(false);
    ctx.notifyInvalidated();
  });
});
