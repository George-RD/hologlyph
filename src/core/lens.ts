/**
 * Snapshot-lens projection maths and recapture policy
 * (dec.liquid-glass-architecture, rung 3, item 4).
 *
 * No browser API hands rendered page pixels to WebGL, so true per-pixel
 * lensing on every engine has to rasterise a subtree the host names, upload it
 * as a texture, and sample it displaced by the head's normals and thickness
 * (`res.dom-backdrop-capture`).
 *
 * The snapshot is taken in DOCUMENT space, which is what makes scrolling
 * free: the pixels do not change as the page moves, only the window this
 * canvas samples out of them. That window is two rectangles' worth of
 * arithmetic, so it lives here, with no DOM and no GPU, and is unit-tested
 * against the numbers rather than eyeballed in a browser.
 *
 * Everything in this module degrades instead of throwing: a zero-sized source
 * rect, a detached element or a non-finite strength returns the identity or
 * zero rather than a NaN that would reach a uniform and blank the head.
 */

import type { Disposable, LensWindow } from '../contracts.js';

/**
 * A rectangle in CSS pixels, in DOCUMENT space (page origin, not viewport):
 * `getBoundingClientRect()` plus the current scroll offset.
 */
export interface LensRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type { LensWindow };

/** The whole snapshot, corner to corner: what a canvas covering the source sees. */
export const IDENTITY_LENS_WINDOW: LensWindow = Object.freeze({
  offsetU: 0,
  offsetV: 1,
  scaleU: 1,
  scaleV: -1,
});

function isUsableRect(rect: LensRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Where the head canvas sits inside the snapshot, as a texture-space window.
 *
 * Both rectangles are in document space, so a scroll moves them together and
 * the window they produce is exactly the part of the frozen snapshot that is
 * currently behind the head. A degenerate rectangle returns the identity: the
 * lens then samples the whole snapshot, which is wrong but bounded, where a
 * division by zero would put an infinity in a uniform.
 */
export function lensWindow(canvas: LensRect, source: LensRect): LensWindow {
  if (!isUsableRect(canvas) || !isUsableRect(source)) return IDENTITY_LENS_WINDOW;
  return {
    offsetU: (canvas.x - source.x) / source.width,
    offsetV: 1 - (canvas.y - source.y) / source.height,
    scaleU: canvas.width / source.width,
    scaleV: -(canvas.height / source.height),
  };
}

/**
 * Per-axis sample displacement, in `screenUV` units, for unit body thickness
 * and a unit view-space normal.
 *
 * `strength` is quoted in canvas HEIGHTS so the look does not change when the
 * host resizes a non-square canvas; x is divided by the aspect ratio to keep
 * the offset isotropic in device pixels. The y term is negated because view
 * space points up and `screenUV.y` points down.
 */
export function lensDisplacement(canvas: LensRect, strength: number): readonly [number, number] {
  if (!Number.isFinite(strength) || strength === 0 || !isUsableRect(canvas)) return [0, 0];
  return [strength * (canvas.height / canvas.width), -strength];
}

/**
 * Whether two windows differ enough to be worth acting on. The threshold is
 * about a texel of a 2048-wide snapshot, so per-frame float jitter in
 * `getBoundingClientRect` never arms a recapture while a real scroll always
 * does.
 */
export function lensWindowsDiffer(a: LensWindow, b: LensWindow, epsilon = 5e-4): boolean {
  return (
    Math.abs(a.offsetU - b.offsetU) > epsilon ||
    Math.abs(a.offsetV - b.offsetV) > epsilon ||
    Math.abs(a.scaleU - b.scaleU) > epsilon ||
    Math.abs(a.scaleV - b.scaleV) > epsilon
  );
}

export interface LensSchedulerOptions {
  /** Stillness required before a debounced capture fires. */
  readonly debounceMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Recapture policy: on host request, and once movement settles. Never per
 * frame, because a capture costs 10 to 150 ms of main thread.
 */
export interface LensScheduler extends Disposable {
  /** Host request: capture now, dropping any armed debounce. */
  now(): void;
  /** Movement seen: capture once it stops. Repeats push the deadline out. */
  soon(): void;
  readonly pending: boolean;
}

/** Default stillness window. Long enough to sit out a flick scroll. */
export const DEFAULT_LENS_DEBOUNCE_MS = 250;

export function createLensScheduler(
  capture: () => void,
  options: LensSchedulerOptions = {},
): LensScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_LENS_DEBOUNCE_MS;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let handle: unknown = null;
  let disposed = false;

  function disarm(): void {
    if (handle === null) return;
    clearTimer(handle);
    handle = null;
  }

  return {
    now(): void {
      if (disposed) return;
      disarm();
      capture();
    },
    soon(): void {
      if (disposed) return;
      disarm();
      handle = setTimer(() => {
        handle = null;
        if (disposed) return;
        capture();
      }, debounceMs);
    },
    get pending(): boolean {
      return handle !== null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disarm();
    },
  };
}
