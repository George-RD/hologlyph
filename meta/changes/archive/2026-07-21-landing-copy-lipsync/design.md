# Design: landing-copy-lipsync

## Approach

Reuse, do not reinvent: the landing's speak drives the same grapheme-to-viseme
mapping the library's demo TTS adapter already ships (`src/speech/visemes.ts`).
The landing is not the library, so it imports those pure helpers directly
rather than instantiating the full SpeechEngine; the mouth is driven from
`SpeechSynthesisUtterance.onboundary` word events, matching the library route
(SpeechEngine -> visemeTap -> MotionEngine) in spirit.

The interior-mouth fix is a set-membership correction, not a material change:
the `mouth_interior` mesh keeps its authored material but joins the frame
loop's `morphMeshes` so its morph influences are driven like every other
morph-bearing mesh.

## Changes

ADDED:
- Intro copy block (`#intro`) markup + styles in demo/index.html.
- `#saybar` type-your-own-text input + speak button in the quickbar; Enter or
  the button triggers speak.
- Imports of `wordAt`, `visemeSequenceForWord` (src/speech/visemes.ts) and
  `RIG_VISEME_MORPHS` (src/contracts.ts) into the demo module.
- Word-boundary viseme walker in the frame loop (75 ms cadence, 50/120 ms
  attack/release), with a timer-walked word fallback for voiceless contexts.
- tools/smoke/landing-shot.mjs: Playwright capture asserting the engine link
  is gone, intro copy present, say-input present, camera pulled back, and the
  speak pipeline animates distinct visemes.

MODIFIED:
- demo/index.html camera z 1.15 -> 2.05.
- The `mouth_interior` traverse branch now pushes the mesh to `morphMeshes`
  (keeps its authored material) instead of returning before that push.
- The frame loop's viseme block iterates the full `RIG_VISEME_MORPHS`
  vocabulary from the boundary cursor instead of a random 5-viseme cycle, and
  scales the active viseme by `state.speakGain` (default 0.55, motion slider)
  to damp exaggeration.

DEFERRED:
- Per-phoneme tongue articulation (tip-to-teeth on T/D, between teeth on TH).
  The rig has no tongue bone and no viseme carries a tongue gesture (measured:
  the interior deltas are jaw-coupled only). Tracked as
  meta/todos/todo.tongue-articulation-morphs.md.

REMOVED:
- The engine-demo `<a>` link from the topbar (page retained on disk).
