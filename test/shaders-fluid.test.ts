import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createVFXEngine } from '../src/shaders';
import {
  FLUID_MODES,
  FLUID_PARTICIPANT_MODES,
  FLUID_CARRIER_CLAMP,
  FLUID_DRIVE_ACCEL,
  FLUID_REDUCED_DRIVE,
  FLUID_REST,
  FLUID_SOFT_EPS,
  FLUID_STATE_GAIN,
  fluidAccel,
  fluidBandWeight,
  fluidDisplacement,
  fluidDrive,
  fluidFaceWeight,
  fluidGravity,
  fluidHeightWeight,
  fluidIntegrate,
  fluidOmega,
  fluidReaction,
  fluidSoftRamp,
  fluidSqueezeTarget,
  fluidTargetAccel,
  fluidStateAmount,
  fluidSubsteps,
  type FluidState,
  type FluidVec3,
} from '../src/shaders/fluid';
import { buildSkinMaterial } from '../src/shaders/materials';
import type { BehaviorState, TextSkinEngine } from '../src/contracts';

const STATES: BehaviorState[] = [
  'hidden',
  'emerging',
  'idle',
  'listening',
  'speaking',
  'thinking',
  'reacting-to-scroll',
  'departing',
];

function fakeSkin(): TextSkinEngine {
  return {
    texture: new THREE.CanvasTexture(),
    get scrollOffset() {
      return 0;
    },
  } as unknown as TextSkinEngine;
}

/**
 * The single `Vector3`-valued uniform in a skin material's node graph, which
 * is the tier 3 flow vector. Reaching for the live node rather than rebuilding
 * a material is deliberate: the VFX engine writes bindings it minted, and a
 * material built beside one proves nothing about what the engine drives.
 */
function findVector3Uniform(material: unknown): { value: THREE.Vector3 } | null {
  const graph = (material as { positionNode?: { traverse(cb: (n: unknown) => void): void } })
    .positionNode;
  if (!graph) return null;
  let hit: { value: THREE.Vector3 } | null = null;
  graph.traverse((node) => {
    const value = (node as { value?: unknown }).value;
    if (hit === null && value instanceof THREE.Vector3) hit = node as { value: THREE.Vector3 };
  });
  return hit;
}

/** Settle the mode under a constant acceleration and return the final state. */
function settle(accel: FluidVec3, tension: number, seconds = 8): FluidState {
  let state = FLUID_REST;
  for (let t = 0; t < seconds; t += 1 / 60) {
    state = fluidIntegrate(state, accel, 1 / 60, tension);
  }
  return state;
}

describe('fluid modal solver (pure)', () => {
  it('settles at exactly the configured sag whatever the tension', () => {
    // The whole point of scaling gravity by the stiffness: `sag` is a distance
    // the host asked for, and `tension` must govern only how it gets there.
    for (const tension of [0, 0.25, 0.55, 1]) {
      const state = settle([0, -fluidGravity(0.05, tension), 0], tension);
      expect(state.offset[1], `tension ${tension}`).toBeCloseTo(-0.05, 4);
      expect(state.offset[0], `tension ${tension}`).toBeCloseTo(0, 6);
      expect(state.offset[2], `tension ${tension}`).toBeCloseTo(0, 6);
    }
  });

  it('rings rather than creeping: an impulse overshoots its own rest offset', () => {
    const tension = 0.3;
    const gravity = fluidGravity(0.05, tension);
    let state = FLUID_REST;
    let lowest = 0;
    for (let i = 0; i < 240; i++) {
      const accel: FluidVec3 = i < 4 ? [0, -gravity - 6, 0] : [0, -gravity, 0];
      state = fluidIntegrate(state, accel, 1 / 60, tension);
      lowest = Math.min(lowest, state.offset[1]);
    }
    expect(lowest).toBeLessThan(-0.05);
    expect(state.offset[1]).toBeCloseTo(-0.05, 3);
  });

  it('stays finite through a backgrounded-tab frame', () => {
    // A hidden tab hands back one enormous dt. An explicit spring integrated in
    // a single step of that size diverges; the substep cap is what stops it.
    let state = FLUID_REST;
    for (const dt of [120, 5, 0.5, 1 / 60]) {
      state = fluidIntegrate(state, [0, -fluidGravity(0.05, 1), 0], dt, 1);
      for (const v of [...state.offset, ...state.velocity]) expect(Number.isFinite(v)).toBe(true);
    }
    expect(Math.abs(state.offset[1])).toBeLessThan(1);
  });

  it('does not drift on a zero or non-finite frame', () => {
    const moving: FluidState = { offset: [0.1, -0.2, 0.05], velocity: [1, -2, 0.5] };
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fluidIntegrate(moving, [0, -1, 0], dt, 0.5)).toBe(moving);
      expect(fluidSubsteps(dt)).toBe(0);
    }
  });

  it('stiffness is the liquidity: a stiffer mode settles sooner', () => {
    const settleTime = (tension: number): number => {
      const gravity = fluidGravity(0.05, tension);
      let state = FLUID_REST;
      for (let i = 0; i < 2000; i++) {
        state = fluidIntegrate(state, [0, -gravity, 0], 1 / 240, tension);
        if (Math.abs(state.offset[1] + 0.05) < 1e-3 && Math.abs(state.velocity[1]) < 1e-3) {
          return i / 240;
        }
      }
      return Number.POSITIVE_INFINITY;
    };
    expect(settleTime(1)).toBeLessThan(settleTime(0));
    expect(fluidOmega(1)).toBeGreaterThan(fluidOmega(0));
  });
});

