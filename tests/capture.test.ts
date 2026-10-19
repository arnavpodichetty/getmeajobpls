import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillPanel } from '../src/lib/panel';
import { sendPanel } from '../src/lib/messages';
import { captureForm } from '../src/lib/engine/capture';
import { downloadCapture } from '../src/lib/captureDownload';

vi.mock('../src/lib/messages', () => ({ sendPanel: vi.fn() }));

let panelRoot: ShadowRoot;
const createObjectURL = vi.fn((_blob: Blob) => 'blob:captured-form');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static override createObjectURL = createObjectURL;
    static override revokeObjectURL = revokeObjectURL;
  });
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init);
    if (this.localName === 'getmeajobpls-panel') panelRoot = root;
    return root;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function showPanel(showCapture = true) {
  const panel = new FillPanel();
  panel.show({
    kind: 'state', connected: true, isApplication: true, atsLabel: 'Workday',
    resumes: [], pickedResumeId: null, pickReason: '', skillSets: [], pickedSkillSetId: null, skillSetByResume: {}, showCapture, canTailor: false,
  });
  return panelRoot.querySelector<HTMLButtonElement>('.capture')!;
}

describe('Capture page', () => {
  it('is hidden unless the developer setting is on', () => {
    expect(showPanel(false).hidden).toBe(true);
    expect(showPanel(true).hidden).toBe(false);
  });


  it('downloads a snapshot from the visible on-page button', async () => {
    vi.mocked(sendPanel).mockResolvedValue({ kind: 'capture', html: '<html>form</html>', url: 'https://example.com/apply' });
    const button = showPanel();
    expect(button.textContent).toBe('Capture page');
    expect(button.closest('[hidden]')).toBeNull();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPanel).toHaveBeenCalledWith({ type: 'panel:capture' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(panelRoot.textContent).toContain('Attach the HTML file in chat');
    expect(button.disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:captured-form');
  });

  it('shows a retryable capture failure without downloading an error response', async () => {
    vi.mocked(sendPanel).mockResolvedValue({ kind: 'error', error: 'Refresh the page to reconnect.' });
    const button = showPanel();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(panelRoot.textContent).toContain('Capture failed: Refresh the page to reconnect.');
    expect(button.disabled).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps form structure and dropdown options while removing typed field values', () => {
    document.body.innerHTML = `<label for="name">Name</label><input id="name" value="Private name" />
      <textarea>Private answer</textarea><script>privateScript()</script>
      <div role="listbox"><div role="option">Fluent</div><div role="option">Expert</div></div>`;
    const html = captureForm();
    expect(html).toContain('label for="name"');
    expect(html).toContain('Fluent');
    expect(html).toContain('Expert');
    expect(html).not.toContain('Private name');
    expect(html).not.toContain('Private answer');
    expect(html).not.toContain('privateScript');
  });

  it('creates a named HTML download and rejects an empty capture', () => {
    const name = downloadCapture({ html: '<html>snapshot</html>', url: 'https://globex.wd5.myworkdayjobs.com/apply' });
    expect(name).toMatch(/^globex\.wd5\.myworkdayjobs\.com-.*\.html$/);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/html');
    expect(() => downloadCapture({ html: '', url: 'https://example.com' })).toThrow('empty capture');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('Closing the panel', () => {
  it('stays closed on this page and stops watching for new fields', () => {
    const onDismiss = vi.fn();
    const panel = new FillPanel(onDismiss);
    const state = {
      kind: 'state' as const, connected: true, isApplication: true, atsLabel: 'Greenhouse',
      resumes: [], pickedResumeId: null, pickReason: '', skillSets: [], pickedSkillSetId: null, skillSetByResume: {}, showCapture: false, canTailor: false,
    };
    panel.show(state);
    panelRoot.querySelector<HTMLButtonElement>('button[title="Hide on this page"]')!.click();
    expect(panel.shown).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
    panel.show(state);
    expect(panel.shown).toBe(false);
  });
});
