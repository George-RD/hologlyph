---
id: dec.expression-vocab
nodes: [hologlyph.runtime.motion, hologlyph.runtime.speech]
status: accepted
date: 2026-07-08
informed_by: [res.facial-behavior, src.deep-research-1, src.deep-research-2]
---

The public expression API is semantic (neutral, friendly, thinking, agree, concern, happy, surprised, listening, speaking), mapped internally to blendshape weights clamped in [0,1]. Raw facial coefficients are not the primary product API.

Gaze follows social-behavioral states: direct eye contact + micro-saccades (Gaussian jitter, 800-1200 ms) during listening; gaze aversion in a constrained 15-30 deg cone during speaking/thinking. Gestures distinguish at least three nod classes (subtle listener backchannel, stronger affirmative, speech-emphasis), because a single canned nod feels robotic.
