/**
 * Pure snapshot-lens maths and recapture policy
 * (dec.liquid-glass-architecture, item 4).
 *
 * Every case here runs without a GPU, without a DOM rasteriser and without a
 * real clock: the window projection is arithmetic over two rectangles, and the
 * scheduler takes its timer by injection.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createLensScheduler,
  IDENTITY_LENS_WINDOW,
  lensDisplacement,
  lensWindow,
  lensWindowsDiffer,
  type LensRect,
} from '../src/core/lens';
import { createPageLens } from '../src/core/page-lens';

/** A 400x300 head canvas sitting inside a 1000x2000 hero section. */
const HERO: LensRect = { x: 100, y: 500, width: 1000, height: 2000 };
const HEAD: LensRect = { x: 300, y: 900, width: 400, height: 300 };

describe('lensWindow', () => {
  it('maps the canvas onto its share of the snapshot', () => {
    const w = lensWindow(HEAD, HERO);
    expect(w.scaleU).toBeCloseTo(0.4, 12);
    expect(w.offsetU).toBeCloseTo(0.2, 12);
  });

  it('flips v, because three uploads the snapshot with flipY', () => {
    const w = lensWindow(HEAD, HERO);
    // screenUV.y = 0 is the TOP of the head canvas, texture v = 1 is the top
    // of the snapshot, so the scale must be negative.
    expect(w.scaleV).toBeCloseTo(-0.15, 12);
    expect(w.offsetV).toBeCloseTo(0.8, 12);
  });

  it('samples the snapshot corner-to-corner when the rects coincide', () => {
    const w = lensWindow(HERO, HERO);
    expect(w).toEqual(IDENTITY_LENS_WINDOW);
  });

  it('puts the canvas top edge and bottom edge at the right texture rows', () => {
    const w = lensWindow(HEAD, HERO);
    const vAt = (screenY: number) => w.offsetV + screenY * w.scaleV;
    // Canvas top is 400 css px below the hero top, so 20% down the snapshot,
    // which is texture v 0.8 once flipped.
    expect(vAt(0)).toBeCloseTo(0.8, 12);
    // Canvas bottom is 700 px down, 35% of the hero, texture v 0.65.
    expect(vAt(1)).toBeCloseTo(0.65, 12);
  });

  it('degrades to the identity rather than dividing by a zero-sized source', () => {
    expect(lensWindow(HEAD, { x: 0, y: 0, width: 0, height: 200 })).toEqual(IDENTITY_LENS_WINDOW);
    expect(lensWindow(HEAD, { x: 0, y: 0, width: 200, height: 0 })).toEqual(IDENTITY_LENS_WINDOW);
    expect(lensWindow({ x: 0, y: 0, width: Number.NaN, height: 10 }, HERO)).toEqual(
      IDENTITY_LENS_WINDOW,
    );
  });
});

describe('lensDisplacement', () => {
  it('scales x by the canvas aspect so the offset is isotropic in pixels', () => {
    const [dx, dy] = lensDisplacement(HEAD, 0.08);
    // 400x300 canvas: one canvas-height of u is 300 px, so x must shrink by
    // 300/400 to travel the same distance on screen.
    expect(dx).toBeCloseTo(0.08 * (300 / 400), 12);
    expect(dy).toBeCloseTo(-0.08, 12);
  });

  it('negates y, because view space points up and screenUV points down', () => {
    const [, dy] = lensDisplacement(HEAD, 0.05);
    expect(dy).toBeLessThan(0);
  });

  it('is exactly zero at zero strength and on a degenerate canvas', () => {
    expect(lensDisplacement(HEAD, 0)).toEqual([0, 0]);
    expect(lensDisplacement({ x: 0, y: 0, width: 0, height: 0 }, 0.1)).toEqual([0, 0]);
    expect(lensDisplacement(HEAD, Number.NaN)).toEqual([0, 0]);
  });
});

describe('lensWindowsDiffer', () => {
  it('ignores sub-texel drift', () => {
    const a = lensWindow(HEAD, HERO);
    const b = lensWindow({ ...HEAD, y: HEAD.y + 0.05 }, HERO);
    expect(lensWindowsDiffer(a, b)).toBe(false);
  });

  it('sees a scroll of a few pixels', () => {
    const a = lensWindow(HEAD, HERO);
    const b = lensWindow({ ...HEAD, y: HEAD.y + 40 }, HERO);
    expect(lensWindowsDiffer(a, b)).toBe(true);
  });

  it('sees a resize', () => {
    const a = lensWindow(HEAD, HERO);
    const b = lensWindow({ ...HEAD, width: HEAD.width * 2 }, HERO);
    expect(lensWindowsDiffer(a, b)).toBe(true);
  });
});

