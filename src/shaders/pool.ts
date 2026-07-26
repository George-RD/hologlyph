/**
 * Tier 1 pool maths (dec.liquid-glass-architecture, item 3).
 *
 * Everything the pool needs that is not a GPU object lives here: the wave
 * update the height-field shader runs, the drive that turns scroll and
 * emergence motion into ring impulses, the radial profile of the bust that
 * says where the body crosses the waterline, and the analytic meniscus and
 * contact ring drawn around that contour.
 *
 * The shader in `pool-surface.ts` is the same arithmetic expressed in TSL, so
 * the constants here are the ones it consumes. Keeping the reference update in
 * plain TypeScript is what lets the stability bound be a test rather than an
 * assertion about a shader nobody can run under happy-dom.
 */

/** Height-field resolution, one texel per cell, square. */
export const POOL_RESOLUTION = 256;

/** Side length of the simulated surface in world units. */
export const POOL_EXTENT = 6;

/** Plane subdivisions per side for the rendered surface. */
export const POOL_SEGMENTS = 192;

/** Slices used when sampling the bust's radial profile. */
export const PROFILE_SLICES = 48;

/**
 * Wave speed in cells per step. The five-point Laplacian is stable while
 * `speed^2 <= 0.5` in two dimensions, and `poolWaveStep` is only ever driven
 * at this value; `test/shaders-pool.test.ts` pins the bound by iterating an
 * impulse to a thousand steps and asserting the field stays finite and decays.
 */
export const WAVE_SPEED = 0.62;

/** Per-step velocity damping. Small: the surface should ring, not thud. */
export const WAVE_DAMPING = 0.012;

/** Fixed simulation rate, decoupled from the render frame rate. */
export const SIM_HZ = 60;

/**
 * Hard cap on simulation steps per rendered frame. A backgrounded tab or a
 * long asset decode hands us a multi-second `dt`; without the cap that single
 * frame runs thousands of steps and stalls the GPU far worse than the dropped
 * simulation time it is trying to recover.
 */
export const MAX_SIM_STEPS = 4;

/** Impulse decay time constant, seconds. */
export const RIPPLE_TAU = 0.14;

/** Scroll speed, in progress units per second, that saturates the drive. */
export const SCROLL_DRIVE_SCALE = 1.6;

/** Emergence speed, in progress units per second, that saturates the drive. */
export const EMERGENCE_DRIVE_SCALE = 2.2;

/**
 * Share of the drive that survives `prefers-reduced-motion`. Not zero: a dead
 * flat pool under a head that is visibly rising reads as a bug rather than as
 * a preference, and the rest of the library damps rather than disables.
 */
export const REDUCED_DRIVE = 0.22;

/**
 * One step of the damped wave equation, per cell.
 *
 * `h` is the current height, `hPrev` the height one step ago, `laplacian` the
 * five-point stencil sum `(N + S + E + W) - 4h`. Returns the next height.
 */
export function poolWaveStep(
  h: number,
  hPrev: number,
  laplacian: number,
  speed: number = WAVE_SPEED,
  damping: number = WAVE_DAMPING,
): number {
  const velocity = h - hPrev;
  return h + velocity * (1 - damping) + speed * speed * laplacian;
}

/**
 * Number of fixed simulation steps to run for a rendered frame of `dt`
 * seconds, clamped to `MAX_SIM_STEPS`. Never negative, never fractional.
 */
export function poolSimulationSteps(dt: number, hz: number = SIM_HZ): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const steps = Math.floor(dt * hz);
  return steps > MAX_SIM_STEPS ? MAX_SIM_STEPS : steps;
}

/**
 * Ring-impulse drive in [0,1] from the two things tier 1 couples to: how fast
 * the page is scrolling and how fast the bust is crossing the waterline. Both
 * are speeds, so both are sign-free, and they saturate rather than sum past 1.
 */
export function poolRippleDrive(
  scrollVelocity: number,
  emergenceVelocity: number,
  reduced = false,
): number {
  const scroll = Math.abs(scrollVelocity) / SCROLL_DRIVE_SCALE;
  const emergence = Math.abs(emergenceVelocity) / EMERGENCE_DRIVE_SCALE;
  const raw = scroll + emergence;
  const drive = raw > 1 ? 1 : raw;
  return reduced ? drive * REDUCED_DRIVE : drive;
}

/**
 * Exponential decay of a held impulse amplitude over `dt` seconds. The
 * simulation injects the ring every step while the amplitude is alive, so the
 * splash has a body rather than being a single-frame click.
 */
export function poolImpulseDecay(amplitude: number, dt: number, tau: number = RIPPLE_TAU): number {
  if (!(amplitude > 0)) return 0;
  if (!Number.isFinite(dt) || dt <= 0) return amplitude;
  const next = amplitude * Math.exp(-dt / tau);
  return next < 1e-4 ? 0 : next;
}

