// waitForElement backs every "wait for the dropdown / the new row / the saved form" step.
// It must always end: a fill waiting on it otherwise never finishes, and every later
// fill on the page is refused as "already running".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForElement } from '../src/lib/engine/dom';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForElement', () => {
  it('resolves with the element once it appears', async () => {
    const wait = waitForElement(() => document.querySelector<HTMLElement>('#late'), 3000);
    const late = document.createElement('div');
    late.id = 'late';
    document.body.append(late);
    await vi.advanceTimersByTimeAsync(200);
    expect(await wait).toBe(late);
  });

  it('still ends at the timeout when the lookup throws while waiting', async () => {
    let calls = 0;
    const wait = waitForElement(() => {
      if (++calls > 1) throw new Error('the page swapped the element out');
      return null;
    }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(wait).resolves.toBeNull();
    // Its polling stopped with it.
    const after = calls;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(after);
  });
});