describe('fluid drive and gating (pure)', () => {
  it('damps reduced motion exactly once', () => {
    // Regression: damping in both `fluidDrive` and the VFX engine squared the
    // factor and left the reduced response at five per cent, not twenty-two.
    for (const v of [0.4, 1, 9]) {
      expect(fluidDrive(v, 0, true)).toBeCloseTo(fluidDrive(v, 0, false) * FLUID_REDUCED_DRIVE, 12);
    }
  });

  it('saturates rather than summing, and is sign-free', () => {
    expect(fluidDrive(100, 100)).toBe(1);
    expect(fluidDrive(-0.8, 0)).toBe(fluidDrive(0.8, 0));
    expect(fluidDrive(0, 0)).toBe(0);
  });

  it('amount 0 stays 0 in every behaviour state', () => {
    // The hard gate outranks the behaviour gain, or a departing head would
    // start flowing on a config that never asked for it.
    for (const state of STATES) {
      expect(fluidStateAmount(0, state), state).toBe(0);
      expect(FLUID_STATE_GAIN[state]).toBeGreaterThan(0);
    }
  });

  it('behaviour scales fluidity but never past 1', () => {
    expect(fluidStateAmount(0.4, 'departing')).toBeCloseTo(0.6, 6);
    expect(fluidStateAmount(0.4, 'speaking')).toBeCloseTo(0.34, 6);
    expect(fluidStateAmount(0.9, 'departing')).toBe(1);
    expect(fluidStateAmount(0.4, 'idle')).toBeCloseTo(0.4, 6);
  });

  it('clamps a teleporting carrier instead of flinging the surface', () => {
    const wild = fluidAccel(0, 0, 1, [1e6, -1e6, 1e6]);
    const bounded = fluidAccel(0, 0, 1, [FLUID_CARRIER_CLAMP, -FLUID_CARRIER_CLAMP, FLUID_CARRIER_CLAMP]);
    expect(wild).toEqual(bounded);
    for (const a of wild) expect(Number.isFinite(a)).toBe(true);
  });

  it('wobble gains the response and gravity is left alone by it', () => {
    const gravity = fluidGravity(0.05, 0.5);
    const still = fluidAccel(gravity, 0, 0, [0, 0, 0]);
    const driven = fluidAccel(gravity, 1, 2, [0, 0, 0]);
    expect(still[1]).toBeCloseTo(-gravity, 12);
    expect(driven[1]).toBeCloseTo(-gravity + FLUID_DRIVE_ACCEL * 2, 12);
  });
});

