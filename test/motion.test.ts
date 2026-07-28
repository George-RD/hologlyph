import { describe, it, expect, vi } from 'vitest';
import { createMotionEngine } from '../src/motion';
import { GazeController } from '../src/motion/gaze';
import { clamp01, RIG_VISEME_MORPHS } from '../src/contracts';
import type { LoadedAvatar, NodClass, } from '../src/contracts';
import * as THREE from 'three';

function makeAvatar(opts: { eyes?: boolean } = {}): LoadedAvatar {
  const withEyes = opts.eyes ?? true;
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
    bones: withEyes ? { head, neck, eyeL, eyeR } : { head, neck },
    setMorph(name: string, w: number) {
      morphStore[name] = clamp01(w);
    },
    getMorph(name: string) {
      return morphStore[name] ?? 0;
    },
    dispose() {},
  };
}

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(5)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.42)).toBeCloseTo(0.42);
  });
});

describe('usage without an avatar', () => {
  it('does not throw before attach', () => {
    const m = createMotionEngine();
    expect(() => {
      m.update(0.016, 1);
      m.setExpression('happy');
      m.applyVisemeFrame({ time: 0, weights: { jaw_open: 0.5 } });
      m.clearVisemes();
      m.triggerNod('backchannel');
      m.setGazeMode('idle');
      m.setReducedMotion(true);
      m.dispose();
    }).not.toThrow();
  });
});

describe('expression crossfade', () => {
  it('reaches the target weight and interpolates mid-flight', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.setExpression('happy', 0.4);

    m.update(0.05, 0.05);
    const mid = a.getMorph('exp_happy');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.8);

    for (let i = 0; i < 12; i++) m.update(0.05, 0.05 * (i + 2));
    expect(a.getMorph('exp_happy')).toBeCloseTo(0.8, 2);
  });
});

describe('viseme priority over expression on the mouth', () => {
  it('overrides mouth shapes and releases on clear', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.setExpression('happy', 0.01);
    for (let i = 0; i < 5; i++) m.update(0.05, i * 0.05);

    // Mouth morphs settle onto the happy expression (jaw_open 0.2).
    expect(a.getMorph('exp_happy')).toBeCloseTo(0.8, 2);

    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 0.9, viseme_aa: 0.8 } });
    m.update(0.05, 1);
    // A single frame moves part way, it never snaps to the viseme target.
    const jaw = a.getMorph('jaw_open');
    expect(jaw).toBeGreaterThan(0.2);
    expect(jaw).toBeLessThan(0.9);
    expect(a.getMorph('exp_happy')).toBeCloseTo(0.8, 2); // expression untouched

    // The mouth converges to the viseme target over time.
    for (let i = 0; i < 20; i++) m.update(0.05, 1 + (i + 1) * 0.05);
    expect(a.getMorph('jaw_open')).toBeCloseTo(0.9, 2);
    expect(a.getMorph('viseme_aa')).toBeCloseTo(0.8, 2);

    // Clearing the frame releases smoothly back toward the expression value.
    m.clearVisemes();
    m.update(0.05, 3);
    const afterClear = a.getMorph('jaw_open');
    expect(afterClear).toBeLessThan(0.9);
    expect(afterClear).toBeGreaterThan(0.2);
  });

  it('clamps viseme weights to [0,1]', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { viseme_aa: 5, jaw_open: -1 } });
    m.update(0.05, 1);
    expect(a.getMorph('viseme_aa')).toBe(1);
    expect(a.getMorph('jaw_open')).toBe(0);
  });
});
describe('mouth smoothing', () => {
  it('moves part way toward an applied viseme frame', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });

    m.update(0.016, 0.016);

    expect(a.getMorph('jaw_open')).toBeGreaterThan(0);
    expect(a.getMorph('jaw_open')).toBeLessThan(1);
  });

  it('converges toward the target over simulated updates', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });

    for (let i = 0; i < 19; i++) m.update(0.016, (i + 1) * 0.016);

    expect(a.getMorph('jaw_open')).toBeGreaterThan(0.95);
  });

  it('releases toward the expression value without snapping', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });
    for (let i = 0; i < 19; i++) m.update(0.016, (i + 1) * 0.016);
    const beforeClear = a.getMorph('jaw_open');

    m.clearVisemes();
    m.update(0.016, 0.32);

    const afterClear = a.getMorph('jaw_open');
    expect(afterClear).toBeGreaterThan(0);
    expect(afterClear).toBeLessThan(beforeClear);
  });

  it('attacks faster than it releases for equal time steps', () => {
    const rising = createMotionEngine();
    const risingAvatar = makeAvatar();
    rising.attach(risingAvatar);
    rising.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });
    rising.update(0.016, 0.016);
    const rise = risingAvatar.getMorph('jaw_open');

    const falling = createMotionEngine();
    const fallingAvatar = makeAvatar();
    falling.attach(fallingAvatar);
    falling.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });
    for (let i = 0; i < 200; i++) falling.update(0.016, (i + 1) * 0.016);
    const beforeClear = fallingAvatar.getMorph('jaw_open');
    falling.clearVisemes();
    falling.update(0.016, 3.216);
    const fall = beforeClear - fallingAvatar.getMorph('jaw_open');

    expect(rise).toBeGreaterThan(fall);
  });
  it('resets mouth state for a freshly attached avatar', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 1 } });
    for (let i = 0; i < 50; i++) m.update(0.016, (i + 1) * 0.016);
    expect(a.getMorph('jaw_open')).toBeGreaterThan(0.95); // avatar A converged

    const b = makeAvatar();
    m.attach(b); // new avatar: smoothed mouth state must reset to 0
    m.update(0.016, 1);
    const bJaw = b.getMorph('jaw_open');
    expect(bJaw).toBeGreaterThan(0);
    expect(bJaw).toBeLessThan(0.9); // first-step attack, not A's converged value
  });
});

