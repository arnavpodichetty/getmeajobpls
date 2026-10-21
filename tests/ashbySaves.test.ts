import { afterEach, describe, expect, it } from 'vitest';
import { ASHBY_SAVING_ATTR, waitForAshbySaves } from '../src/lib/ashbySaves';

describe('waiting for Ashby saves', () => {
  afterEach(() => document.documentElement.removeAttribute(ASHBY_SAVING_ATTR));

  it('waits until no save is in flight, so overlapping saves cannot overwrite an answer', async () => {
    document.documentElement.setAttribute(ASHBY_SAVING_ATTR, '1');
    setTimeout(() => document.documentElement.setAttribute(ASHBY_SAVING_ATTR, '0'), 300);
    const start = Date.now();
    await waitForAshbySaves();
    expect(Date.now() - start).toBeGreaterThanOrEqual(290);
  });

  it('returns quickly when nothing is saving', async () => {
    document.documentElement.setAttribute(ASHBY_SAVING_ATTR, '0');
    const start = Date.now();
    await waitForAshbySaves();
    expect(Date.now() - start).toBeLessThan(250);
  });

  it('still leaves a gap between answers when the save counter is missing', async () => {
    const start = Date.now();
    await waitForAshbySaves();
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });
});
