/**
 * Tier 3 fluidity maths (dec.liquid-glass-fluidity).
 *
 * Everything the fluidity knob needs that is not a GPU object lives here: the
 * damped modal solver whose displacement vector is the flow direction, the
 * drive that turns scroll and emergence speed into an impulse, the behaviour
 * gain that makes a departing head more molten than a speaking one, and the
 * spatial weight that keeps the flow in the base and out of the face.
 *
 * The shader in `materials.ts` is the same arithmetic expressed in TSL, so the
 * constants here are the ones it consumes. Keeping the solver in plain
 * TypeScript is what lets its rest state, its stability and its identity at
 * `amount = 0` be tests rather than assertions about a shader nobody can run
 * under happy-dom, and it is why tier 3 needs no compute pass and no WebGL2
 * fallback (dec.liquid-glass-fluidity, Rationale).
 */

import type { BehaviorState } from '../contracts';

/** Three components, bind space, world units. Plain tuples: no allocation churn. */
export type FluidVec3 = readonly [number, number, number];

/**
 * Solver state: the dominant sloshing mode of a body bound to its rest pose.
 * `offset` is the flow vector the shader reads; `velocity` is its rate.
 */
export interface FluidState {
  readonly offset: FluidVec3;
  readonly velocity: FluidVec3;
}

/** Undisturbed solver state. A fresh head is not mid-wobble. */
export const FLUID_REST: FluidState = Object.freeze({
  offset: Object.freeze([0, 0, 0]) as FluidVec3,
  velocity: Object.freeze([0, 0, 0]) as FluidVec3,
});

/**
 * Angular frequency at `tension = 0`, rad/s. Slack: a full wallow takes about
 * 1.4 s, which is the slowest the body can move and still read as liquid
 * rather than as a bug in the rig.
 */
export const FLUID_OMEGA_SLACK = 4.5;

/**
 * Angular frequency at `tension = 1`, rad/s. Stiff: the surface twitches and
 * settles inside a couple of frames, which is a solid with a skin on it.
 */
export const FLUID_OMEGA_STIFF = 26;

/**
 * Damping ratio, fixed. Under 1 so the surface rings rather than creeping back,
 * and well under 1/sqrt(2) so a scroll impulse produces a visible second swing.
 */
export const FLUID_DAMPING_RATIO = 0.34;

/**
 * Largest integration step, seconds. A backgrounded tab hands back one enormous
 * `dt`, and an explicit spring integrated in one 2 s step diverges. Substepping
 * to 1/120 s keeps `omega * dt` under 0.22 even at the stiff end.
 */
export const FLUID_MAX_STEP = 1 / 120;

/**
 * Hard cap on substeps per rendered frame. Past this the solver stops chasing
 * wall-clock time, which is the right trade: a tab that was hidden for a minute
 * should resume from where it was, not spend a frame catching up.
 */
export const FLUID_MAX_SUBSTEPS = 8;

/** Scroll speed, in progress units per second, that saturates the drive. */
export const FLUID_SCROLL_SCALE = 1.6;

/** Emergence speed, in progress units per second, that saturates the drive. */
export const FLUID_EMERGENCE_SCALE = 2.2;

/**
 * Share of the drive that survives `prefers-reduced-motion`. Matches the pool's
 * `REDUCED_DRIVE`: the library damps motion rather than freezing it, and a head
 * that visibly rises out of a pool while its own surface is rigid reads worse
 * than a gentle one.
 */
export const FLUID_REDUCED_DRIVE = 0.22;

/**
 * Vertical acceleration injected per unit of saturated drive, world units per
 * second squared, before the `wobble` gain. Sized so that `wobble = 1` and a
 * hard scroll produce a swing comparable to the rest sag.
 */
export const FLUID_DRIVE_ACCEL = 3.2;

/**
 * Viscous coupling to the carrier: the liquid is dragged by the bone it hangs
 * off, so the container's velocity enters as an acceleration on the flow. This
 * is what makes a turned head slosh sideways rather than only up and down.
 */
export const FLUID_CARRIER_DRAG = 9;

/**
 * Largest carrier speed that still couples, world units per second. A rig
 * teleported by a replaced avatar or a resized canvas must not fling the
 * surface across the room.
 */
export const FLUID_CARRIER_CLAMP = 4;

/**
 * How molten each behaviour state is, as a multiplier on the configured
 * `amount` (dec.liquid-glass-fluidity). Departing and hidden are the melt: the
 * body is leaving, and going slack as it goes is the point. Speaking is the
 * one state that tightens, because a wobbling jawline during visemes reads as
 * a rig fault even though the mouth itself never moves.
 */
export const FLUID_STATE_GAIN: Readonly<Record<BehaviorState, number>> = Object.freeze({
  hidden: 1.5,
  emerging: 1.25,
  idle: 1,
  listening: 1,
  speaking: 0.85,
  thinking: 1.08,
  'reacting-to-scroll': 1.15,
  departing: 1.5,
});

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Angular frequency of the mode. Stiffness is the liquidity. */
export function fluidOmega(tension: number): number {
  const t = clamp01(tension);
  return FLUID_OMEGA_SLACK + (FLUID_OMEGA_STIFF - FLUID_OMEGA_SLACK) * t;
}

