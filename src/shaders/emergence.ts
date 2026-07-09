/**
 * Emergence / submergence geometry (dec.renderer-posture).
 *
 * v1 emergence is the cheap, deferred simulation: a world-space clipping plane
 * (the pool surface, fixed at the world origin) plus a root-group translation.
 * The heavy vertex surface-tension / ripple heightmap is explicitly DEFERRED.
 *
 * All mappings here are pure functions so they can be tested without any GPU
 * object. The bust local base sits at local Y=0 and spans `height` upward.
 */

/** Nominal bust height in world units (base at 0, head at +height). */
export const BUST_HEIGHT = 1.8;

/** Ramp time constant (seconds) for the eased transition toward target. */
export const RAMP_TAU = 0.3;

/**
 * Ease normalised progress p in [0,1] with a smoothstep curve.
 * Monotonic, eased(0)=0, eased(1)=1, eased(0.5)=0.5.
 */
export function easeEmergence(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return x * x * (3 - 2 * x);
}

/**
 * Root-group Y translation for a given emergence e in [0,1].
 *
 * At e=0 the root is fully submerged at -height; at e=1 it is settled at 0
 * (base sitting exactly on the world-origin waterline). Monotonic increasing.
 */
export function computeRootOffsetY(emergence: number, height: number = BUST_HEIGHT): number {
  const e = emergence < 0 ? 0 : emergence > 1 ? 1 : emergence;
  return -height * (1 - e);
}

/**
 * Clipping-plane constant for a given emergence.
 *
 * The pool surface is a world-space plane with normal (0,1,0). THREE.Plane
 * keeps fragments where normal.dot(point) + constant >= 0, so the waterline
 * world Y is -constant. The surface is fixed at the world origin (constant 0);
 * the bust rises through it via rootOffsetY. This is consistent with
 * computeRootOffsetY: at e=1 the settled base (rootOffsetY=0) rests exactly on
 * the waterline, and at e=0 the whole bust sits below it (fully submerged).
 */
export function computeClipConstant(_emergence: number, _height: number = BUST_HEIGHT): number {
  return 0;
}

/**
 * Fraction of the bust (by height) above the clip plane for a given root offset
 * and clip constant. Derived purely from geometry so tests can assert the
 * consistency invariant: visibleFraction(rootOffsetY(e), clipConstant(e)) === e.
 */
export function visibleFraction(
  rootOffsetY: number,
  clipConstant: number,
  height: number,
): number {
  const waterY = -clipConstant;
  const base = rootOffsetY;
  const top = rootOffsetY + height;
  const above = Math.max(0, top - Math.max(base, waterY));
  return above / height;
}
