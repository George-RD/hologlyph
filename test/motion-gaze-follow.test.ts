/**
 * Tests for gaze-follows-pointer.
 *
 * Two seams are exercised:
 *  - `src/motion/gaze.ts` pure mapping (`ndcToGazeOffset`) and the
 *    GazeController follow state (damping, timeout return, reduced motion).
 *  - `src/motion/index.ts` `setGazeTarget`/`clearGazeFollow` engine surface,
 *    including the subtle head-bone fraction and eyes-only reduced motion.
 *  - `src/element/hologlyph-head.ts` passive pointer observation, rAF throttle,
 *    and listener removal on disconnect (happy-dom).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Engine, EngineOptions, LoadedAvatar } from '../src/contracts';
import { createMotionEngine } from '../src/motion';
import {
  GazeController,
  ndcToGazeOffset,
  FOLLOW_YAW_LIMIT,
  FOLLOW_PITCH_LIMIT,
} from '../src/motion/gaze';
import { HologlyphHeadElement, defineHologlyphHead } from '../src/element';
import * as THREE from 'three';

function makeAvatar(): LoadedAvatar {
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
      morphStore[name] = w;
    },
    getMorph(name: string) {
      return morphStore[name] ?? 0;
    },
    dispose() {},
  };
}
function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

/** Flush the microtask chain so the element's async boot can settle. */
async function microtaskTicks(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

// --- Pure mapping ----------------------------------------------------------

describe('ndcToGazeOffset mapping', () => {
  it('maps the screen edges to the clamped yaw/pitch limits', () => {
    const right = ndcToGazeOffset(1, 0);
    expect(right.yaw).toBeCloseTo(FOLLOW_YAW_LIMIT, 6);
    expect(right.pitch).toBeCloseTo(0, 6);

    const top = ndcToGazeOffset(0, -1);
    expect(top.pitch).toBeCloseTo(FOLLOW_PITCH_LIMIT, 6); // up is positive pitch
    expect(top.yaw).toBeCloseTo(0, 6);

    const bottomLeft = ndcToGazeOffset(-1, 1);
    expect(bottomLeft.yaw).toBeCloseTo(-FOLLOW_YAW_LIMIT, 6);
    expect(bottomLeft.pitch).toBeCloseTo(-FOLLOW_PITCH_LIMIT, 6);
  });

  it('clamps out-of-bounds NDC to the unit square', () => {
    const far = ndcToGazeOffset(5, -9);
    expect(far.yaw).toBeCloseTo(FOLLOW_YAW_LIMIT, 6);
    expect(far.pitch).toBeCloseTo(FOLLOW_PITCH_LIMIT, 6);
  });

  it('maps the centre to straight ahead', () => {
    const c = ndcToGazeOffset(0, 0);
    expect(c.yaw).toBeCloseTo(0, 6);
    expect(c.pitch).toBeCloseTo(0, 6);
  });
});

// --- GazeController follow --------------------------------------------------

function makeGaze(): { gaze: GazeController; setNow: (n: number) => void } {
  let t = 0;
  const clock = () => t;
  // Long timeout so the convergence/reduced tests never expire mid-run.
  const gaze = new GazeController(() => 0.5, clock, { followTimeout: 1000 });
  return { gaze, setNow: (n: number) => (t = n) };
}

describe('GazeController follow', () => {
  it('eases toward the follow target without overshooting', () => {
    const { gaze, setNow } = makeGaze();
    setNow(0);
    gaze.setFollowTarget(0.3, 0.2, 0);
    let prevYaw = 0;
    for (let i = 0; i < 200; i++) {
      setNow(i / 60);
      const g = gaze.update(1 / 60, i / 60);
      expect(Math.abs(g.yaw)).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(g.yaw).toBeGreaterThanOrEqual(prevYaw - 1e-9); // never moves backward
      prevYaw = g.yaw;
    }
    const final = gaze.update(1 / 60, 200 / 60);
    expect(final.yaw).toBeCloseTo(0.3, 3);
    expect(final.pitch).toBeCloseTo(0.2, 3);
  });

  it('returns to forward after the idle timeout', () => {
    let t = 0;
    const gaze = new GazeController(() => 0.5, () => t, { followTimeout: 2 });
    gaze.setFollowTarget(0.3, 0.2, t); // t = 0, followUntil = 2
    t = 0.1;
    gaze.update(1 / 60, 0.1); // still within the timeout

    t = 3; // well past the timeout, no refresh
    let g = gaze.update(1 / 60, 3);
    expect(Math.abs(g.yaw)).toBeLessThan(0.3); // already easing back
    for (let i = 0; i < 600; i++) g = gaze.update(1 / 60, 3 + i / 60);
    expect(Math.abs(g.yaw)).toBeLessThan(0.06); // forward/idle wander
    expect(Math.abs(g.pitch)).toBeLessThan(0.06);
    expect(gaze.isFollowing(100)).toBe(false);
  });

  it('damps heavily under reduced motion without overshoot', () => {
    const { gaze, setNow } = makeGaze();
    gaze.setReduced(true);
    gaze.setFollowTarget(0.3, 0.2, 0);
    let prevYaw = 0;
    for (let i = 0; i < 30; i++) {
      setNow(i / 60);
      const g = gaze.update(1 / 60, i / 60);
      expect(Math.abs(g.yaw)).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(g.yaw).toBeGreaterThanOrEqual(prevYaw - 1e-9);
      prevYaw = g.yaw;
    }
    const mid = gaze.update(1 / 60, 30 / 60);
    expect(mid.yaw).toBeLessThan(0.3); // heavy: still far from target after 0.5s
    expect(mid.yaw).toBeGreaterThan(0);
    for (let i = 0; i < 3000; i++) gaze.update(1 / 60, 0.5 + i / 60);
    const end = gaze.update(1 / 60, 0.5 + 3000 / 60);
    expect(end.yaw).toBeCloseTo(0.3, 2); // but it still converges, just slowly
  });

  it('clears follow on clearFollow and eases back to idle', () => {
    const { gaze, setNow } = makeGaze();
    gaze.setFollowTarget(0.3, 0.2, 0);
    setNow(0.1);
    gaze.update(1 / 60, 0.1);
    gaze.clearFollow();
    expect(gaze.isFollowing(0.2)).toBe(false);
    for (let i = 0; i < 600; i++) gaze.update(1 / 60, 0.2 + i / 60);
    const g = gaze.update(1 / 60, 10);
    expect(Math.abs(g.yaw)).toBeLessThan(0.06); // forward/idle wander
    expect(Math.abs(g.pitch)).toBeLessThan(0.06);
  });
});

// --- MotionEngine gaze follow ----------------------------------------------

describe('MotionEngine gaze follow', () => {
  it('applies eye gaze plus a subtle, clamped head fraction', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now });
    const a = makeAvatar();
    m.attach(a);
    for (let i = 0; i < 180; i++) {
      now += 1 / 60;
      m.setGazeTarget(1, -1); // top-right: max yaw, max pitch (up)
      m.update(1 / 60, now);
    }
    const eye = required(a.bones.eyeL, 'left eye');
    const head = required(a.bones.head, 'head');
    // Eyes reach the clamped target.
    expect(eye.rotation.y).toBeCloseTo(FOLLOW_YAW_LIMIT, 2);
    expect(eye.rotation.x).toBeCloseTo(FOLLOW_PITCH_LIMIT, 2);
    // Head follows only a fraction, well below the drag limit (0.5 rad).
    expect(Math.abs(head.rotation.y)).toBeGreaterThan(0);
    expect(Math.abs(head.rotation.y)).toBeLessThan(0.5);
    expect(Math.abs(head.rotation.y)).toBeLessThanOrEqual(FOLLOW_YAW_LIMIT * 0.4);
    // Neck mirrors a yet smaller fraction.
    expect(Math.abs(required(a.bones.neck, 'neck').rotation.y)).toBeLessThan(Math.abs(head.rotation.y));
  });

  it('keeps the head still under reduced motion (eyes-only)', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now });
    const a = makeAvatar();
    m.attach(a);
    m.setReducedMotion(true);
    for (let i = 0; i < 180; i++) {
      now += 1 / 60;
      m.setGazeTarget(1, -1);
      m.update(1 / 60, now);
    }
    expect(required(a.bones.head, 'head').rotation.y).toBeCloseTo(0, 6);
    expect(required(a.bones.head, 'head').rotation.x).toBeCloseTo(0, 6);
    // Eyes still track the pointer under reduced motion.
    expect(required(a.bones.eyeL, 'left eye').rotation.y).toBeGreaterThan(0);
  });

  it('eases back to forward when clearGazeFollow is called', () => {
    let now = 0;
    const m = createMotionEngine({ clock: () => now });
    const a = makeAvatar();
    m.attach(a);
    for (let i = 0; i < 90; i++) {
      now += 1 / 60;
      m.setGazeTarget(1, -1);
      m.update(1 / 60, now);
    }
    m.clearGazeFollow();
    for (let i = 0; i < 400; i++) {
      now += 1 / 60;
      m.update(1 / 60, now);
    }
    expect(required(a.bones.eyeL, 'left eye').rotation.y).toBeCloseTo(0, 1);
    expect(required(a.bones.eyeL, 'left eye').rotation.x).toBeCloseTo(0, 1);
    expect(required(a.bones.head, 'head').rotation.y).toBeCloseTo(0, 6);
  });
});