/**
 * Downward acceleration that settles the mode at exactly `sag` world units of
 * droop. Scaling gravity by the stiffness is what decouples the two knobs: at
 * equilibrium `omega^2 * x = g`, so `g = sag * omega^2` puts the rest offset at
 * `-sag` whatever the tension, and tension then governs only the wobble about
 * that droop.
 */
export function fluidGravity(sag: number, tension: number): number {
  const omega = fluidOmega(tension);
  return Math.max(0, sag) * omega * omega;
}

/**
 * Impulse drive in [0,1] from the two page-side speeds tier 1 already couples
 * to. Both are speeds, so both are sign-free, and they saturate rather than
 * summing past 1.
 */
export function fluidDrive(
  scrollVelocity: number,
  emergenceVelocity: number,
  reduced = false,
): number {
  const scroll = Math.abs(scrollVelocity) / FLUID_SCROLL_SCALE;
  const emergence = Math.abs(emergenceVelocity) / FLUID_EMERGENCE_SCALE;
  const raw = clamp01(Math.max(scroll, emergence));
  return reduced ? raw * FLUID_REDUCED_DRIVE : raw;
}

/**
 * Effective fluidity from the configured amount and the behaviour state. The
 * multiplier can only scale what the host asked for, so `amount = 0` stays 0
 * in every state and the hard gate survives (dec.liquid-glass-fluidity).
 */
export function fluidStateAmount(amount: number, state: BehaviorState): number {
  return clamp01(clamp01(amount) * FLUID_STATE_GAIN[state]);
}

/**
 * External acceleration on the mode for one frame: gravity, the saturated
 * page drive along the vertical, and viscous drag from the carrier bone's own
 * velocity. Returned as a tuple rather than written into a scratch vector so
 * the function stays pure and testable.
 */
export function fluidAccel(
  gravity: number,
  drive: number,
  wobble: number,
  carrierVelocity: FluidVec3,
): FluidVec3 {
  const gain = Math.max(0, wobble);
  const clamp = (v: number): number =>
    v > FLUID_CARRIER_CLAMP ? FLUID_CARRIER_CLAMP : v < -FLUID_CARRIER_CLAMP ? -FLUID_CARRIER_CLAMP : v;
  const drag = FLUID_CARRIER_DRAG * gain;
  return [
    -clamp(carrierVelocity[0]) * drag,
    -gravity - clamp(carrierVelocity[1]) * drag + FLUID_DRIVE_ACCEL * gain * clamp01(drive),
    -clamp(carrierVelocity[2]) * drag,
  ];
}

/** Substeps to run for a rendered frame of `dt` seconds. Never negative. */
export function fluidSubsteps(dt: number, maxStep: number = FLUID_MAX_STEP): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(FLUID_MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / maxStep)));
}

/**
 * Integrate the mode over `dt` seconds with semi-implicit Euler, substepped for
 * stability. Pure: the caller keeps the state, which is what lets a test drive
 * a hundred frames with a fixed clock and assert the rest offset.
 */
export function fluidIntegrate(
  state: FluidState,
  accel: FluidVec3,
  dt: number,
  tension: number,
): FluidState {
  const steps = fluidSubsteps(dt);
  if (steps === 0) return state;
  const omega = fluidOmega(tension);
  const k = omega * omega;
  const c = 2 * FLUID_DAMPING_RATIO * omega;
  const h = Math.min(dt, FLUID_MAX_STEP * FLUID_MAX_SUBSTEPS) / steps;

  let [x0, x1, x2] = state.offset;
  let [v0, v1, v2] = state.velocity;
  for (let i = 0; i < steps; i++) {
    v0 += (accel[0] - k * x0 - c * v0) * h;
    v1 += (accel[1] - k * x1 - c * v1) * h;
    v2 += (accel[2] - k * x2 - c * v2) * h;
    x0 += v0 * h;
    x1 += v1 * h;
    x2 += v2 * h;
  }
  return { offset: [x0, x1, x2], velocity: [v0, v1, v2] };
}

/**
 * Height weight: 1 at the waterline, decaying upward over `reach`. Below the
 * waterline it saturates at 1, because everything down there is submerged and
 * is the part that should flow most.
 */
export function fluidHeightWeight(y: number, waterY: number, reach: number): number {
  const above = Math.max(0, y - waterY);
  return Math.exp(-above / Math.max(1e-4, reach));
}

/**
 * Face weight: the six baked feature masks, reused rather than re-baked
 * (dec.liquid-glass-fluidity). `maskMax` is the strongest feature claim on the
 * vertex; `crisp` sharpens how hard those regions refuse to flow.
 */
export function fluidFaceWeight(maskMax: number, crisp: number): number {
  return (1 - clamp01(maskMax)) ** Math.max(0, crisp);
}

