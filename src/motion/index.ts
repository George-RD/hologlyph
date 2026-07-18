/**
 * MotionEngine: blendshape expressions, gaze/saccades, procedural nods, and
 * live viseme lip-sync. All behaviour is driven by update(dt, elapsed) so it is
 * testable without a GPU context; observers are never created here.
 *
 * Per dec.expression-vocab and dec.performance-budget:
 *  - Semantic expressions crossfade over time, clamped to [0,1].
 *  - Visemes take priority over expression weights on the mouth region.
 *  - Reduced motion damps nods, disables saccades, and shortens crossfades.
 */

import type {
  LoadedAvatar,
  Expression,
  NodClass,
  GazeMode,
  VisemeFrame,
  MotionEngine,
} from '../contracts';
import { RIG_EXPRESSION_MORPHS, RIG_VISEME_MORPHS, clamp01 } from '../contracts';
import { weightsFor, lerpWeights, emptyExpressionWeights } from './expressions';
import { GazeController, ndcToGazeOffset, type Rng, type Clock } from './gaze';
import { NOD_SPECS } from './nods';
import { IdleController } from './idle';

type Bone = NonNullable<LoadedAvatar['bones']['eyeL']>;
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Mouth region: all viseme morphs plus jaw_open. */
const MOUTH_NAMES = [...RIG_VISEME_MORPHS, 'jaw_open'];
const MOUTH: Record<string, true> = {};
for (const m of MOUTH_NAMES) MOUTH[m] = true;
/** Blink morphs idle may fill below expression priority (resting face only). */
const BLINK_NAMES: Record<string, true> = {
  exp_blink: true,
  exp_blink_l: true,
  exp_blink_r: true,
};

/** Attack/release time constants (seconds) for mouth-region smoothing. */
const TAU_ATTACK = 0.05;
const TAU_RELEASE = 0.12;
/** Head-drag target limits (radians), kept within a natural look range. */
const DRAG_YAW_LIMIT = 0.5;
const DRAG_PITCH_LIMIT = 0.35;
/** Fraction of the drag pose fed into the neck bone for articulation. */
const NECK_DRAG_FRACTION = 0.35;
/** Smoothed head-drag time constant: 1 - exp(-dt * DRAG_TAU). */
const DRAG_SMOOTH_TAU = 8;
/** Subtle head-bone participation while the pointer is followed. */
const HEAD_FOLLOW_FRACTION = 0.35;
/** Clamp on the head follow offset, well below the drag limit (radians). */
const FOLLOW_HEAD_YAW_LIMIT = 0.18;
const FOLLOW_HEAD_PITCH_LIMIT = 0.12;
/** Fraction of the head follow fed into the neck bone. */
const NECK_FOLLOW_FRACTION = 0.2;
/** Smoothing time constants (seconds) for the head follow offset. */
const FOLLOW_HEAD_TAU = 6;
const FOLLOW_HEAD_TAU_REDUCED = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
/** Idle head-motion return rate (per second) after explicit head control ends. */
const IDLE_HEAD_BLEND_UP_K = 1;

function emptyMouthWeights(): Record<string, number> {
  const w: Record<string, number> = {};
  for (const name of MOUTH_NAMES) w[name] = 0;
  return w;
}