describe('tongue viseme coupling', () => {
  function settle(
    weights: Record<string, number>,
    reduced = false,
  ): LoadedAvatar {
    const engine = createMotionEngine();
    const avatar = makeAvatar();
    engine.attach(avatar);
    engine.setReducedMotion(reduced);
    engine.applyVisemeFrame({ time: 0, weights });
    for (let i = 0; i < 40; i++) engine.update(0.016, i * 0.016);
    return avatar;
  }

  it('couples coronal, dental, and velar visemes to distinct tongue targets', () => {
    for (const viseme of ['viseme_dd', 'viseme_nn', 'viseme_ss']) {
      const avatar = settle({ [viseme]: 1 });
      expect(avatar.getMorph('tongue_up')).toBeGreaterThan(0.8);
      expect(avatar.getMorph('tongue_out')).toBeLessThan(0.01);
      expect(avatar.getMorph('tongue_back')).toBeLessThan(0.01);
    }
    const out = settle({ viseme_th: 1 });
    expect(out.getMorph('tongue_out')).toBeGreaterThan(0.8);
    const back = settle({ viseme_kk: 1 });
    expect(back.getMorph('tongue_back')).toBeGreaterThan(0.8);
  });

  it('damps only tongue correctives under reduced motion', () => {
    const ordinary = settle({ viseme_th: 1 });
    const reduced = settle({ viseme_th: 1 }, true);
    expect(reduced.getMorph('tongue_out')).toBeLessThan(ordinary.getMorph('tongue_out') * 0.35);
  });

  it('releases tongue correctives smoothly when visemes clear', () => {
    const engine = createMotionEngine();
    const avatar = makeAvatar();
    engine.attach(avatar);
    engine.applyVisemeFrame({ time: 0, weights: { viseme_kk: 1 } });
    for (let i = 0; i < 40; i++) engine.update(0.016, i * 0.016);
    const before = avatar.getMorph('tongue_back');
    engine.clearVisemes();
    engine.update(0.016, 1);
    expect(avatar.getMorph('tongue_back')).toBeGreaterThan(0);
    expect(avatar.getMorph('tongue_back')).toBeLessThan(before);
  });
});

