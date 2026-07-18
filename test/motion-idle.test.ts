import { describe, it, expect } from 'vitest';
import { createMotionEngine } from '../src/motion';
import { IdleController } from '../src/motion/idle';
import { clamp01 } from '../src/contracts';
import type { LoadedAvatar } from '../src/contracts';
import * as THREE from 'three';

/** Deterministic LCG so blink statistics are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Test avatar whose bones are always present, so no non-null assertions. */
interface TestAvatar extends LoadedAvatar {
  bones: { head: THREE.Bone; neck: THREE.Bone; eyeL: THREE.Bone; eyeR: THREE.Bone };
}

function makeAvatar(): TestAvatar {
  const root = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'head';
  const neck = new THREE.Bone();
  neck.name = 'neck';
  const eyeL = new THREE.Bone();
  eyeL.name = 'eye_l';
  const eyeR = new THREE.Bone();
  eyeR.name = 'eye_r';
  const morphStore: Record<string, number> = {};
  return {
    root,
    morphMeshes: [],
    animations: [],
    bones: { head, neck, eyeL, eyeR },
    setMorph(name: string, w: number) {
      morphStore[name] = clamp01(w);
    },
    getMorph(name: string) {
      return morphStore[name] ?? 0;
    },
    dispose() {},
  };
}

interface PoseExtent {
  maxPitch: number;
  maxYaw: number;
  maxRoll: number;
  maxBlink: number;
  blinked: boolean;
}

/** Run a controller over a window and return the extrema of its pose. */
function samplePose(c: IdleController, seconds: number, speaking = false): PoseExtent {
  const dt = 1 / 60;
  let now = 0;
  let maxPitch = 0;
  let maxYaw = 0;
  let maxRoll = 0;
  let maxBlink = 0;
  let blinked = false;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    now += dt;
    const p = c.update(dt, now, speaking);
    maxPitch = Math.max(maxPitch, Math.abs(p.pitch));
    maxYaw = Math.max(maxYaw, Math.abs(p.yaw));
    maxRoll = Math.max(maxRoll, Math.abs(p.roll));
    maxBlink = Math.max(maxBlink, p.blink);
    if (p.blink > 0.5) blinked = true;
  }
  return { maxPitch, maxYaw, maxRoll, maxBlink, blinked };
}

describe('idle amplitude bounds', () => {
  it('keeps head motion and blink within bounded ranges', () => {
    const c = new IdleController({ rng: lcg(12345) });
    const s = samplePose(c, 60);
    expect(s.maxPitch).toBeLessThan(0.06);
    expect(s.maxYaw).toBeLessThan(0.035);
    expect(s.maxRoll).toBeLessThan(0.07);
    expect(s.maxBlink).toBeLessThanOrEqual(1);
    expect(s.maxBlink).toBeGreaterThanOrEqual(0);
    expect(s.blinked).toBe(true); // blinks actually occur
  });
});

describe('idle blink scheduling', () => {
  it('produces a Poisson-like blink count over simulated time', () => {
    const c = new IdleController({ rng: lcg(777), blinkMean: 4 });
    const dt = 1 / 60;
    const seconds = 180;
    const steps = Math.round(seconds / dt);
    let now = 0;
    let prev = 0;
    let count = 0;
    for (let i = 0; i < steps; i++) {
      now += dt;
      const p = c.update(dt, now, false);
      if (prev < 0.5 && p.blink >= 0.5) count++;
      prev = p.blink;
    }
    // Expected ~180/4 = 45; allow a wide deterministic window.
    expect(count).toBeGreaterThan(25);
    expect(count).toBeLessThan(65);
  });
});

describe('idle reduced-motion damping', () => {
  it('damps head amplitudes under reduced motion', () => {
    const seed = 42;
    const normalS = samplePose(new IdleController({ rng: lcg(seed) }), 60);
    const reducedCtrl = new IdleController({ rng: lcg(seed) });
    reducedCtrl.setReduced(true);
    const reducedS = samplePose(reducedCtrl, 60);
    expect(reducedS.maxPitch).toBeLessThan(normalS.maxPitch * 0.5);
    expect(reducedS.maxRoll).toBeLessThan(normalS.maxRoll * 0.5);
  });
});

describe('idle blends out while speaking', () => {
  it('reduces blink amplitude when speaking', () => {
    const a = new IdleController({ rng: lcg(99), blinkMean: 1 });
    const b = new IdleController({ rng: lcg(99), blinkMean: 1 });
    const dt = 1 / 60;
    let now = 0;
    let peakNormal = 0;
    let peakSpeaking = 0;
    for (let i = 0; i < 600; i++) {
      now += dt;
      peakNormal = Math.max(peakNormal, a.update(dt, now, false).blink);
      peakSpeaking = Math.max(peakSpeaking, b.update(dt, now, true).blink);
    }
    expect(peakNormal).toBeGreaterThan(0.5);
    expect(peakSpeaking).toBeLessThanOrEqual(peakNormal);
    expect(peakSpeaking).toBeLessThan(0.4); // damped by the speaking factor
  });
});

describe('idle motion continuity', () => {
  it('does not snap between frames (bounded per-frame rate)', () => {
    const c = new IdleController({ rng: lcg(12345) });
    const dt = 1 / 60;
    let now = 0;
    let prev = c.update(dt, now, false);
    let maxStep = 0;
    for (let i = 0; i < 60 * 30; i++) {
      now += dt;
      const p = c.update(dt, now, false);
      maxStep = Math.max(maxStep, Math.abs(p.roll - prev.roll));
      prev = p;
    }
    // Eased drift/shift keep per-frame roll change tiny (no weight-shift snap).
    expect(maxStep).toBeLessThan(0.005);
  });
});

