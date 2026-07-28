/**
 * Melt maths (dec.liquid-glass-melt).
 *
 * The owner asked for a head that morphs "from a flat puddle, up into the
 * head". Tier 3's modal solver could not produce that at any setting, and a
 * particle field is not needed for it: a flattened closed surface is still a
 * closed surface, so the shape change is a displacement on the real bust.
 *
 * The map is deliberately a function of bind-space `y` alone. That is what
 * makes its Jacobian triangular and its inverse transpose closed form, so the
 * shading normal is exact rather than a finite difference, and it is what makes
 * `amount = 0` an exact identity rather than an approximate one.
 *
 * Pure: no three, no GPU. The TSL in `materials.ts` mirrors these formulae, and
 * the tests pin them.
 */

/** Three components, bind space, world units. Plain tuples: no allocation churn. */
export type MeltVec3 = readonly [number, number, number];

/**
 * Crown lag: how far behind the base the top of the head melts, as a fraction
 * of the sweep. At 0 every height collapses together, which reads as the head
 * shrinking. At 0.55 the base has pooled before the crown has started, which is
 * what makes it read as flowing downward.
 */
export const MELT_LAG = 0.55;

/**
 * Radial spread at the crown when fully melted, as a multiple of the bind
 * radius. The puddle has to be wider than the head was or the collapse reads as
 * a shrink rather than as a spill. Not volume conserving: this is a look
 * control (dec.liquid-glass-melt, Consequences).
 */
export const MELT_SPREAD = 1.6;

/**
 * Puddle thickness as a fraction of the bust's bind height: the height above
 * the base of the plane the fully melted body collapses onto.
 *
 * Not zero. At 0 the body lands exactly on the base plane, and the vertical
 * Jacobian and the shell's own thickness go with it.
 */
export const MELT_FLOOR = 0.06;

/**
 * Floor on the vertical Jacobian before dividing by it. At full melt `g'`
 * reaches exactly 0, and an unguarded divide puts an infinity in the normal,
 * which reaches the fresnel, which reaches the alpha, and collapses the
 * silhouette. That exact failure is recorded in `materials.ts`.
 */
export const MELT_MIN_JACOBIAN = 1e-4;

function saturate(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Normalised bind height, 0 at the base of the bust, 1 at the crown. */
export function meltHeight(y: number, minY: number, maxY: number): number {
  const extent = maxY - minY;
  if (!(extent > 0)) return 0;
  return saturate((y - minY) / extent);
}

/**
 * Per-vertex melt progress. The base runs ahead of the crown by `lag`, so the
 * head pools from below instead of deflating uniformly.
 *
 * `amount` is scaled by `1 + lag` so that `amount = 1` still saturates every
 * height: without it the crown would stop short of the floor.
 */
export function meltProgress(amount: number, h: number, lag: number): number {
  return saturate(saturate(amount) * (1 + lag) - lag * saturate(h));
}

/**
 * Vertical collapse target and radial scale at bind-space height `y`.
 *
 * `y' = y + mi * (target - y)` and `scale = 1 + spread * mi * h`, applied to x
 * and z. At `amount = 0` this returns `y` and exactly 1.
 */
export function meltCollapse(
  y: number,
  minY: number,
  maxY: number,
  amount: number,
  lag: number,
  floor: number,
  spread: number,
): { readonly y: number; readonly scale: number } {
  const extent = maxY - minY;
  if (!(extent > 0)) return { y, scale: 1 };
  const h = meltHeight(y, minY, maxY);
  const mi = meltProgress(amount, h, lag);
  const target = minY + floor * extent;
  return {
    y: y + mi * (target - y),
    scale: 1 + spread * mi * h,
  };
}

/**
 * The melted shading normal, unit length.
 *
 * Displacing `positionNode` does not update normals
 * (dec.liquid-glass-architecture, Consequences), and this displacement is not a
 * scalar along the vertex normal, so it cannot reuse the surface gradient path
 * the breathe and fluid terms share. It needs the inverse transpose of its own
 * Jacobian.
 *
 * For `x' = x·s(y)`, `y' = g(y)`, `z' = z·s(y)` the Jacobian is triangular and
 * the transformed normal, before normalising and after multiplying through by
 * the common factor `s`, is
 *
 * ```
 * n' = ( n.x,  ( s·n.y - s'·(x·n.x + z·n.z) ) / g',  n.z )
 * ```
 *
 * At `amount = 0` every term collapses: `s = 1`, `s' = 0`, `g' = 1`, and the
 * input normal comes back unchanged.
 */
export function meltNormal(
  position: MeltVec3,
  normal: MeltVec3,
  minY: number,
  maxY: number,
  amount: number,
  lag: number,
  floor: number,
  spread: number,
): MeltVec3 {
  const extent = maxY - minY;
  if (!(extent > 0)) return normal;
  // Exact, not approximate: at 0 the transform is the identity and even the
  // renormalisation below would move the last bits of a unit vector. The gate
  // in the shader bypasses the chain at 0 for the same reason.
  if (!(amount > 0)) return normal;

  const [x, y, z] = position;
  const [nx, ny, nz] = normal;

  const h = meltHeight(y, minY, maxY);
  const raw = saturate(amount) * (1 + lag) - lag * h;
  const mi = saturate(raw);
  const target = minY + floor * extent;

  // `mi` is a clamp, so its derivative is the interior slope inside the band
  // and zero on either shoulder. `h` is clamped too, but its interior slope is
  // used throughout: the crown and base vertices sit exactly on the clamp, and
  // giving them a zero gradient while their neighbours have a finite one would
  // put a seam at the poles.
  const dmi = raw > 0 && raw < 1 ? -lag / extent : 0;

  const s = 1 + spread * mi * h;
  const sPrime = spread * (dmi * h + mi / extent);
  const gPrime = 1 - mi + dmi * (target - y);

  const denom = Math.max(gPrime, MELT_MIN_JACOBIAN);
  const my = (s * ny - sPrime * (x * nx + z * nz)) / denom;

  const length = Math.hypot(nx, my, nz);
  if (!(length > 0)) return normal;
  return [nx / length, my / length, nz / length];
}
