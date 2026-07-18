---
node: hologlyph.runtime.motion
status: done
created: 2026-07-17
---

# Baseline Idle Motion

Owner request (2026-07-17): the bust should not read as a statue. Add a
low-amplitude idle layer: breathing (slow chest/head bob), micro head drift,
occasional weight-shift style rotation, periodic blinks. Precedent: procedural
nod envelopes already exist in motion/nods.ts and blink morphs are shipped;
an idle scheduler in MotionEngine (deterministic via the rng/clock seams)
would compose these below expression and viseme priority. Must respect
reduced motion (damped or disabled).