describe('fluid spatial field (pure)', () => {
  it('height weight is 1 at and below the waterline and decays upward', () => {
    expect(fluidHeightWeight(0, 0, 0.6)).toBe(1);
    expect(fluidHeightWeight(-2, 0, 0.6)).toBe(1);
    expect(fluidHeightWeight(0.6, 0, 0.6)).toBeCloseTo(Math.exp(-1), 12);
    expect(fluidHeightWeight(1.8, 0, 0.6)).toBeLessThan(0.06);
  });

  it('face weight refuses to flow where a feature mask claims the vertex', () => {
    expect(fluidFaceWeight(1, 2)).toBe(0);
    expect(fluidFaceWeight(0, 2)).toBe(1);
    // A higher `crisp` keeps more of a partially claimed vertex rigid.
    expect(fluidFaceWeight(0.5, 4)).toBeLessThan(fluidFaceWeight(0.5, 1));
  });

  it('displacement is outward-bounded, which is what protects the occlusion mask', () => {
    // The depth-only mask is a clone of the body at the undeformed pose, so a
    // shell that moved inward of it would be occluded by its own mask
    // (dec.liquid-glass-fluidity).
    const down: FluidVec3 = [0, -1, 0];
    for (const normal of [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0.6, 0.8, 0],
      [0, 0.7, -0.7],
    ] as FluidVec3[]) {
      expect(fluidDisplacement(1, 1, normal, down)).toBeGreaterThan(0);
    }
    // Facing into the flow: the surface piles up by the flow magnitude, plus
    // the ramp's own `eps^2 / 4` shoulder.
    const into = fluidDisplacement(1, 1, [0, -1, 0], down);
    expect(into).toBeGreaterThan(1);
    expect(into).toBeLessThan(1 + (FLUID_SOFT_EPS * FLUID_SOFT_EPS) / 2);
    // Facing away: as near untouched as a smooth one-sided ramp gets, and an
    // order of magnitude under the near side rather than merely smaller.
    const away = fluidDisplacement(1, 1, [0, 1, 0], down);
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThan(0.02);
  });

  it('the flow ramp is smooth through the contour, not creased', () => {
    // A hard `max(0, .)` has a kink at cos 0, and on the ears and jawline that
    // kink reads as faceting. The check is that the second difference stays
    // bounded across the crossing rather than spiking.
    const step = 0.01;
    let worst = 0;
    for (let c = -0.5; c <= 0.5; c += step) {
      const second =
        fluidSoftRamp(c + step) - 2 * fluidSoftRamp(c) + fluidSoftRamp(c - step);
      worst = Math.max(worst, Math.abs(second) / (step * step));
    }
    // Curvature peaks at 1/(2*eps) for this ramp; a hard clamp is unbounded.
    expect(worst).toBeLessThan(1 / FLUID_SOFT_EPS);
    expect(fluidSoftRamp(-10)).toBeGreaterThan(0);
    expect(fluidSoftRamp(10) - 10).toBeLessThan((FLUID_SOFT_EPS * FLUID_SOFT_EPS) / 2);
  });

  it('amount 0 zeroes the displacement whatever the flow and weight', () => {
    expect(fluidDisplacement(0, 1, [0, -1, 0], [0, -5, 0])).toBe(0);
  });

  it('a still body displaces exactly nothing', () => {
    expect(fluidDisplacement(1, 1, [0, -1, 0], [0, 0, 0])).toBe(0);
  });
});

describe('VFX fluid wiring', () => {
  it('leaves every fluid uniform at zero while the gate is shut', () => {
    const vfx = createVFXEngine();
    const skin = fakeSkin();
    vfx.createSkinMaterial(skin);
    vfx.setFluidDrive('departing', 1, [3, -2, 1]);
    for (let i = 0; i < 60; i++) vfx.update(1 / 60);

    const { uniforms } = buildSkinMaterial(skin, vfx.headConfig);
    expect(vfx.headConfig.fluid.amount).toBe(0);
    expect(uniforms.fluidAmount.value).toBe(0);
    expect(uniforms.fluidNormalGate.value).toBe(0);
    expect(uniforms.fluidFlow.value.lengthSq()).toBe(0);
    vfx.dispose();
  });

  it('drives the live flow uniform once the gate opens, and zeroes it again', () => {
    const vfx = createVFXEngine();
    const pair = vfx.createSkinMaterial(fakeSkin());
    // The engine writes the binding it minted, not a material built beside it,
    // so the probe has to be the node graph the engine is actually driving.
    // `fluidFlow` is the only Vector3 uniform in the position graph.
    const flow = findVector3Uniform(pair.front);
    expect(flow).not.toBeNull();
    expect(flow?.value.lengthSq()).toBe(0);

    vfx.setHeadConfig({ fluid: { amount: 1, sag: 0.05, wobble: 0 } });
    vfx.setFluidDrive('idle', 0, [0, 0, 0]);
    for (let i = 0; i < 480; i++) vfx.update(1 / 60);
    // Gravity alone: the mode settles at exactly the configured droop, pointing
    // down, so the shell bulges on its underside and nowhere else.
    expect(flow?.value.y).toBeCloseTo(-0.05, 4);
    expect(flow?.value.x).toBeCloseTo(0, 6);
    expect(flow?.value.z).toBeCloseTo(0, 6);

    // A sideways carrier drags the flow sideways: this is what a turned head
    // sloshing costs, and it is the reason the solver is three-dimensional.
    vfx.setHeadConfig({ fluid: { wobble: 1 } });
    vfx.setFluidDrive('idle', 0, [0.5, 0, 0]);
    for (let i = 0; i < 30; i++) vfx.update(1 / 60);
    expect(flow?.value.x).toBeLessThan(-1e-4);

    // Closing the gate is a hard stop, not a fade: the uniform is exactly 0.
    vfx.setHeadConfig({ fluid: { amount: 0 } });
    vfx.update(1 / 60);
    expect(flow?.value.lengthSq()).toBe(0);
    vfx.dispose();
  });

  it('ignores a non-finite drive rather than poisoning the solver', () => {
    const vfx = createVFXEngine();
    vfx.createSkinMaterial(fakeSkin());
    vfx.setHeadConfig({ fluid: { amount: 1 } });
    vfx.setFluidDrive('idle', Number.NaN, [Number.NaN, Number.POSITIVE_INFINITY, 0]);
    expect(() => {
      for (let i = 0; i < 30; i++) vfx.update(1 / 60);
    }).not.toThrow();
    vfx.dispose();
  });
});

