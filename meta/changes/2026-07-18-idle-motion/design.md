# Design: baseline idle motion

## Layer

`IdleController` is a deterministic, frame-driven controller with explicit
state for drift and weight-shift targets, blink scheduling, and disposal. It
has no timers or listeners. All randomness flows through injected `rng` and
`clock` seams matching `gaze.ts`, so the layer is fully testable.

## Components

- Breathing: a slow sinusoid on the shared clock, approximately 0.18 Hz, on
  head pitch.
- Micro head drift: a smoothed low-amplitude random offset on yaw, pitch, and
  roll, resampled every few seconds and eased toward its target.
- Weight-shift: a rare, very slow roll bias. The first target is scheduled
  18-40 seconds out and each target is eased toward gradually.
- Blinks: a Poisson process with exponential inter-arrival spacing through the
  existing `exp_blink`, `exp_blink_l`, and `exp_blink_r` morphs, using a
  raised-cosine close/open envelope.

## Composition and priority

- Head motion is applied additively to head and neck bones, scaled by a
  continuous `idleHeadBlend`.
- `idleHeadBlend` is set to zero immediately while explicit head control is
  active, meaning an active nod or a still-posing head drag where `curYaw` or
  `curPitch` is non-zero. It eases slowly back to one afterward, so idle never
  fights user-driven or gesture motion and never hard-applies accumulated
  random drift when control ends.
- Blink morphs compose below expression priority: idle fills them only when
  the explicit expression leaves the blink at approximately zero (resting
  face), via `max(expression, idleBlink)`. While speaking, blink amplitude is
  damped.
- Reduced motion damps every idle amplitude to 15 percent. The engine passes
  its speaking flag so the blink blends out near the mouth.

## Disposal

`IdleController.dispose()` sets a disposed flag. Subsequent `update()` calls
return a zero pose and perform no work, satisfying dispose discipline without
listeners or timers to remove.
