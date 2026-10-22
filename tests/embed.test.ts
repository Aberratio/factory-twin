import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEIGHT_MESSAGE, parentOrigin, reportHeightToParent } from '../src/ui/embed';

describe('parentOrigin', () => {
  it('prefers the first ancestor origin', () => {
    expect(parentOrigin(['https://kokot.it'], 'https://other.example/page')).toBe(
      'https://kokot.it',
    );
  });

  it('falls back to the referrer origin when there are no ancestor origins', () => {
    expect(parentOrigin(undefined, 'https://kokot.it/case-studies/factory-twin?x=1')).toBe(
      'https://kokot.it',
    );
    expect(parentOrigin([], 'https://kokot.it/')).toBe('https://kokot.it');
  });

  it("skips an opaque ancestor ('null') and uses the referrer", () => {
    expect(parentOrigin(['null'], 'https://kokot.it/')).toBe('https://kokot.it');
  });

  it("uses '*' only when nothing names the parent", () => {
    expect(parentOrigin(undefined, '')).toBe('*');
    expect(parentOrigin([], 'not a url')).toBe('*');
    expect(parentOrigin(['null'], 'data:text/html,x')).toBe('*');
  });
});

describe('reportHeightToParent', () => {
  let resize: () => void = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();

  class FakeResizeObserver {
    constructor(cb: () => void) {
      resize = cb;
    }
    observe = observe;
    disconnect = disconnect;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    observe.mockClear();
    disconnect.mockClear();
  });

  function frame(heights: number[], opts: { topLevel?: boolean } = {}) {
    const postMessage = vi.fn();
    const root = { getBoundingClientRect: () => ({ height: heights.shift() ?? 0 }) };
    const win = {
      location: { ancestorOrigins: ['https://kokot.it'] },
      document: { referrer: 'https://ignored.example/', documentElement: root },
      parent: { postMessage },
    } as unknown as Window;
    if (opts.topLevel) (win as unknown as { parent: Window }).parent = win;
    return { win, postMessage, root };
  }

  it('posts the rounded-up height to the parent origin at start and on each change', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { win, postMessage, root } = frame([612.2, 640, 700.5]);
    reportHeightToParent(win);
    expect(observe).toHaveBeenCalledWith(root);
    resize();
    resize();
    expect(postMessage.mock.calls).toEqual([
      [{ type: HEIGHT_MESSAGE, height: 613 }, 'https://kokot.it'],
      [{ type: HEIGHT_MESSAGE, height: 640 }, 'https://kokot.it'],
      [{ type: HEIGHT_MESSAGE, height: 701 }, 'https://kokot.it'],
    ]);
  });

  it('does not re-send an unchanged height', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { win, postMessage } = frame([600, 600, 600.4, 640]);
    reportHeightToParent(win);
    resize();
    resize();
    resize();
    expect(postMessage.mock.calls.map(([m]) => m.height)).toEqual([600, 601, 640]);
  });

  it('stops observing when the returned function is called', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const stop = reportHeightToParent(frame([600]).win);
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('does nothing when the page is not in a frame', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { win, postMessage } = frame([600], { topLevel: true });
    reportHeightToParent(win)();
    expect(observe).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