/**
 * Angular softness of the one-sided flow test, in cosine units. A hard
 * `max(0, dot(N, F))` creases along the contour where the surface turns away
 * from the flow, and on a mesh with real detail (the ears and the jawline on
 * the shipped bust) that crease reads as faceting rather than as liquid.
 * Softening it in cosine space keeps the soft band the same angular width
 * whatever the flow magnitude.
 */
export const FLUID_SOFT_EPS = 0.18;

/**
 * One-sided smooth ramp: `0.5 * (c + sqrt(c^2 + eps^2))`. Strictly positive
 * for every input, so the outward bound the occlusion mask depends on holds
 * exactly, and smooth everywhere, so the contour does not crease.
 */
export function fluidSoftRamp(cosine: number, eps: number = FLUID_SOFT_EPS): number {
  return 0.5 * (cosine + Math.sqrt(cosine * cosine + eps * eps));
}

/**
 * The scalar displacement the shader applies along the vertex normal, in world
 * units. One-sided in `dot(normal, flow)`, which is what keeps the shell from
 * ever moving inward of the depth-only occlusion mask
 * (dec.liquid-glass-fluidity, Context). `normal` is assumed unit length, as
 * every glTF normal is.
 */
export function fluidDisplacement(
  amount: number,
  weight: number,
  normal: FluidVec3,
  flow: FluidVec3,
): number {
  const length = Math.hypot(flow[0], flow[1], flow[2]);
  // A still body displaces exactly nothing, which is what makes the gate at
  // `amount = 0` an identity rather than an epsilon.
  if (length === 0) return 0;
  const cosine = (normal[0] * flow[0] + normal[1] * flow[1] + normal[2] * flow[2]) / length;
  return clamp01(amount) * weight * fluidSoftRamp(cosine) * length;
}

// ---------------------------------------------------------------------------
// Modal basis (dec.liquid-glass-participants)
// ---------------------------------------------------------------------------

/**
 * Size of the modal basis. Mode 0 is the global mode tier 3 shipped with:
 * gravity, the page drive and the carrier drag all act on it, and its spatial
 * weight is `fluidHeightWeight`, so a head with no participants is bit for bit
 * the head `dec.liquid-glass-fluidity` describes.
 *
 * The remaining modes are participant slots. They exist because one global
 * mode cannot squeeze against a page element on one side only: two obstacles
 * facing each other produce opposite flow vectors, and summing them into one
 * mode cancels rather than denting both sides. Kept small deliberately, since
 * every slot is three uniforms and an unrolled term in the vertex graph.
 */
export const FLUID_MODES = 4;

/** Participant slots in the basis: everything but the global mode. */
export const FLUID_PARTICIPANT_MODES = FLUID_MODES - 1;

/**
 * Spatial weight of a participant mode: a Gaussian band centred on the height
 * the participant acts at. Gaussian rather than the exponential decay mode 0
 * uses, because a participant is a local event with a body above AND below it,
 * whereas gravity only ever acts downward from the waterline.
 */
export function fluidBandWeight(y: number, centre: number, band: number): number {
  const d = (y - centre) / Math.max(1e-4, band);
  return Math.exp(-d * d);
}

/**
 * Flow a squeezing participant holds the body at, world units. `direction` is
 * the way the liquid piles, which is from the obstacle toward the body axis,
 * and is assumed unit length.
 */
export function fluidSqueezeTarget(
  overlap: number,
  squeeze: number,
  direction: FluidVec3,
): FluidVec3 {
  const scale = Math.max(0, overlap) * Math.max(0, squeeze);
  return [direction[0] * scale, direction[1] * scale, direction[2] * scale];
}

/**
 * Acceleration that settles a mode at exactly `target`. Same trick as
 * `fluidGravity`, and for the same reason: at equilibrium `omega^2 * x = a`,
 * so scaling by the stiffness makes the resting squeeze independent of
 * `tension` and leaves tension governing only the wobble about it.
 */
export function fluidTargetAccel(target: FluidVec3, tension: number): FluidVec3 {
  const omega = fluidOmega(tension);
  const k = omega * omega;
  return [target[0] * k, target[1] * k, target[2] * k];
}

/**
 * Newton's third law, in CSS pixels. The body bulged along `flow`, so the
 * participant that squeezed it is pushed the other way, converted through the
 * canvas scale and capped so page furniture stays where a reader can find it.
 *
 * World Y is up and CSS Y is down, so the vertical term keeps its sign while
 * the horizontal one flips.
 */
export function fluidReaction(
  flow: FluidVec3,
  pixelsPerWorldUnit: number,
  gain: number,
  maxPixels: number,
): readonly [number, number] {
  const scale = Math.max(0, gain) * Math.max(0, pixelsPerWorldUnit);
  let x = -flow[0] * scale;
  let y = flow[1] * scale;
  const cap = Math.max(0, maxPixels);
  const length = Math.hypot(x, y);
  if (length > cap && length > 0) {
    const k = cap / length;
    x *= k;
    y *= k;
  }
  return [x, y];
}
