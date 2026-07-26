/**
 * Chromium HTML-in-Canvas lensing, the capability-gated enhancement
 * (dec.liquid-glass-architecture, rung 3, item 5).
 *
 * The API under test does not exist in any test runtime, and will not while it
 * is trial-gated, so the capability is faked at the prototype and the drawing
 * context is injected. What that leaves testable is exactly what matters: the
 * gate refuses by default, the projection maths is the same arithmetic the
 * snapshot lens uses, and every failure mode degrades instead of throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countInteractiveDescendants,
  createElementLens,
  elementLensCapability,
  lensRegionsOverlap,
  liveLensCanvas,
  MAX_LIVE_LENS_FAILURES,
  resolveLiveLens,
  type ElementDrawingContext,
} from '../src/core/element-lens';
import { lensDisplacement, lensWindow, type LensRect } from '../src/core/lens';

/** A 400x300 head canvas and the 512x512 live subtree beside it. */
const HEAD: LensRect = { x: 900, y: 200, width: 400, height: 300 };
const LIVE: LensRect = { x: 100, y: 150, width: 512, height: 512 };

/** A scope with the flag on: both halves ship together behind CanvasDrawElement. */
function flaggedScope(overrides: { draw?: boolean; tex?: boolean } = {}): unknown {
  return {
    ...(overrides.draw === false
      ? {}
      : { CanvasRenderingContext2D: { prototype: { drawElementImage(): void {} } } }),
    ...(overrides.tex === false
      ? {}
      : { WebGL2RenderingContext: { prototype: { texElementImage2D(): void {} } } }),
  };
}

describe('elementLensCapability', () => {
  it('is off in every runtime that has not been launched with the flag', () => {
    const capability = elementLensCapability({});
    expect(capability.supported).toBe(false);
    expect(capability.drawElementImage).toBe(false);
    expect(capability.texElementImage2D).toBe(false);
  });

  it('reports both halves of the API when the flag is on', () => {
    const capability = elementLensCapability(flaggedScope());
    expect(capability).toEqual({
      drawElementImage: true,
      texElementImage2D: true,
      supported: true,
    });
  });

  it('refuses a half-present API rather than guessing', () => {
    // The two ship together behind one flag. One without the other means the
    // shape changed under us, and the safe reading of that is "gone".
    expect(elementLensCapability(flaggedScope({ tex: false })).supported).toBe(false);
    expect(elementLensCapability(flaggedScope({ draw: false })).supported).toBe(false);
  });

  it('survives a scope with no window at all', () => {
    expect(elementLensCapability(null).supported).toBe(false);
    expect(elementLensCapability(undefined).supported).toBe(false);
  });

  it('probes prototypes, so it never constructs a context', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    elementLensCapability(flaggedScope());
    expect(getContext).not.toHaveBeenCalled();
    getContext.mockRestore();
  });
});

describe('liveLensCanvas', () => {
  function subtree(attrs: { layoutsubtree?: boolean; parent?: 'canvas' | 'div' | null }) {
    const child = document.createElement('div');
    if (attrs.parent === null) return { child, holder: null };
    const holder = document.createElement(attrs.parent ?? 'canvas');
    if (attrs.layoutsubtree !== false) holder.setAttribute('layoutsubtree', '');
    holder.appendChild(child);
    return { child, holder };
  }

  it('accepts an immediate child of a layout-subtree canvas', () => {
    const { child, holder } = subtree({});
    expect(liveLensCanvas(child)).toBe(holder);
  });

  it('refuses a canvas child with no layoutsubtree: it has no paint record', () => {
    const { child } = subtree({ layoutsubtree: false });
    expect(liveLensCanvas(child)).toBeNull();
  });

  it('refuses an ordinary element: only canvas children can be drawn', () => {
    const { child } = subtree({ parent: 'div' });
    expect(liveLensCanvas(child)).toBeNull();
  });

  it('refuses a grandchild: the restriction is immediate children only', () => {
    const holder = document.createElement('canvas');
    holder.setAttribute('layoutsubtree', '');
    const wrapper = document.createElement('div');
    const child = document.createElement('div');
    wrapper.appendChild(child);
    holder.appendChild(wrapper);
    expect(liveLensCanvas(child)).toBeNull();
  });

  it('refuses a detached element', () => {
    expect(liveLensCanvas(document.createElement('div'))).toBeNull();
  });
});