// --- Element pointer observation (happy-dom) -------------------------------

class FollowFakeEngine {
  mounted = false;
  disposed = 0;
  gazeTargets: Array<{ x: number; y: number }> = [];
  cleared = 0;
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  readonly motion = {
    setGazeTarget: (x: number, y: number) => {
      this.gazeTargets.push({ x, y });
    },
    clearGazeFollow: () => {
      this.cleared += 1;
    },
    setReducedMotion: () => {},
    setGazeMode: () => {},
  } as unknown as Engine['motion'];

  on(event: string, fn: (p: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }

  emit(event: string): void {
    this.listeners.get(event)?.forEach((fn) => {
      fn(undefined);
    });
  }

  async mount(): Promise<void> {
    this.mounted = true;
  }

  markReady(): void {
    this.emit('ready');
  }

  dispose(): void {
    this.disposed += 1;
  }
}

describe('element gaze follow pointer', () => {
  let container: HTMLDivElement;
  let lastEngine: FollowFakeEngine | null = null;
  let rafCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    lastEngine = null;
    rafCb = null;
    // Drive the throttle flush deterministically: capture the scheduled frame.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafCb = null;
    });
    HologlyphHeadElement.engineFactory = (_opts?: EngineOptions) => {
      const e = new FollowFakeEngine();
      lastEngine = e;
      return e as unknown as Engine;
    };
    defineHologlyphHead();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    HologlyphHeadElement.engineFactory = null;
    container.remove();
  });

  it('maps pointer to a gaze target, clears on leave, removes on disconnect', async () => {
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await microtaskTicks();
    const engine = required(lastEngine, 'fake engine');
    engine.markReady();

    // happy-dom has no layout; stub the bounds so NDC mapping is deterministic.
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(engine.gazeTargets).toHaveLength(0);

    // Pointer at the top-right corner -> NDC (1, -1); a frame is scheduled.
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 0 }));
    expect(rafCb).not.toBeNull();
    required(rafCb, 'scheduled animation frame')(16);

    expect(engine.gazeTargets).toHaveLength(1);
    const last = required(engine.gazeTargets[0], 'gaze target');
    expect(last.x).toBeCloseTo(1);
    expect(last.y).toBeCloseTo(-1);

    // Pointer leave clears the follow.
    el.dispatchEvent(new PointerEvent('pointerleave', {}));
    expect(engine.cleared).toBe(1);

    // Disconnect removes the listeners; a later move must not call setGazeTarget.
    const before = engine.gazeTargets.length;
    el.remove();
    await microtaskTicks();
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }));
    expect(engine.gazeTargets.length).toBe(before);
  });
});
