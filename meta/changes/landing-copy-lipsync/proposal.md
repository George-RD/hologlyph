# Landing: high-level copy, wider framing, own-text lip-sync, interior mouth fix

## Why

Owner review of the landing page (2026-07-21):

1. The engine-demo topbar link should go from the landing.
2. The default zoom sat too close (a face filling the viewport).
3. The landing had no copy explaining what hologlyph is at a high level.
4. Speak lip-sync did not match the words: the landing cycled random visemes
   on a timer, unrelated to the utterance. Owner also wants a
   type-your-own-text speak affordance.
5. Bug found in review: the open mouth's interior (tongue + inner-mouth mesh,
   material `mouth_interior`) stayed frozen at bind pose while the outer face
   animated, so a wide-open viseme showed a static cavity behind moving lips.

## What

- Remove the engine-demo link from the topbar (the page stays on disk: the
  visual eval and demo-smoke capture it).
- Pull the default camera back (z 1.15 -> 2.05) for a head-and-shoulders
  framing with headroom.
- Add an intro copy block (title + two high-level sentences + usage hint),
  pointer-events none so it never blocks orbit.
- Rework speak to word-boundary-driven visemes using the library's own
  `src/speech/visemes.ts` mapping (`wordAt` + `visemeSequenceForWord`, walked
  at 75 ms/viseme with 50/120 ms attack/release), plus a type-your-own-text
  input. A timer-walked word fallback keeps the mouth tracking when the voice
  emits no boundary events.
- Drive the `mouth_interior` mesh's morphs: keep its authored dark material
  (KEEP_MATERIALS pattern) but add it to the frame loop's morph-driven set so
  its viseme/expression/jaw morphs open with the lips.

## Non-goals

- No `src/` changes. The demo imports the existing library viseme helpers; the
  library API is untouched. Engine demo and harnesses untouched.
- No new local-TTS adapter (Kokoro/Piper voice pack is a separate future
  change against the reserved `TTSAdapter`/`AudioEngine` seam).

## Affected nodes

- hologlyph.adapter (demo landing page only)