describe('participant modal basis (pure)', () => {
  it('reserves a slot per participant beside the global mode', () => {
    // The basis exists so two obstacles facing each other can dent both
    // sides. One global mode would hold their mean, which is nothing.
    expect(FLUID_MODES).toBeGreaterThan(1);
    expect(FLUID_PARTICIPANT_MODES).toBe(FLUID_MODES - 1);
  });

  it('band weight peaks where the participant presses and dies away either side', () => {
    expect(fluidBandWeight(0.8, 0.8, 0.45)).toBe(1);
    // Symmetric, unlike the global mode's one-sided exponential: a
    // participant has body above it as well as below.
    expect(fluidBandWeight(0.8 + 0.3, 0.8, 0.45)).toBeCloseTo(
      fluidBandWeight(0.8 - 0.3, 0.8, 0.45),
      12,
    );
    expect(fluidBandWeight(2.5, 0.8, 0.45)).toBeLessThan(1e-4);
    // A zero band would divide by zero rather than mean "infinitely sharp".
    expect(Number.isFinite(fluidBandWeight(0.5, 0, 0))).toBe(true);
  });

  it('squeeze target scales the direction by the overlap and refuses negatives', () => {
    const target = fluidSqueezeTarget(0.2, 0.5, [-1, 0, 0]);
    expect(target).toEqual([-0.1, 0, 0]);
    expect(fluidSqueezeTarget(-3, 0.5, [-1, 0, 0])).toEqual([-0, 0, 0]);
    expect(fluidSqueezeTarget(0.2, -3, [-1, 0, 0])).toEqual([-0, 0, 0]);
  });

  it('settles a participant mode at exactly its target whatever the tension', () => {
    // Same contract as `fluidGravity`: the squeeze is a distance the host
    // asked for, and `tension` governs only how the mode gets there.
    for (const tension of [0, 0.35, 0.55, 1]) {
      const target: FluidVec3 = [-0.1, 0.04, 0];
      const state = settle(fluidTargetAccel(target, tension), tension, 12);
      expect(state.offset[0]).toBeCloseTo(target[0], 4);
      expect(state.offset[1]).toBeCloseTo(target[1], 4);
      expect(state.offset[2]).toBeCloseTo(target[2], 4);
    }
  });

  it('opposed participants dent both sides rather than cancelling', () => {
    // The reason the basis is not one summed mode. Two obstacles facing each
    // other carry opposite flow vectors; a normal on the left sees the left
    // mode and a normal on the right sees the right one, and both are
    // strictly positive because the ramp is one-sided.
    const left: FluidVec3 = [0.1, 0, 0];
    const right: FluidVec3 = [-0.1, 0, 0];
    const summed: FluidVec3 = [left[0] + right[0], 0, 0];
    expect(fluidDisplacement(1, 1, [1, 0, 0], summed)).toBe(0);
    const separate =
      fluidDisplacement(1, 1, [1, 0, 0], left) + fluidDisplacement(1, 1, [1, 0, 0], right);
    expect(separate).toBeGreaterThan(0.05);
  });

  it('reaction opposes the flow, flips the vertical axis and honours the cap', () => {
    // The body bulged left, so the obstacle that squeezed it is pushed right;
    // world Y is up and CSS Y is down, so the vertical term keeps its sign.
    const [x, y] = fluidReaction([-0.1, 0.05, 0], 300, 1, 1000);
    expect(x).toBeCloseTo(30, 6);
    expect(y).toBeCloseTo(15, 6);

    const capped = fluidReaction([-0.1, 0.05, 0], 300, 1, 10);
    expect(Math.hypot(capped[0], capped[1])).toBeCloseTo(10, 6);
    // Capping is a scale, not a clamp per axis: the direction survives.
    expect(capped[1] / capped[0]).toBeCloseTo(y / x, 6);

    // A zero gain is a hard off, not a small push.
    const off = fluidReaction([-0.1, 0.05, 0], 300, 0, 1000);
    expect(off[0]).toBe(0);
    expect(off[1]).toBe(0);
  });
});

