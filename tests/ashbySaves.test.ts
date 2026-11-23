import { afterEach, describe, expect, it } from 'vitest';
import { ASHBY_SAVING_ATTR, countAshbySaves, waitForAshbySaves } from '../src/lib/ashbySaves';

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

describe('counting Ashby saves', () => {
  afterEach(() => document.documentElement.removeAttribute(ASHBY_SAVING_ATTR));

  const fakePage = () => {
    const pending: (() => void)[] = [];
    const page = { fetch: (() => new Promise<Response>((resolve) => pending.push(() => resolve(new Response())))) as typeof fetch };
    return { page, finishAll: () => pending.splice(0).forEach((f) => f()) };
  };
  const saving = () => document.documentElement.getAttribute(ASHBY_SAVING_ATTR);

  it('counts only form-value saves, by URL string or request object', async () => {
    const { page, finishAll } = fakePage();
    countAshbySaves(page);
    expect(saving()).toBe('0');
    void page.fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue');
    void page.fetch(new Request('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue'));
    void page.fetch('https://jobs.ashbyhq.com/api/other');
    expect(saving()).toBe('2');
    finishAll();
    await new Promise((r) => setTimeout(r, 0));
    expect(saving()).toBe('0');
  });

});
