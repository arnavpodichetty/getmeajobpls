// Sites (Oracle) pre-fill links from the resume text without "https://", then reject them.
import { beforeEach, describe, expect, it } from 'vitest';
import { fillPage, fullProfileLink } from '../src/lib/engine/fill';
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
});