describe('VFX participant wiring', () => {
  it('holds every participant mode at rest while the fluid gate is shut', () => {
    const vfx = createVFXEngine();
    vfx.createSkinMaterial(fakeSkin());
    // The stage is live by default: participants are the gate, not `amount`.
    expect(vfx.headConfig.stage.amount).toBe(1);
    vfx.setStageColliders([
      { bandY: 0.8, direction: [-1, 0, 0], overlap: 0.3, poolX: 0.4, poolHalfWidth: 0.2, submerged: 0 },
    ]);
    for (let i = 0; i < 60; i++) vfx.update(1 / 60);
    // `fluid.amount` ships at 0, and the reaction is Newton's third law on
    // the same interaction: a rigid head must not shove the page about.
    expect(Array.from(vfx.stageFlow)).toEqual(new Array(FLUID_PARTICIPANT_MODES * 3).fill(0));
    vfx.dispose();
  });

  it('drives one slot per collider and releases a slot the moment it clears', () => {
    const vfx = createVFXEngine();
    vfx.createSkinMaterial(fakeSkin());
    vfx.setHeadConfig({ fluid: { amount: 1, sag: 0, wobble: 0 } });
    vfx.setStageColliders([
      { bandY: 0.8, direction: [-1, 0, 0], overlap: 0.2, poolX: 0.4, poolHalfWidth: 0.2, submerged: 0 },
      { bandY: 0.4, direction: [1, 0, 0], overlap: 0.1, poolX: -0.4, poolHalfWidth: 0.2, submerged: 0 },
    ]);
    for (let i = 0; i < 600; i++) vfx.update(1 / 60);

    // Slot 0 settles at `overlap * squeeze` along its own direction, slot 1
    // at its own, and the third slot is untouched.
    expect(vfx.stageFlow[0]).toBeCloseTo(-0.2 * 0.5, 3);
    expect(vfx.stageFlow[3]).toBeCloseTo(0.1 * 0.5, 3);
    expect(vfx.stageFlow[6]).toBe(0);

    // Clearing is a release, not a decay: a participant that scrolled away
    // must not leave the body holding a dent with no visible cause.
    vfx.setStageColliders([]);
    vfx.update(1 / 60);
    expect(Array.from(vfx.stageFlow)).toEqual(new Array(FLUID_PARTICIPANT_MODES * 3).fill(0));
    vfx.dispose();
  });

  it('drops colliders past the slot count rather than folding them together', () => {
    const vfx = createVFXEngine();
    vfx.createSkinMaterial(fakeSkin());
    vfx.setHeadConfig({ fluid: { amount: 1, sag: 0, wobble: 0 } });
    const many = new Array(FLUID_PARTICIPANT_MODES + 3).fill(null).map(() => ({
      bandY: 0.5,
      direction: [-1, 0, 0] as const,
      overlap: 0.2,
      poolX: 0.4,
      poolHalfWidth: 0.2,
      submerged: 0,
    }));
    vfx.setStageColliders(many);
    for (let i = 0; i < 600; i++) vfx.update(1 / 60);
    expect(vfx.stageFlow.length).toBe(FLUID_PARTICIPANT_MODES * 3);
    for (let i = 0; i < FLUID_PARTICIPANT_MODES; i++) {
      expect(vfx.stageFlow[i * 3]).toBeCloseTo(-0.1, 3);
    }
    vfx.dispose();
  });
});