describe('nods', () => {
  function profile(kind: NodClass, reduced: boolean): number[] {
    let now = 0;
    const m = createMotionEngine({ clock: () => now });
    const a = makeAvatar();
    m.attach(a);
    m.setReducedMotion(reduced);
    a.bones.head!.rotation.x = 0;
    m.triggerNod(kind);
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
      samples.push(a.bones.head!.rotation.x);
    }
    return samples;
  }

  function dipCount(s: number[]): number {
    let count = 0;
    for (let i = 1; i < s.length - 1; i++) {
      const prev = s[i - 1];
      const cur = s[i];
      const next = s[i + 1];
      if (
        prev !== undefined &&
        cur !== undefined &&
        next !== undefined &&
        // trough: sequence turns from decreasing to non-decreasing
        cur < prev &&
        cur <= next &&
        cur < -0.001
      ) {
        count++;
      }
    }
    return count;
  }

  it('three nod envelopes differ (backchannel 1 dip, affirmative 2, emphasis 1 sharp)', () => {
    const back = profile('backchannel', false);
    const aff = profile('affirmative', false);
    const emph = profile('emphasis', false);
    expect(dipCount(back)).toBe(1);
    expect(dipCount(aff)).toBe(2);
    expect(dipCount(emph)).toBe(1);
    expect(Math.abs(Math.min(...aff))).toBeGreaterThan(Math.abs(Math.min(...back)));
  });

  it('reduced motion damps nod amplitude', () => {
    const normal = Math.abs(Math.min(...profile('backchannel', false)));
    const reduced = Math.abs(Math.min(...profile('backchannel', true)));
    expect(reduced).toBeLessThan(normal);
  });
});

describe('gaze', () => {
  function totalEyeMotion(reduced: boolean): number {
    let now = 0;
    const m = createMotionEngine({ clock: () => now, rng: () => 0.5 });
    const a = makeAvatar();
    m.attach(a);
    m.setGazeMode('contact');
    m.setReducedMotion(reduced);
    for (let i = 0; i < 30; i++) {
      now += 0.1;
      m.update(0.1, now);
    }
    const e = a.bones.eyeL!;
    return Math.abs(e.rotation.x) + Math.abs(e.rotation.y);
  }

  it('applies saccades under contact and rests under reduced motion', () => {
    const normal = totalEyeMotion(false);
    const reduced = totalEyeMotion(true);
    expect(normal).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(normal);
  });

  it('is a no-op when the rig exposes no eye bones', () => {
    const a = makeAvatar({ eyes: false });
    const m = createMotionEngine({ clock: () => 0, rng: () => 0.5 });
    m.attach(a);
    m.setGazeMode('contact');
    expect(() => m.update(0.1, 1)).not.toThrow();
  });
});
describe('gaze resample on setMode', () => {
  const DEG = Math.PI / 180;

  // rng fixed at 0.5 -> aversion target is a deterministic 22.5 deg offset,
  // contact target is sub-degree jitter.
  function makeGaze(): { gaze: GazeController; setNow: (n: number) => void } {
    let now = 0;
    const clock = () => now;
    const gaze = new GazeController(() => 0.5, clock);
    return { gaze, setNow: (n: number) => (now = n) };
  }

  it('enters the aversion cone on the very next update after setMode', () => {
    const { gaze, setNow } = makeGaze();
    setNow(0);
    gaze.setMode('contact');
    gaze.update(0.2, 0); // resamples contact, schedules next saccade ~1.3s ahead

    // Switch to aversion and update immediately: the pending schedule must be
    // invalidated so a resample happens now, not up to ~1.2s later.
    gaze.setMode('aversion');
    const g = gaze.update(0.2, 0); // dt=0.2 -> k=1 -> current snaps to target

    const magDeg = Math.hypot(g.pitch, g.yaw) / DEG;
    expect(magDeg).toBeGreaterThanOrEqual(15); // inside the 15-30 deg cone
    expect(magDeg).toBeLessThanOrEqual(30);
  });

  it('does not jump to aversion while mode is unchanged before its schedule', () => {
    const { gaze, setNow } = makeGaze();
    setNow(0);
    gaze.setMode('contact');
    gaze.update(0.2, 0); // schedules next saccade ahead
    const g = gaze.update(0.2, 0); // no mode change: stays on the contact target
    const magDeg = Math.hypot(g.pitch, g.yaw) / DEG;
    expect(magDeg).toBeLessThan(5); // contact jitter, not the aversion cone
  });
});