describe('idle weight-shift rarity', () => {
  it('does not shift early and shifts gradually later', () => {
    // Deterministic rng=0: first shift schedules at exactly 18s with target
    // -SHIFT_AMP; drift roll settles to -DRIFT_AMP*DRIFT_ROLL_SCALE. No seed
    // hunting needed.
    const c = new IdleController({ rng: () => 0 });
    const dt = 1 / 60;
    let now = 0;
    let earlyMax = 0;
    let lateMax = 0;
    for (let i = 0; i < 60 * 120; i++) {
      now += dt;
      const p = c.update(dt, now, false);
      if (now <= 15) earlyMax = Math.max(earlyMax, Math.abs(p.roll));
      lateMax = Math.max(lateMax, Math.abs(p.roll));
    }
    // First shift is 18-40s out, so roll stays drift-only (<=0.018) early.
    expect(earlyMax).toBeLessThan(0.02);
    // The rare weight-shift still occurs and eases in later.
    expect(lateMax).toBeGreaterThan(0.03);
  });
});
describe('idle intensity option', () => {
  it('clamps out-of-range intensity to [0,1]', () => {
    const neg = new IdleController({ rng: () => 0, intensity: -2 });
    const over = new IdleController({ rng: () => 0, intensity: 5 });
    const nan = new IdleController({ rng: () => 0, intensity: Number.NaN });
    const dt = 1 / 60;
    const extent = (c: IdleController): number => {
      let now = 0;
      let mx = 0;
      for (let i = 0; i < 60 * 30; i++) {
        now += dt;
        const p = c.update(dt, now, false);
        mx = Math.max(mx, Math.abs(p.pitch), Math.abs(p.yaw), Math.abs(p.roll));
      }
      return mx;
    };
    expect(extent(neg)).toBe(0); // intensity clamped to 0 -> no motion
    expect(extent(over)).toBeLessThan(0.07); // clamped to 1 -> normal bounds
    expect(extent(nan)).toBeLessThan(0.07); // non-finite -> 1
  });
});

describe('idle controller disposal', () => {
  it('is idempotent and safe to update after dispose', () => {
    const c = new IdleController({ rng: lcg(5) });
    c.update(1 / 60, 1, false);
    c.dispose();
    c.dispose(); // idempotent
    // dispose() halts the controller, so update() returns an all-zero pose
    // and never throws, regardless of the clock or rng seams.
    const p = c.update(1 / 60, 2, false);
    expect(p.pitch).toBe(0);
    expect(p.yaw).toBe(0);
    expect(p.roll).toBe(0);
    expect(p.blink).toBe(0);
    expect(() => c.update(1 / 60, 3, false)).not.toThrow();
  });
});

describe('engine idle wiring', () => {
  it('idle is on by default and moves the head', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: () => 0.5 });
    const a = makeAvatar();
    m.attach(a);
    let minX = 0;
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
      const x = a.bones.head.rotation.x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    expect(maxX - minX).toBeGreaterThan(1e-4); // breathing visible
    expect(maxX - minX).toBeLessThan(0.05); // bounded
  });

  it('idle:false leaves the head at its base pose', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: () => 0.5, idle: false });
    const a = makeAvatar();
    a.bones.head.rotation.x = 0.123;
    m.attach(a);
    for (let i = 0; i < 120; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
    }
    expect(a.bones.head.rotation.x).toBeCloseTo(0.123, 6);
  });

  it('yields to explicit head-drag (drag tests stay authoritative)', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: () => 0.5 });
    const a = makeAvatar();
    m.attach(a);
    m.setHeadTarget(0.3, 0.2);
    for (let i = 0; i < 60; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
    }
    // Idle must not perturb the explicit drag pose on head or neck. The drag
    // eases asymptotically, so we match the existing drag-test tolerance; any
    // idle leakage would push the value well past it.
    expect(a.bones.head.rotation.y).toBeCloseTo(0.3, 2);
    expect(a.bones.head.rotation.x).toBeCloseTo(0.2, 2);
    expect(a.bones.neck.rotation.y).toBeCloseTo(0.3 * 0.35, 3);
  });

  it('blinks the neutral resting face (idle present)', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: lcg(2026) });
    const a = makeAvatar();
    m.attach(a); // no expression set: default neutral, exp_blink = 0
    let peakBlink = 0;
    for (let i = 0; i < 400; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
      peakBlink = Math.max(peakBlink, a.getMorph('exp_blink'));
    }
    expect(peakBlink).toBeGreaterThan(0.5); // idle blink actually fires
  });

  it('yields to an explicit expression blink (never adds on top)', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: lcg(2026) });
    const a = makeAvatar();
    m.attach(a);
    m.setExpression('thinking', 0.01); // thinking carries exp_blink 0.1
    let maxBlink = 0;
    let minBlink = 1;
    for (let i = 0; i < 400; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
      const v = a.getMorph('exp_blink');
      maxBlink = Math.max(maxBlink, v);
      minBlink = Math.min(minBlink, v);
    }
    // Expression stays authoritative; idle never lowers or raises it.
    expect(minBlink).toBeGreaterThanOrEqual(0.099);
    expect(maxBlink).toBeLessThanOrEqual(0.11);
  });

  it('idle does not disturb viseme priority on the mouth', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: lcg(2026) });
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 0.9, viseme_aa: 0.8 } });
    for (let i = 0; i < 30; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
    }
    expect(a.getMorph('jaw_open')).toBeCloseTo(0.9, 2);
    expect(a.getMorph('viseme_aa')).toBeCloseTo(0.8, 2);
  });

  it('disposes the idle layer with the engine without throwing', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.update(0.016, 1);
    expect(() => m.dispose()).not.toThrow();
    expect(() => m.update(0.016, 2)).not.toThrow();
  });
});
