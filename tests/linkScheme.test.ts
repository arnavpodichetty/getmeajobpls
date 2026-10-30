// Sites (Oracle) pre-fill links from the resume text without "https://", then reject them.
import { beforeEach, describe, expect, it } from 'vitest';
import { fillPage, fullProfileLink, linkWithScheme } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

beforeEach(fastTimings);

const links = { linkedin: 'https://linkedin.com/in/ada', github: 'https://github.com/ada', website: 'https://ada.dev/', portfolio: '', twitter: '', other: '' };

describe('links pre-filled without https://', () => {
  it.each([
    ['ada.dev', 'https://ada.dev/'],
    ['www.ada.dev', 'https://ada.dev/'],
    ['ADA.dev/', 'https://ada.dev/'],
    ['github.com/ada', 'https://github.com/ada'],
    ['linkedin.com/in/ada', 'https://linkedin.com/in/ada'],
  ])('%s → %s', (shown, full) => {
    expect(fullProfileLink(shown, links)).toBe(full);
  });

  it.each(['https://ada.dev', 'example.com', 'Ada', ''])('leaves %j alone', (shown) => {
    expect(fullProfileLink(shown, links)).toBeNull();
  });

  it('replaces a pre-filled bare link in a "Link 2" box with the full one', async () => {
    document.body.innerHTML = '<label for="l1">Link 1</label><input id="l1" type="text" value="linkedin.com/in/ada"><label for="l2">Link 2</label><input id="l2" type="text" value="ada.dev">';
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.links.website = 'https://ada.dev';
    const report = await fillPage(ctx, { ats: 'Oracle' });
    expect((document.getElementById('l1') as HTMLInputElement).value).toBe('https://linkedin.com/in/ada');
    expect((document.getElementById('l2') as HTMLInputElement).value).toBe('https://ada.dev');
    expect(report.needsReview).toBe(0);
  });

  it.each([
    ['acme.dev', 'https://acme.dev'],
    ['www.acme.dev/work', 'https://www.acme.dev/work'],
    ['ada.dev', 'https://ada.dev/'],
  ])('a link box holding %s becomes %s', (shown, full) => {
    expect(linkWithScheme(shown, links)).toBe(full);
  });

  it.each(['https://acme.dev', 'http://acme.dev', 'Ada Lovelace', 'ada@acme.dev', 'N/A', ''])('a link box holding %j is left alone', (shown) => {
    expect(linkWithScheme(shown, links)).toBeNull();
  });

  it('adds https:// to a bare link in a url box even when it is not in your profile', async () => {
    document.body.innerHTML = '<label for="l2">Link 2</label><input id="l2" type="url" value="acme.dev">';
    resetLayoutCache();
    const report = await fillPage(context({ resume: null }), { ats: 'Oracle' });
    expect((document.getElementById('l2') as HTMLInputElement).value).toBe('https://acme.dev');
    expect(report.needsReview).toBe(0);
  });

  it('fixes a link the site fills in after the box was already passed', async () => {
    document.body.innerHTML = '<label for="l2">Link 2</label><input id="l2" type="url" value="">';
    resetLayoutCache();
    const ctx = context({ resume: null });
    await fillPage(ctx, { ats: 'Oracle' });
    (document.getElementById('l2') as HTMLInputElement).value = 'ada.dev';
    await fillPage(ctx, { ats: 'Oracle', incremental: true });
    expect((document.getElementById('l2') as HTMLInputElement).value).toBe('https://ada.dev');
  });

  it('adds https:// to a profile link saved without it', async () => {
    document.body.innerHTML = '<label for="w">Website</label><input id="w" type="url" value="">';
    resetLayoutCache();
    const ctx = context({ resume: null });
    ctx.profile.links.website = 'ada.dev';
    await fillPage(ctx, { ats: 'Oracle' });
    expect((document.getElementById('w') as HTMLInputElement).value).toBe('https://ada.dev');
  });
});
