import { describe, it, expect } from 'vitest';
import { createMotionEngine } from '../src/motion';
import { GazeController } from '../src/motion/gaze';
import { clamp01 } from '../src/contracts';
import type { LoadedAvatar, NodClass, MotionEngine } from '../src/contracts';
import * as THREE from 'three';

function makeAvatar(opts: { eyes?: boolean } = {}): LoadedAvatar {
  const withEyes = opts.eyes ?? true;
  const root = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'head';
  const eyeL = new THREE.Bone();
  eyeL.name = 'eye_l';
  const eyeR = new THREE.Bone();
  eyeR.name = 'eye_r';
  const morphStore: Record<string, number> = {};
  return {
    root,
    morphMeshes: [],
    animations: [],
    bones: withEyes ? { head, eyeL, eyeR } : { head },
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

    m.applyVisemeFrame({ time: 0, weights: { jaw_open: 0.9, viseme_aa: 0.8 } });
    m.update(0.05, 1);
    expect(a.getMorph('jaw_open')).toBeCloseTo(0.9, 2);
    expect(a.getMorph('viseme_aa')).toBeCloseTo(0.8, 2);
    expect(a.getMorph('exp_happy')).toBeCloseTo(0.8, 2); // expression untouched

    m.clearVisemes();
    m.update(0.05, 2);
    expect(a.getMorph('jaw_open')).toBeCloseTo(0.2, 2); // back to expression
    expect(a.getMorph('viseme_aa')).toBeCloseTo(0, 2);
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
