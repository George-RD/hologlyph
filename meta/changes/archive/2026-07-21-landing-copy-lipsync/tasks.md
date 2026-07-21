# Tasks

- [x] Remove engine-demo topbar link (page retained on disk for eval/smoke)
- [x] Pull default camera back (z 1.15 -> 2.05) for head-and-shoulders framing
- [x] Add intro copy block (title + high-level explanation + usage hint)
- [x] Type-your-own-text speak input in the quickbar (Enter or button)
- [x] Word-boundary viseme lip-sync via src/speech/visemes.ts (wordAt +
      visemeSequenceForWord, 75 ms cadence, 50/120 ms attack/release) with a
      timer-walked word fallback
- [x] Fix mouth_interior mesh: keep authored material but drive its morphs
      (add to morphMeshes) so the tongue/inner-mouth opens with the lips
- [x] Mouth movement scale control (state.speakGain, default 0.55) to damp
      viseme magnitude; slider in the motion group
- [x] Defer per-phoneme tongue articulation (no tongue bone, no tongue morphs
      in the asset); tracked as meta/todos/todo.tongue-articulation-morphs.md
- [x] Gates: tsc, vitest, build, lint, cairn hook all
