import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FillPanel } from '../src/lib/panel';
import { sendPanel } from '../src/lib/messages';

vi.mock('../src/lib/messages', () => ({ sendPanel: vi.fn(async () => ({ kind: 'reports', reports: [] })) }));

let panelRoot: ShadowRoot;

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  document.documentElement.querySelectorAll('getmeajobpls-panel').forEach((p) => p.remove());
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init);
    if (this.localName === 'getmeajobpls-panel') panelRoot = root;
    return root;
  });
});

afterEach(() => vi.restoreAllMocks());

function showPanel() {
  new FillPanel().show({
    kind: 'state', connected: true, isApplication: true, atsLabel: 'Greenhouse',
    resumes: [], pickedResumeId: null, pickReason: '', skillSets: [], pickedSkillSetId: null, skillSetByResume: {}, showCapture: false, canTailor: false,
  });
  return {
    wrap: panelRoot.querySelector<HTMLElement>('.wrap')!,
    bar: panelRoot.querySelector<HTMLElement>('.bar')!,
    fill: panelRoot.querySelector<HTMLElement>('.fill')!,
  };
}

const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y, button: 0 }));

describe('on-page panel position', () => {
  it('moves with a drag on the bar, saves the spot, and the drag does not press Fill page', async () => {
    const { wrap, fill } = showPanel();
    pointer(fill, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 60, 140);
    pointer(window, 'pointerup', 60, 140);
    fill.click();
    expect(sendPanel).not.toHaveBeenCalled();
    expect(wrap.style.right).toBe('auto');
    await vi.waitFor(async () => expect((await fakeBrowser.storage.local.get('panelPosition')).panelPosition).toBeDefined());
  });

  it('a press that barely moves is still a click', () => {
    const { fill } = showPanel();
    pointer(fill, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 102, 101);
    pointer(window, 'pointerup', 102, 101);
    fill.click();
    expect(sendPanel).toHaveBeenCalledWith(expect.objectContaining({ type: 'panel:fill' }));
  });

  it('opens where you left it, kept on screen', async () => {
    await fakeBrowser.storage.local.set({ panelPosition: { left: 99_999, top: 50 } });
    const { wrap } = showPanel();
    await vi.waitFor(() => expect(wrap.style.top).toBe('50px'));
    expect(parseFloat(wrap.style.left)).toBeLessThan(window.innerWidth);
  });
});