/**
 * Maximum radius of the body about the Y axis, sliced by height. This is what
 * says how wide the hole in the water is at any emergence, and it is measured
 * from the avatar rather than assumed so a replacement bust is not silently
 * given the shipped bust's waterline.
 */
export interface PoolProfile {
  readonly minY: number;
  readonly maxY: number;
  /** Max radius per slice, low to high; `radii.length` slices span minY..maxY. */
  readonly radii: Float32Array;
}

/**
 * Build the radial profile from a flat XYZ position buffer in bind space.
 *
 * Empty or degenerate input yields a single-slice zero profile rather than
 * throwing: the pool is decoration and must never be able to fail an avatar
 * load (degrade, do not throw).
 */
export function poolRadialProfile(
  positions: ArrayLike<number>,
  slices: number = PROFILE_SLICES,
): PoolProfile {
  const count = Math.floor(positions.length / 3);
  const n = Math.max(1, Math.floor(slices));
  if (count === 0) {
    return { minY: 0, maxY: 0, radii: new Float32Array(1) };
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1] as number;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxY > minY)) {
    // A flat slab has no profile to speak of; report its one radius everywhere.
    let radius = 0;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] as number;
      const z = positions[i * 3 + 2] as number;
      const r = Math.sqrt(x * x + z * z);
      if (r > radius) radius = r;
    }
    return { minY, maxY: minY, radii: Float32Array.of(radius) };
  }

  const radii = new Float32Array(n);
  const span = maxY - minY;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    let slice = Math.floor(((y - minY) / span) * n);
    if (slice >= n) slice = n - 1;
    if (slice < 0) slice = 0;
    const r = Math.sqrt(x * x + z * z);
    if (r > (radii[slice] as number)) radii[slice] = r;
  }
  // A slice with no vertices in it would punch a hole in the contour, so carry
  // the last populated radius forward rather than reporting zero width.
  let carried = 0;
  for (let i = 0; i < n; i++) {
    if ((radii[i] as number) > 0) carried = radii[i] as number;
    else radii[i] = carried;
  }
  return { minY, maxY, radii };
}

/** Linearly interpolated profile radius at bind-space height `y`. */
export function poolProfileRadiusAt(profile: PoolProfile, y: number): number {
  const { minY, maxY, radii } = profile;
  const n = radii.length;
  if (n === 0) return 0;
  if (n === 1 || !(maxY > minY)) return radii[0] as number;
  // Sample at slice centres, so the first and last half-slice clamp.
  const t = ((y - minY) / (maxY - minY)) * n - 0.5;
  if (t <= 0) return radii[0] as number;
  if (t >= n - 1) return radii[n - 1] as number;
  const i = Math.floor(t);
  const f = t - i;
  const a = radii[i] as number;
  const b = radii[i + 1] as number;
  return a + (b - a) * f;
}

/**
 * Radius of the hole the body makes in the water, given the root offset the
 * emergence ramp is currently applying.
 *
 * The waterline is world Y 0 and the root is translated by `rootOffsetY`, so
 * the bind-space height that sits at the waterline is `-rootOffsetY`.
 *
 * At or above the top of the body there is no crossing and therefore no hole.
 * That case is not academic: `poolProfileRadiusAt` clamps to the topmost
 * slice, so without this the water keeps a head-sized hole in it after the
 * bust has fully submerged, and you watch a black ellipse float on the
 * surface. The bound is inclusive because full submersion puts the waterline
 * at exactly `BUST_HEIGHT`, which is exactly `maxY` on a rig authored to it.
 */
export function poolWaterlineRadius(profile: PoolProfile, rootOffsetY: number): number {
  const y = -rootOffsetY;
  if (y >= profile.maxY) return 0;
  return poolProfileRadiusAt(profile, y);
}

/**
 * Analytic meniscus, normalised to 1 at the contact contour and decaying
 * outward over `width`. Inside the contour there is no water, so the caller
 * discards those fragments; the profile is still defined there and saturates.
 */
export function poolMeniscusLift(distance: number, radius: number, width: number): number {
  if (!(width > 0)) return distance <= radius ? 1 : 0;
  const outward = distance - radius;
  if (outward <= 0) return 1;
  return Math.exp(-outward / width);
}

/**
 * Bright contact ring at the contour: a Gaussian centred on the intersection,
 * which is where a real waterline catches the light.
 */
export function poolContactRing(distance: number, radius: number, width: number): number {
  if (!(width > 0)) return distance === radius ? 1 : 0;
  const t = (distance - radius) / width;
  return Math.exp(-t * t);
}