describe('head target drag', () => {
  it('smoothed toward the target and clamps out-of-range input', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);

    // Out-of-range input must be clamped to the sane limits.
    m.setHeadTarget(5, -5);
    const head = a.bones.head!;
    for (let i = 0; i < 40; i++) m.update(1 / 60, (i + 1) / 60);
    expect(head.rotation.y).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(head.rotation.y).toBeGreaterThan(0.45);
    expect(head.rotation.x).toBeGreaterThanOrEqual(-0.35 - 1e-9);
    expect(head.rotation.x).toBeLessThan(-0.3);
  });

  it('moves the head bone toward the target over updates', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.setHeadTarget(0.3, 0.2);

    // First update moves only part way (exponential smoothing).
    m.update(1 / 60, 1 / 60);
    const head = a.bones.head!;
    expect(head.rotation.y).toBeGreaterThan(0);
    expect(head.rotation.y).toBeLessThan(0.3);

    // Converges to the target over many updates.
    for (let i = 0; i < 60; i++) m.update(1 / 60, (i + 2) / 60);
    expect(head.rotation.y).toBeCloseTo(0.3, 2);
    expect(head.rotation.x).toBeCloseTo(0.2, 2);
  });

  it('snaps to the pose under reduced motion without drift', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.setReducedMotion(true);
    m.setHeadTarget(0.3, 0.2);
    m.update(1 / 60, 1 / 60);
    const head = a.bones.head!;
    expect(head.rotation.y).toBeCloseTo(0.3, 6);
    expect(head.rotation.x).toBeCloseTo(0.2, 6);
  });

  it('applies a fraction of the drag to the neck bone', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);
    m.setHeadTarget(0.3, 0.2);
    for (let i = 0; i < 60; i++) m.update(1 / 60, (i + 1) / 60);
    const neck = a.bones.neck!;
    expect(neck.rotation.y).toBeCloseTo(0.3 * 0.35, 3);
    expect(neck.rotation.x).toBeCloseTo(0.2 * 0.35, 3);
  });
});
describe('blink hold', () => {
  it('clamps weight to [0,1] and overrides procedural blink on exp_blink', () => {
    const m = createMotionEngine();
    const a = makeAvatar();
    m.attach(a);

    m.setBlinkHold(0.85);
    m.update(1 / 60, 1 / 60);
    expect(a.getMorph('exp_blink')).toBeCloseTo(0.85);

    m.setBlinkHold(1.5);
    m.update(1 / 60, 2 / 60);
    expect(a.getMorph('exp_blink')).toBe(1);

    m.setBlinkHold(-0.5);
    m.update(1 / 60, 3 / 60);
    expect(a.getMorph('exp_blink')).toBe(0);
  });
});

/**
 * The baked silhouette hull is an outer bound on at most two significant mouth
 * morphs at once. Nothing clamps a heavier frame, but it must not be silent:
 * anything clipped to the hull would fall short of the mouth with no clue why.
 */
describe('over-driven mouth blends', () => {
  it('warns once, changes nothing, and stays quiet inside the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const inBudget = createMotionEngine();
      const a = makeAvatar();
      inBudget.attach(a);
      // The library's own frames: one viseme at full weight, jaw pinned.
      inBudget.applyVisemeFrame({ time: 0, weights: { viseme_aa: 1, jaw_open: 0 } });
      // And the heaviest cross-fade the smoothing can hold.
      inBudget.applyVisemeFrame({ time: 0, weights: { jaw_open: 0.9, viseme_aa: 0.8 } });
      expect(warn).not.toHaveBeenCalled();

      const overDriven = createMotionEngine();
      overDriven.attach(a);
      const everyViseme: Record<string, number> = {};
      for (const name of RIG_VISEME_MORPHS) everyViseme[name] = 1;
      overDriven.applyVisemeFrame({ time: 0, weights: everyViseme });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('silhouette hull');

      // Repeat offences stay quiet, and the frame is honoured unrescaled.
      overDriven.applyVisemeFrame({ time: 0, weights: everyViseme });
      expect(warn).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 200; i++) overDriven.update(0.05, i * 0.05);
      expect(a.getMorph('viseme_aa')).toBeCloseTo(1, 3);
      expect(a.getMorph('viseme_ou')).toBeCloseTo(1, 3);

      // A fresh engine warns again: the flag is per engine, not per process.
      const another = createMotionEngine();
      another.applyVisemeFrame({ time: 0, weights: everyViseme });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