export interface MotionEngineOptions {
  /** Deterministic randomness source (defaults to Math.random). */
  rng?: Rng;
  /** Time source in seconds; when omitted update()'s elapsed argument is used. */
  clock?: Clock;
  /** Idle timeout (seconds) before the gaze eases back to forward after the last pointer target. */
  gazeFollowTimeout?: number;
  /**
   * Baseline idle motion (breathing, micro drift, weight-shift, blinks).
   * Defaults on; pass false to disable or { intensity } to scale amplitudes.
   */
  idle?: boolean | { intensity?: number };
}
export function createMotionEngine(options: MotionEngineOptions = {}): MotionEngine {
  const rng: Rng = options.rng ?? Math.random;
  const clockOpt = options.clock;

  let avatar: LoadedAvatar | null = null;
  let baseEyeL: Vec3 | null = null;
  let baseEyeR: Vec3 | null = null;
  let baseHead: Vec3 | null = null;
  // Head-drag target (additive over nods/gaze). The target is clamped on
  // input; cur eases toward it each update unless reduced motion snaps it.
  let targetYaw = 0;
  let targetPitch = 0;
  let curYaw = 0;
  let curPitch = 0;
  // Smoothed head follow offset (subtle, eyes-only under reduced motion).
  let curFollowYaw = 0;
  let curFollowPitch = 0;
  // Continuous idle-head blend: 0 while explicit head control (nod/drag) is
  // active, eased slowly back to 1 afterward so idle never snaps in/out and
  // never hard-applies an accumulated random drift offset when control ends.
  let idleHeadBlend = 1;
  let baseNeck: Vec3 | null = null;

  // Persistent smoothed weights for the mouth region. A new frame only
  // changes the target; the value eases toward it each update.
  let mouthCurrent = emptyMouthWeights();
  let fromWeights = emptyExpressionWeights();
  let toWeights = weightsFor('neutral');
  let displayWeights = weightsFor('neutral');
  let fadeElapsed = 0;
  let fadeDuration = 0.35;

  let visemeFrame: VisemeFrame | null = null;

  const gaze = new GazeController(rng, clockOpt, { followTimeout: options.gazeFollowTimeout });
  const idleOpt = options.idle;
  const idleIntensity =
    idleOpt === false ? 0 : idleOpt === true || idleOpt === undefined ? 1 : idleOpt.intensity ?? 1;
  const idle = new IdleController({ rng, clock: clockOpt, intensity: idleIntensity });
  let reduced = false;
  let nod: { kind: NodClass; start: number } | null = null;
  let lastNow = 0;

  function attach(a: LoadedAvatar): void {
    avatar = a;
    mouthCurrent = emptyMouthWeights();
    const bones = a.bones;
    baseEyeL = bones.eyeL
      ? { x: bones.eyeL.rotation.x, y: bones.eyeL.rotation.y, z: bones.eyeL.rotation.z }
      : null;
    baseEyeR = bones.eyeR
      ? { x: bones.eyeR.rotation.x, y: bones.eyeR.rotation.y, z: bones.eyeR.rotation.z }
      : null;
    baseHead = bones.head
      ? { x: bones.head.rotation.x, y: bones.head.rotation.y, z: bones.head.rotation.z }
      : null;
    baseNeck = bones.neck
      ? { x: bones.neck.rotation.x, y: bones.neck.rotation.y, z: bones.neck.rotation.z }
      : null;
  }

  function setExpression(expr: Expression, fadeSeconds = 0.35): void {
    fromWeights = { ...displayWeights };
    toWeights = weightsFor(expr);
    fadeElapsed = 0;
    fadeDuration = reduced ? Math.min(fadeSeconds, 0.1) : fadeSeconds;
  }

  function applyVisemeFrame(frame: VisemeFrame): void {
    visemeFrame = frame;
  }

  function clearVisemes(): void {
    visemeFrame = null;
  }

  function triggerNod(kind: NodClass): void {
    const now = clockOpt ? clockOpt() : lastNow;
    nod = { kind, start: now };
  }

  function setGazeMode(mode: GazeMode): void {
    gaze.setMode(mode);
  }

  function setReducedMotion(r: boolean): void {
    reduced = r;
    gaze.setReduced(r);
    idle.setReduced(r);
  }
  function setHeadTarget(yaw: number, pitch: number): void {
    targetYaw = Math.max(-DRAG_YAW_LIMIT, Math.min(DRAG_YAW_LIMIT, yaw));
    targetPitch = Math.max(-DRAG_PITCH_LIMIT, Math.min(DRAG_PITCH_LIMIT, pitch));
  }

  function setGazeTarget(ndcX: number, ndcY: number): void {
    const off = ndcToGazeOffset(ndcX, ndcY);
    gaze.setFollowTarget(off.yaw, off.pitch, clockOpt ? clockOpt() : lastNow);
  }

  function clearGazeFollow(): void {
    gaze.clearFollow();
  }

  function update(dt: number, elapsed: number): void {
    const now = clockOpt ? clockOpt() : elapsed;
    lastNow = now;

    // 1. Expression crossfade toward the target weight set.
    fadeElapsed += dt;
    const t = fadeDuration > 0 ? clamp01(fadeElapsed / fadeDuration) : 1;
    displayWeights = lerpWeights(fromWeights, toWeights, t);

    // 2. Gaze, applied to the eye bones when the rig exposes them.
    const g = gaze.update(dt, now);
    if (avatar) {
      applyEye(avatar.bones.eyeL, baseEyeL, g);
      applyEye(avatar.bones.eyeR, baseEyeR, g);
    }
    // 2b. Idle layer: deterministic breathing/drift/blink, composed below
    // expression and viseme priority. It blends out while speaking.
    const speaking = visemeFrame !== null;
    const idlePose = idle.update(dt, now, speaking);

    // 3. Procedural nod envelope on the head bone.
    let nodPitch = 0;
    if (nod) {
      const spec = NOD_SPECS[nod.kind];
      const phase = (now - nod.start) / spec.duration;
      if (phase >= 1) {
        nod = null;
      } else {
        const amp = reduced ? spec.amplitude * 0.3 : spec.amplitude;
        nodPitch = spec.evaluate(phase) * amp;
      }
    }
    // 3b. Head-drag target: ease cur toward the clamped target each update, or
    // snap under reduced motion so the pose is honoured without drift.
    const dragK = reduced ? 1 : 1 - Math.exp(-dt * DRAG_SMOOTH_TAU);
    curYaw += (targetYaw - curYaw) * dragK;
    curPitch += (targetPitch - curPitch) * dragK;

    // 3c. Pointer-follow head participation: a subtle fraction of the eye gaze,
    // clamped well below the drag limit. Disabled entirely under reduced motion
    // (eyes-only); eased with exponential smoothing so toggling reduced motion
    // mid-follow never snaps an offset head back to centre.
    let followTargetYaw = 0;
    let followTargetPitch = 0;
    if (gaze.isFollowing(now) && !reduced) {
      followTargetYaw = clamp(g.yaw * HEAD_FOLLOW_FRACTION, -FOLLOW_HEAD_YAW_LIMIT, FOLLOW_HEAD_YAW_LIMIT);
      followTargetPitch = clamp(g.pitch * HEAD_FOLLOW_FRACTION, -FOLLOW_HEAD_PITCH_LIMIT, FOLLOW_HEAD_PITCH_LIMIT);
    }
    const followK = 1 - Math.exp(-dt * (reduced ? FOLLOW_HEAD_TAU_REDUCED : FOLLOW_HEAD_TAU));
    curFollowYaw += (followTargetYaw - curFollowYaw) * followK;
    curFollowPitch += (followTargetPitch - curFollowPitch) * followK;

    // Idle head motion yields to explicit head control: it is fully
    // suppressed the moment a nod is active or the head is still posing
    // (curYaw/curPitch non-zero), and eases slowly back in once control ends
    // so idle never snaps in/out or hard-applies an accumulated drift offset.
    const explicitHead = nod !== null || Math.hypot(curYaw, curPitch) > 1e-4;
    if (explicitHead) {
      idleHeadBlend = 0;
    } else {
      const blendK = Math.min(1, dt * IDLE_HEAD_BLEND_UP_K);
      idleHeadBlend += (1 - idleHeadBlend) * blendK;
    }
    if (avatar?.bones.head && baseHead) {
      avatar.bones.head.rotation.x = baseHead.x + nodPitch + curPitch + curFollowPitch + idlePose.pitch * idleHeadBlend;
      avatar.bones.head.rotation.y = baseHead.y + curYaw + curFollowYaw + idlePose.yaw * idleHeadBlend;
      avatar.bones.head.rotation.z = baseHead.z + idlePose.roll * idleHeadBlend;
    }
    if (avatar?.bones.neck && baseNeck) {
      avatar.bones.neck.rotation.x = baseNeck.x + curPitch * NECK_DRAG_FRACTION + curFollowPitch * NECK_FOLLOW_FRACTION + idlePose.pitch * idleHeadBlend * NECK_DRAG_FRACTION;
      avatar.bones.neck.rotation.y = baseNeck.y + curYaw * NECK_DRAG_FRACTION + curFollowYaw * NECK_FOLLOW_FRACTION + idlePose.yaw * idleHeadBlend * NECK_DRAG_FRACTION;
      avatar.bones.neck.rotation.z = baseNeck.z + idlePose.roll * idleHeadBlend * NECK_DRAG_FRACTION;
    }

    // 4. Visemes override the mouth region with attack/release smoothing;
    //    expression drives the rest. The mouth value eases toward its target
    //    (the viseme weight while a frame is active, otherwise the
    //    expression-derived weight) so speech never snaps frame to frame.
    const visemeActive = visemeFrame !== null;
    const vw = visemeFrame ? visemeFrame.weights : null;

    if (avatar) {
      for (const name of RIG_EXPRESSION_MORPHS) {
        if (MOUTH[name] === true) {
          const target = visemeActive && vw ? (vw[name] ?? 0) : (displayWeights[name] ?? 0);
          const current = mouthCurrent[name] ?? 0;
          const tau = target > current ? TAU_ATTACK : TAU_RELEASE;
          const next = current + (target - current) * (1 - Math.exp(-dt / tau));
          mouthCurrent[name] = next;
          avatar.setMorph(name, clamp01(next));
        } else {
          const expr = clamp01(displayWeights[name] ?? 0);
          // Idle composes below expression priority: it only fills the blink
          // morphs when the explicit expression does not already drive them
          // (resting face), so it never fights an explicit expression or viseme.
          const idleBlinkVal = BLINK_NAMES[name] && expr < 1e-3 ? idlePose.blink : 0;
          avatar.setMorph(name, clamp01(Math.max(expr, idleBlinkVal)));
        }
      }
      for (const name of RIG_VISEME_MORPHS) {
        const target = visemeActive && vw ? (vw[name] ?? 0) : 0;
        const current = mouthCurrent[name] ?? 0;
        const tau = target > current ? TAU_ATTACK : TAU_RELEASE;
        const next = current + (target - current) * (1 - Math.exp(-dt / tau));
        mouthCurrent[name] = next;
        avatar.setMorph(name, clamp01(next));
      }
    }
  }

  function dispose(): void {
    avatar = null;
    visemeFrame = null;
    mouthCurrent = emptyMouthWeights();
    nod = null;
    baseEyeL = null;
    baseEyeR = null;
    baseHead = null;
    baseNeck = null;
    targetYaw = 0;
    targetPitch = 0;
    curYaw = 0;
    curPitch = 0;
    curFollowYaw = 0;
    curFollowPitch = 0;
    idleHeadBlend = 1;
    idle.dispose();
  }

  return {
    attach,
    update,
    setExpression,
    applyVisemeFrame,
    clearVisemes,
    triggerNod,
    setGazeMode,
    setReducedMotion,
    dispose,
    setHeadTarget,
    setGazeTarget,
    clearGazeFollow,
  };
}

function applyEye(bone: Bone | undefined, base: Vec3 | null, g: { pitch: number; yaw: number }): void {
  if (!bone || !base) return;
  bone.rotation.x = base.x + g.pitch;
  bone.rotation.y = base.y + g.yaw;
}