/** Manual timer so the debounce is exercised without wall-clock waiting. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = next++;
      pending.set(handle, { fn, ms });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    get size() {
      return pending.size;
    },
    /** Fire every armed timer, newest wins if one re-arms. */
    flush() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, entry] of entries) entry.fn();
    },
    delays() {
      return [...pending.values()].map((entry) => entry.ms);
    },
  };
}

describe('createLensScheduler', () => {
  it('captures immediately on request', () => {
    const timers = manualTimers();
    const capture = vi.fn();
    const scheduler = createLensScheduler(capture, timers);
    scheduler.now();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });

  it('never captures per frame: repeated soon() calls only push the deadline out', () => {
    const timers = manualTimers();
    const capture = vi.fn();
    const scheduler = createLensScheduler(capture, { ...timers, debounceMs: 200 });
    for (let frame = 0; frame < 120; frame++) scheduler.soon();
    expect(capture).not.toHaveBeenCalled();
    expect(timers.size).toBe(1);
    expect(timers.delays()).toEqual([200]);
    timers.flush();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('drops a pending debounce when an immediate capture overtakes it', () => {
    const timers = manualTimers();
    const capture = vi.fn();
    const scheduler = createLensScheduler(capture, timers);
    scheduler.soon();
    scheduler.now();
    expect(capture).toHaveBeenCalledTimes(1);
    timers.flush();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('reports whether a capture is armed', () => {
    const timers = manualTimers();
    const scheduler = createLensScheduler(vi.fn(), timers);
    expect(scheduler.pending).toBe(false);
    scheduler.soon();
    expect(scheduler.pending).toBe(true);
    timers.flush();
    expect(scheduler.pending).toBe(false);
  });

  it('disposes idempotently and never fires afterwards', () => {
    const timers = manualTimers();
    const capture = vi.fn();
    const scheduler = createLensScheduler(capture, timers);
    scheduler.soon();
    scheduler.dispose();
    scheduler.dispose();
    expect(timers.size).toBe(0);
    scheduler.soon();
    scheduler.now();
    timers.flush();
    expect(capture).not.toHaveBeenCalled();
  });
});

/**
 * `createPageLens` with every DOM edge injected: rects come from a table, the
 * rasteriser is a stub, and the debounce runs on manual timers. Nothing here
 * touches layout or a GPU.
 */
function harness(overrides: { rasterise?: () => Promise<CanvasImageSource> } = {}) {
  const timers = manualTimers();
  const element = { id: 'hero' } as unknown as Element;
  const canvas = { id: 'canvas' } as unknown as HTMLCanvasElement;
  const rects = new Map<unknown, LensRect>([
    [element, HERO],
    [canvas, HEAD],
  ]);
  const rasterise =
    overrides.rasterise ??
    vi.fn(async () => ({ width: 8, height: 8 }) as unknown as CanvasImageSource);
  const lens = createPageLens({
    element,
    canvas,
    rasterise,
    measure: (el) => rects.get(el) ?? { x: 0, y: 0, width: 0, height: 0 },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { lens, timers, element, canvas, rects, rasterise };
}

/** Let the capture promise chain settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPageLens', () => {
  it('has no binding before the first capture lands', () => {
    const { lens } = harness();
    lens.sync(0.06);
    expect(lens.binding).toBeNull();
    lens.dispose();
  });

  it('binds the snapshot with the window and displacement the layout implies', async () => {
    const { lens } = harness();
    lens.capture();
    await settle();
    lens.sync(0.08);

    const binding = lens.binding;
    expect(binding).not.toBeNull();
    expect(binding?.window).toEqual(lensWindow(HEAD, HERO));
    expect(binding?.displacement).toEqual(lensDisplacement(HEAD, 0.08));
    expect(binding?.texture.image).toEqual({ width: 8, height: 8 });
    lens.dispose();
  });

  it('decodes the snapshot as sRGB, or the refracted page reads washed out', async () => {
    const { lens } = harness();
    lens.capture();
    await settle();
    lens.sync(0.06);
    expect(lens.binding?.texture.colorSpace).toBe('srgb');
    lens.dispose();
  });

  it('costs nothing on a plain page scroll: document rects do not move', async () => {
    const { lens, timers, rasterise } = harness();
    lens.capture();
    await settle();
    lens.sync(0.06);
    const first = lens.binding?.window;

    // A scroll changes `getBoundingClientRect` and the page scroll offset by
    // equal and opposite amounts, so the document-space rects this module
    // measures are invariant. That is the whole reason to snapshot in
    // document space: 600 frames of scrolling, no recapture, no window churn.
    for (let frame = 0; frame < 600; frame++) lens.sync(0.06);

    expect(timers.size).toBe(0);
    expect(rasterise).toHaveBeenCalledTimes(1);
    expect(lens.binding?.window).toEqual(first);
    lens.dispose();
  });

  it('follows a head that moves relative to a static source without recapturing', async () => {
    const { lens, timers, rasterise, rects, canvas } = harness();
    lens.capture();
    await settle();
    lens.sync(0.06);

    // A sticky head slides over a static hero. The snapshot pixels are still
    // valid; only the window into them moves.
    rects.set(canvas, { ...HEAD, y: HEAD.y + 250 });
    lens.sync(0.06);

    expect(lens.binding?.window).toEqual(lensWindow({ ...HEAD, y: HEAD.y + 250 }, HERO));
    expect(timers.size).toBe(0);
    expect(rasterise).toHaveBeenCalledTimes(1);
    lens.dispose();
  });

  it('recaptures once, debounced, when the source itself reflows', async () => {
    const { lens, timers, rasterise, rects, element } = harness();
    lens.capture();
    await settle();

    rects.set(element, { ...HERO, y: HERO.y + 320 });
    for (let frame = 0; frame < 60; frame++) lens.sync(0.06);

    expect(timers.size).toBe(1);
    expect(rasterise).toHaveBeenCalledTimes(1);
    timers.flush();
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(2);
    lens.dispose();
  });

  it('recaptures once, debounced, when the source resizes', async () => {
    const { lens, timers, rasterise, rects, element } = harness();
    lens.capture();
    await settle();

    rects.set(element, { ...HERO, height: HERO.height + 600 });
    for (let frame = 0; frame < 30; frame++) lens.sync(0.06);
    expect(rasterise).toHaveBeenCalledTimes(1);
    timers.flush();
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(2);
    lens.dispose();
  });

  it('keeps sampling the capture-time source rect, not the live one', async () => {
    const { lens, rects, element } = harness();
    lens.capture();
    await settle();

    // The source grew but the snapshot is still the old pixels: mapping
    // against the new rect would slide the whole page under the head.
    rects.set(element, { ...HERO, height: HERO.height * 2 });
    lens.sync(0.06);
    expect(lens.binding?.window).toEqual(lensWindow(HEAD, HERO));
    lens.dispose();
  });

  it('coalesces requests made while a capture is in flight', async () => {
    const resolvers: Array<(image: CanvasImageSource) => void> = [];
    const rasterise = vi.fn(
      () => new Promise<CanvasImageSource>((resolve) => resolvers.push(resolve)),
    );
    const { lens } = harness({ rasterise });
    lens.capture();
    lens.capture();
    lens.capture();
    expect(rasterise).toHaveBeenCalledTimes(1);

    resolvers[0]?.({ width: 4, height: 4 } as unknown as CanvasImageSource);
    await settle();
    // One follow-up for everything asked for during the first, not three.
    expect(rasterise).toHaveBeenCalledTimes(2);

    resolvers[1]?.({ width: 4, height: 4 } as unknown as CanvasImageSource);
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(2);
    lens.dispose();
  });

  it('recaptures once after a scroll settles, and never during it', async () => {
    const element = document.createElement('section');
    document.body.appendChild(element);
    const timers = manualTimers();
    const rasterise = vi.fn(
      async () => ({ width: 8, height: 8 }) as unknown as CanvasImageSource,
    );
    const lens = createPageLens({
      element,
      canvas: document.createElement('canvas'),
      rasterise,
      measure: () => HERO,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    lens.capture();
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(1);

    // Content inside the source can be scroll-driven, so a scroll does need a
    // recapture eventually. What it must never do is one per event.
    for (let event = 0; event < 500; event++) window.dispatchEvent(new Event('scroll'));
    expect(timers.size).toBe(1);
    expect(rasterise).toHaveBeenCalledTimes(1);
    timers.flush();
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(2);

    lens.dispose();
    for (let event = 0; event < 10; event++) window.dispatchEvent(new Event('scroll'));
    expect(timers.size).toBe(0);
    element.remove();
  });

  it('reports a rasteriser failure and leaves the head unrefracted', async () => {
    const onError = vi.fn();
    const timers = manualTimers();
    const element = {} as Element;
    const lens = createPageLens({
      element,
      canvas: {} as HTMLCanvasElement,
      rasterise: () => Promise.reject(new Error('no rasteriser')),
      measure: () => HERO,
      onError,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    lens.capture();
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    lens.sync(0.06);
    expect(lens.binding).toBeNull();
    lens.dispose();
  });

  it('disposes the texture and goes inert', async () => {
    const { lens, timers } = harness();
    lens.capture();
    await settle();
    lens.sync(0.06);
    const texture = lens.binding?.texture;
    const disposed = vi.fn();
    texture?.addEventListener('dispose', disposed);

    lens.dispose();
    lens.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(lens.binding).toBeNull();
    expect(timers.size).toBe(0);

    lens.capture();
    lens.sync(0.06);
    expect(lens.binding).toBeNull();
  });
});
