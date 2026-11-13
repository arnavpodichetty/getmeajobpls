// The top frame looks for an application form whenever the page changes. On a page that keeps
// changing without becoming one, those looks must thin out, and come back when you act.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import content from '../src/entrypoints/content';

const mocks = vi.hoisted(() => ({ isJobPosting: vi.fn(() => false), show: vi.fn() }));

vi.mock('../src/lib/storage', () => ({ loadSettings: vi.fn(async () => ({ showOnPage: true })), loadProfile: vi.fn() }));
vi.mock('../src/lib/messages', () => ({ sendPanel: vi.fn(async () => ({ kind: 'state', isApplication: false })), requestResumeFile: vi.fn() }));
vi.mock('../src/adapters', () => ({ detectAdapter: () => ({ id: 'generic', name: 'Unknown site', fill: vi.fn() }) }));
vi.mock('../src/lib/jobInfo', () => ({ isJobPosting: mocks.isJobPosting }));
vi.mock('../src/lib/panel', () => ({
  FillPanel: class {
    shown = false;
    show = mocks.show;
    remove = vi.fn();
  },
}));

function startContent() {
  let invalid = false;
  const cleanup: (() => void)[] = [];
  const ctx = {
    get isInvalid() { return invalid; },
    onInvalidated: (callback: () => void) => { cleanup.push(callback); },
    setTimeout: (callback: () => void, delay: number) => window.setTimeout(() => { if (!invalid) callback(); }, delay),
    notifyInvalidated: () => {
      invalid = true;
      cleanup.forEach((callback) => callback());
    },
  };
  content.main(ctx as unknown as ContentScriptContext);
  return ctx;
}

/** A page that changes every 100ms (a chat, a video player) for `ms`. */
async function busyFor(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    document.body.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(100);
  }
}

const checks = () => mocks.isJobPosting.mock.calls.length;

let ctx: ReturnType<typeof startContent>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fakeBrowser.reset();
  document.body.innerHTML = '';
  ctx = startContent();
});

afterEach(() => {
  ctx.notifyInvalidated();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('looking for a form on a page that keeps changing', () => {
  it('checks often at first, then less and less', async () => {
    await busyFor(3000);
    const early = checks();
    expect(early).toBeGreaterThanOrEqual(8);
    await busyFor(57_000);
    // Every 300ms for a minute would be 200 checks.
    expect(checks()).toBeLessThan(50);
    const before = checks();
    await busyFor(30_000);
    expect(checks() - before).toBeLessThanOrEqual(11);
  });

  it('checks promptly again after a click or a key', async () => {
    await busyFor(60_000);
    for (const type of ['pointerdown', 'keydown']) {
      await busyFor(60_000);
      const before = checks();
      window.dispatchEvent(new Event(type));
      await busyFor(700);
      expect(checks() - before).toBeGreaterThanOrEqual(2);
    }
  });

  it('starts looking again when a page left open past 15 minutes changes address', async () => {
    await busyFor(1000);
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    const before = checks();
    await busyFor(2000);
    expect(checks()).toBe(before);
    history.pushState({}, '', '/jobs/123/apply');
    await busyFor(1000);
    expect(checks()).toBeGreaterThan(before);
  });
});