describe('resolveLiveLens', () => {
  function goodSubtree(): Element {
    const holder = document.createElement('canvas');
    holder.setAttribute('layoutsubtree', '');
    const child = document.createElement('div');
    holder.appendChild(child);
    return child;
  }

  it('engages only where the capability is detected', () => {
    const child = goodSubtree();
    expect(resolveLiveLens(child, flaggedScope())).toBe(child.parentElement);
    // The normal case, everywhere that is not flagged Chromium.
    expect(resolveLiveLens(child, {})).toBeNull();
  });

  it('is off by default in this runtime', () => {
    expect(resolveLiveLens(goodSubtree())).toBeNull();
  });
});

describe('lensRegionsOverlap', () => {
  it('sees a head sitting on top of the subtree it refracts', () => {
    expect(lensRegionsOverlap(LIVE, { ...LIVE, x: LIVE.x + 100 })).toBe(true);
  });

  it('leaves a head laid out beside the source alone', () => {
    expect(lensRegionsOverlap(HEAD, LIVE)).toBe(false);
  });

  it('does not count a shared edge as an overlap', () => {
    expect(lensRegionsOverlap(LIVE, { ...LIVE, x: LIVE.x + LIVE.width })).toBe(false);
  });
});

describe('countInteractiveDescendants', () => {
  function subtree(html: string): Element {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('is zero for purely decorative content, which is the intended source', () => {
    expect(countInteractiveDescendants(subtree('<h1>hi</h1><p>copy</p><img alt="" />'))).toBe(0);
  });

  it('counts every control a distorted region would swallow', () => {
    const trapped = countInteractiveDescendants(
      subtree('<a href="#x">link</a><button>go</button><input /><div tabindex="0"></div>'),
    );
    expect(trapped).toBe(4);
  });

  it('counts the named element itself when a host refracts a control directly', () => {
    expect(countInteractiveDescendants(document.createElement('button'))).toBe(1);
  });

  it('ignores an anchor with no href, which is not focusable', () => {
    expect(countInteractiveDescendants(subtree('<a>not a link</a>'))).toBe(0);
  });
});

/**
 * `createElementLens` with the DOM edges injected: rects come from a table and
 * the drawing context is a recorder. Nothing here needs a GPU or a flag.
 */
function harness(
  overrides: { drawElementImage?: (element: Element) => void; context?: null; width?: number } = {},
) {
  const element = document.createElement('div');
  const source = document.createElement('canvas');
  source.width = overrides.width ?? LIVE.width;
  source.height = overrides.width ?? LIVE.height;
  source.appendChild(element);
  const canvas = document.createElement('canvas');
  const rects = new Map<unknown, LensRect>([
    [element, LIVE],
    [canvas, HEAD],
  ]);
  const calls: Array<{ transform: number[]; element: Element }> = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const ctx: ElementDrawingContext = {
    clearRect: () => {},
    setTransform: (a, b, c, d, e, f) => {
      transform = [a, b, c, d, e, f];
    },
    drawElementImage: (el) => {
      calls.push({ transform: [...transform], element: el });
      overrides.drawElementImage?.(el);
    },
  };
  const requestPaint = vi.fn();
  (source as HTMLCanvasElement & { requestPaint?: () => void }).requestPaint = requestPaint;
  const onError = vi.fn();
  const lens = createElementLens({
    element,
    canvas,
    source,
    onError,
    measure: (el) => rects.get(el) ?? { x: 0, y: 0, width: 0, height: 0 },
    context: () => (overrides.context === null ? null : ctx),
  });
  return { lens, element, source, canvas, rects, calls, onError, requestPaint };
}

describe('createElementLens', () => {
  const warnings: ReturnType<typeof vi.spyOn>[] = [];
  afterEach(() => {
    for (const spy of warnings.splice(0)) spy.mockRestore();
  });

  it('has no binding until the first frame is synced', () => {
    const { lens } = harness();
    expect(lens.binding).toBeNull();
    lens.dispose();
  });

  it('uploads live DOM and projects it with the same maths as the snapshot lens', () => {
    const { lens, calls, element } = harness();
    lens.sync(0.08);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.element).toBe(element);
    expect(lens.binding?.window).toEqual(lensWindow(HEAD, LIVE));
    expect(lens.binding?.displacement).toEqual(lensDisplacement(HEAD, 0.08));
    lens.dispose();
  });

  it('scales the layout box onto the backing store, so the texture is the element', () => {
    // A 1024-wide backing store over a 512 CSS-pixel element: draw at 2x, or
    // the texture holds the element in its top-left quarter and the window
    // projection points at the wrong pixels.
    const { lens, calls } = harness({ width: 1024 });
    lens.sync(0.06);
    expect(calls[0]?.transform).toEqual([2, 0, 0, 2, 0, 0]);
    lens.dispose();
  });

  it('re-uploads every frame, because the whole point is that it is not frozen', () => {
    const { lens, calls } = harness();
    for (let frame = 0; frame < 60; frame++) lens.sync(0.06);
    expect(calls).toHaveLength(60);
    lens.dispose();
  });

  it('keeps one texture across frames and marks it for re-upload', () => {
    const { lens, source } = harness();
    lens.sync(0.06);
    const first = lens.binding?.texture;
    expect(first?.image).toBe(source);
    // `needsUpdate` is write-only on THREE.Texture; the version counter is
    // what the renderer actually reads to decide whether to re-upload.
    const version = first?.version ?? -1;
    lens.sync(0.06);
    expect(lens.binding?.texture).toBe(first);
    expect(first?.version).toBeGreaterThan(version);
    lens.dispose();
  });

  it('decodes as sRGB, or the refracted page reads washed out', () => {
    const { lens } = harness();
    lens.sync(0.06);
    expect(lens.binding?.texture.colorSpace).toBe('srgb');
    lens.dispose();
  });

  it('follows a head that moves over a static source', () => {
    const { lens, rects, canvas } = harness();
    lens.sync(0.06);
    rects.set(canvas, { ...HEAD, y: HEAD.y + 250 });
    lens.sync(0.06);
    expect(lens.binding?.window).toEqual(lensWindow({ ...HEAD, y: HEAD.y + 250 }, LIVE));
    lens.dispose();
  });

  it('has nothing to recapture: live pixels are never stale', () => {
    const { lens, calls } = harness();
    lens.capture();
    expect(calls).toHaveLength(0);
    lens.dispose();
  });

  it('rides out a transient missing paint record and asks for one', () => {
    let remaining = 5;
    const { lens, onError, requestPaint } = harness({
      drawElementImage: () => {
        if (remaining-- > 0) throw new Error('No cached paint record for element');
      },
    });
    for (let frame = 0; frame < 5; frame++) lens.sync(0.06);
    expect(onError).not.toHaveBeenCalled();
    expect(requestPaint).toHaveBeenCalledTimes(5);
    expect(lens.binding).toBeNull();

    lens.sync(0.06);
    expect(lens.binding).not.toBeNull();
    lens.dispose();
  });

  it('resets the failure budget after a good frame', () => {
    let frame = 0;
    const { lens, onError } = harness({
      drawElementImage: () => {
        // Fail all but every tenth frame: never MAX in a row, so never fatal.
        if (frame++ % 10 !== 0) throw new Error('no paint record');
      },
    });
    for (let i = 0; i < MAX_LIVE_LENS_FAILURES * 4; i++) lens.sync(0.06);
    expect(onError).not.toHaveBeenCalled();
    expect(lens.binding).not.toBeNull();
    lens.dispose();
  });

  it('gives up after a bounded run of failures, reports once, and stops drawing', () => {
    const { lens, onError, calls } = harness({
      drawElementImage: () => {
        throw new Error('InvalidStateError');
      },
    });
    for (let frame = 0; frame < MAX_LIVE_LENS_FAILURES - 1; frame++) lens.sync(0.06);
    expect(onError).not.toHaveBeenCalled();

    lens.sync(0.06);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(lens.binding).toBeNull();

    // Dead means dead: no exception once a frame for the life of the page.
    const drawn = calls.length;
    for (let frame = 0; frame < 100; frame++) lens.sync(0.06);
    expect(calls).toHaveLength(drawn);
    expect(onError).toHaveBeenCalledTimes(1);
    lens.dispose();
  });

  it('degrades when the source canvas has no 2d context', () => {
    const { lens, onError } = harness({ context: null });
    for (let frame = 0; frame < MAX_LIVE_LENS_FAILURES; frame++) lens.sync(0.06);
    expect(lens.binding).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    lens.dispose();
  });

  it('draws nothing for a zero-sized source rather than dividing by it', () => {
    const { lens, calls, rects, element, onError } = harness();
    rects.set(element, { x: 0, y: 0, width: 0, height: 512 });
    lens.sync(0.06);
    expect(calls).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
    expect(lens.binding).toBeNull();
    lens.dispose();
  });

  it('disposes its texture, leaves the host canvas alone, and goes inert', () => {
    const { lens, calls, source } = harness();
    lens.sync(0.06);
    const texture = lens.binding?.texture;
    const disposed = vi.fn();
    texture?.addEventListener('dispose', disposed);

    lens.dispose();
    lens.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(lens.binding).toBeNull();
    // The canvas is the host's: the lens draws into it and never removes it.
    expect(source.isConnected || source.parentElement === null).toBe(true);

    const drawn = calls.length;
    lens.sync(0.06);
    lens.capture();
    expect(calls).toHaveLength(drawn);
  });
});
