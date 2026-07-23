---
node: hologlyph.runtime.speech
status: open
created: 2026-07-21
---

# Kokoro HQ voice pack + demo load button (owner round, 2026-07-21)

Owner wants a high-definition neural voice as an opt-in upgrade over the
default browser `SpeechSynthesis`, with a demo-page button so visitors can load
the HQ voice on demand and try it out. Kokoro-82M (Apache-2.0, via `kokoro-js`)
is the recorded future candidate (dec.speech-architecture, dec.head-asset-source).

## Why it is worth doing

The demo default is browser `SpeechSynthesis`: OS-dependent, robotic, and it
emits no phonemes, so mouth motion is derived from coarse `boundary` word
events (see landing-copy-lipsync). Kokoro is genuinely natural, runs fully
in-browser on WebGPU (WASM fallback), and phonemises before synthesis, which
yields exact viseme timing instead of the word-boundary approximation.

## Constraints (why it stayed deferred)

- Asset budget: Kokoro weights are ~80 MB fp32 / ~40 MB q8. This MUST stay out
  of the < 1.5 MB shipped asset budget and the ~11 kB core bundle: lazy-loaded
  on demand only, never bundled or auto-fetched (dec.speech-architecture).
- Autoplay/gesture: `AudioContext` playback needs a user gesture. The load
  button doubles as that gesture (`AudioEngine.resume()` on click).
- Embed-ability: the library core must not depend on Kokoro; it is an opt-in
  adapter the host or demo wires in, so zero cost when unused.

## Proper implementation (library + demo)

1. Add `kokoro-js` as an OPTIONAL dependency, dynamically `import()`-ed inside
   the adapter so it never enters the core or default chunk. Model files are
   fetched from the HF CDN (or a self-hosted mirror) on first use, not at build.
2. Build a `KokoroTTSAdapter implements TTSAdapter` (`mode: 'provider'`) under
   `src/speech/adapters/kokoro.ts`, exported via `src/speech/index.ts` as
   `createKokoroTTSAdapter(options)`. It:
   - lazily loads the model (with a progress callback for the button UI),
   - synthesises PCM + phoneme timing, connects PCM through the reserved
     `AudioEngine` PCM seam (res.seam-audit; currently unused in v2),
   - maps Kokoro phonemes to the canonical `RIG_VISEME_MORPHS` vocabulary and
     emits `VisemeFrame`s through `UtteranceHandle`, reduced-motion aware.
3. Prefer WebGPU with WASM fallback; degrade-don't-throw: on load/synthesis
   failure emit `error` + `end` and leave the existing default adapter in place.
4. Demo: add a "Load HQ voice" button to the say-bar. Click -> resume audio,
   lazy-load Kokoro with a progress indicator, then `speechEngine.setAdapter`
   (or the demo's equivalent) so subsequent `speak` uses Kokoro. Keep the
   default `SpeechSynthesis` path as the zero-download fallback.

## Verification when tackled

- Core bundle size unchanged (~11 kB gzip); Kokoro in its own lazy chunk only.
- `tsc --noEmit`, vitest (adapter mapping unit-tested with a faked model),
  build, lint, `cairn hook all`.
- Browser smoke: load the voice, speak typed text, confirm audible speech and
  viseme-driven mouth motion; then `bun run eval` (engine.html is untouched, so
  no baseline change expected).

## Not in scope

Piper WASM voices (lighter but more robotic) were considered as a middle tier;
Kokoro is the chosen HQ option. Any provider swap stays behind the same
`TTSAdapter` seam, so this does not change the shipped API.
