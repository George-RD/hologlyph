---
id: res.local-tts-dev
nodes: [hologlyph.runtime.speech, hologlyph.runtime.audio]
sources: [src.v2-research-agents]
date: 2026-07-13
---

# Local and on laptop TTS for hologlyph speech path development

This note de-risks the "develop without a cloud account" path for hologlyph v2. It maps onto the three mode speech architecture in `meta/decisions/dec.speech-architecture.md`: mode 1 is the browser `SpeechSynthesis` demo, mode 2 is a cloud TTS returning viseme metadata, and mode 3 is the `AnalyserNode` PCM fallback. The adapter contract lives in `src/contracts.ts` (`TTSAdapter`, `ProviderSynthesisResult`, `VisemeFrame[]`, normalised to the 15 canonical `RIG_VISEME_MORPHS`). The committed fixture format is modelled on Amazon Polly viseme speech marks, documented in `meta/research/res.viseme-provider-format.md`: line delimited JSON with `{"time": ms, "type": "viseme", "start": ms, "end": ms, "value": "<polly-symbol>"}`, where `value` is a small shape named alphabet that the mode 2 parser maps onto the 15 canonical visemes.

Two distinct jobs are in scope:
1. A dev-time FIXTURE GENERATOR that emits viseme-timeline JSONL in the Polly shape, so the mode 2 adapter parser and the morph rig can be exercised deterministically without Polly, an AWS account, or the network.
2. A candidate for a genuine in browser mode 2 adapter later (the architecture decision already defers on-device Kokoro to post-v1).

Every engine below is judged on five axes: licence (and whether it survives sublicensing inside an npm package), output type (audio only versus phoneme or timing metadata), whether visemes or timings can be derived, rough model or asset size, and integration surface (Node CLI for fixtures versus in-browser runtime).

## Engine by engine

### espeak-ng

- Licence: GNU GPL v3. VERIFIED from the project `COPYING` file (https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING). GPLv3 is copyleft and forbids sublicensing, so espeak-ng itself must never be bundled into the shipped npm package. It is a dev-time tool only.
- Output: audio plus a structured phoneme event stream. VERIFIED from the public header `src/include/espeak-ng/speak_lib.h` (https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/src/include/espeak-ng/speak_lib.h). Calling `espeak_Initialize(..., espeakINITIALIZE_PHONEME_EVENTS)` (bit 0) enables `espeakEVENT_PHONEME` (type 7). Each event in the synth callback carries `audio_position` (documented as "the time in mS within the generated speech output data") and `id.string[8]` holding the phoneme mnemonic (for example "p", "@", "S"). This is a direct, millisecond accurate phoneme timeline tied to the audio, which is exactly what a fixture generator needs.
- Visemes or timings derivable: yes, and cleanly. The phoneme mnemonic plus `audio_position` gives a start time per phoneme; the end time is the next event's `audio_position` (or utterance end). Phoneme to viseme is a static lookup (see the mapping sketch below). This is the only engine reviewed that hands back timing natively through a documented API.
- Size: tiny. The espeak-ng binary and voice data are a few megabytes installed via the system package manager. No neural model.
- Integration surface: Node CLI / native addon for fixture generation. A thin Node binding over `libespeak-ng` (node-gyp) collects the callback events. As a fallback, the `espeak-ng` CLI itself can emit phonemes (REPORTED: the `--pho` / `--phonout` flags write phoneme mnemonics, and cumulative durations can be derived from the event API or from total audio length); the event API path above is the robust one and is VERIFIED.

### Kokoro (kokoro-js / ONNX WebGPU-WASM)

- Licence: Apache-2.0 for both the code and the weights. VERIFIED: the `kokoro` repo `LICENSE` is Apache-2.0 (https://raw.githubusercontent.com/hexgrad/kokoro/main/LICENSE) and the `Kokoro-82M` model card declares `license: apache-2.0` with the statement "Apache-licensed weights... can be deployed anywhere from production environments to personal projects" (https://huggingface.co/hexgrad/Kokoro-82M). The `kokoro-js` npm package is also Apache-2.0 (VERIFIED: https://registry.npmjs.org/kokoro-js). Apache-2.0 is permissive and sublicensable, so Kokoro is safe to ship inside a commercial npm package.
- Output: audio, and phonemes during streaming. VERIFIED from the `kokoro-js` README (https://registry.npmjs.org/kokoro-js): the streaming API yields objects of the shape `{ text, phonemes, audio }`, so the phoneme sequence is exposed. What is NOT exposed is a per phoneme timestamp; the audio is returned per text chunk. Deriving exact phoneme timing would require accumulating `audio` chunk durations or running a forced alignment step (REPORTED as necessary; the README confirms phonemes are present but shows no timing field).
- Visemes or timings derivable: phonemes yes, precise timings only by derivation. The model internally uses the `phonemizer` dependency (a port of espeak-ng style G2P) and predicts per token durations, but `kokoro-js` does not surface those durations as offsets.
- Size: 82 million parameters. At fp32 that is roughly 330 MB (derived: 82M times 4 bytes), and the `kokoro-js` README lists dtype options `fp32`, `fp16`, `q8`, `q4`, `q4f16` for the `onnx-community/Kokoro-82M-v1.0-ONNX` weights, so quantized builds are substantially smaller. Exact on-disk sizes for the quantized variants are REPORTED (typically tens of megabytes) and should be confirmed from the ONNX repo at integration time. The JS wrapper package itself is about 30 MB unpacked (includes the onnxruntime-web WASM).
- Integration surface: in-browser via `@huggingface/transformers` (onnxruntime-web) with `device: "wasm"` or `"webgpu"`, and Node with `device: "cpu"`. This is the only reviewed engine that is both locally runnable in the browser and licence clean for redistribution, which is why it is the deferred future runtime candidate.

### Piper

- Licence: MIT for the engine. VERIFIED from the GitHub licence API (https://api.github.com/repos/rhasspy/piper/license), which returns the MIT `LICENSE.md`. The `piper-phonemize` library it depends on is also MIT (VERIFIED: https://api.github.com/repos/rhasspy/piper-phonemize/license). Individual voice model files carry their own licences; the large majority are CC0 or CC-BY / Apache, with each voice's licence listed in the `piper-voices` repository (REPORTED: not individually verified here, see https://github.com/rhasspy/piper-voices).
- Output: audio only through the standard CLI. Piper consumes espeak-ng style phonemes internally but the `piper` command emits WAV and, at most, a length or alignment side channel; it does not emit a timed phoneme or viseme stream. The phonemizer library can produce the phoneme string but again without timing.
- Visemes or timings derivable: not directly. Piper is excellent for producing real, natural local audio to test the mode 3 `AnalyserNode` fallback and to sanity check mouth motion against genuine speech energy, but it cannot author a viseme timeline on its own.
- Size: the `en_US` neural voices are typically 40 to 120 MB of ONNX/JSON model data; the `piper` binary is small.
- Integration surface: Node CLI (`piper` binary) for audio generation; the `piper-phonemize` library (MIT) if phonemes are wanted without timing. Good dev companion for audio, not for fixtures.

### Coqui TTS / XTTS and its forks

- Licence: the `TTS` code base is Mozilla Public License 2.0. VERIFIED from the GitHub licence API (https://api.github.com/repos/coqui-ai/TTS/license). MPL-2.0 is file level copyleft and is sublicensable, so the code alone would be acceptable. The blocker is the model: `XTTS-v2` is published under the Coqui Public Model License (CPML), a custom restrictive model licence. VERIFIED from the model card `license: other / license_name: coqui-public-model-license` (https://huggingface.co/coqui/XTTS-v2). CPML is not an open source licence and is not sublicensable for commercial redistribution, which disqualifies it under the hologlyph packaging rule that requires a licence surviving sublicensing. Coqui the company has also wound down (REPORTED), so forks vary in maintenance and licence clarity.
- Output: audio, with optional phoneme or duration metadata inside the Python `TTS` API, but voice cloning is the headline feature (6 second reference clip), which is irrelevant and risky for a redistributed widget.
- Visemes or timings derivable: yes in principle via the Python API, but the licence disqualifies shipping it, and the heavy Python runtime and GPU bias make it a poor dev fixture tool.
- Size: XTTS-v2 checkpoints are hundreds of megabytes (GPT + decoder).
- Integration surface: Python only; not browser runnable without a server. Disqualified for hologlyph on licence grounds.

### macOS `say`

- Licence: the `say` binary and its voices are part of macOS and are Apple proprietary; the voices are not redistributable (REPORTED, Apple `say` man page: https://ss64.com/mac/say.html). This is a dev convenience only, never a shipped dependency.
- Output: audio only. No phoneme or timing metadata of any kind.
- Visemes or timings derivable: no.
- Size: nil to install on a Mac; uses the onboard voices.
- Integration surface: a one line shell call on a Mac to generate WAV for quick local testing of the audio path and the mode 3 fallback. Not useful for fixtures.

### OpenTTS (and similar wrappers)

- Licence: MIT. REPORTED from the project repository (https://github.com/synesthesiam/opentts). It wraps espeak-ng, flite, and mbrola behind a small server.
- Output: audio, and for the espeak-ng backend it can return phoneme information. Some endpoints expose phoneme identifiers and timing, which makes it a Docker friendly alternative to calling espeak-ng directly (REPORTED).
- Visemes or timings derivable: yes, effectively the same phoneme timeline as espeak-ng because it fronts espeak-ng.
- Size: small server plus the wrapped engines.
- Integration surface: a local HTTP server (`docker run`) that returns phoneme timing as JSON. Worth noting as a drop in alternative if a direct espeak-ng native binding is awkward in the toolchain, but it adds a server process where a CLI binding does not.

### StyleTTS2 / Bark (noted, disqualified by design)

Both are credible local neural TTS (StyleTTS2 is the architecture Kokoro is built on; Bark is MIT code). Both are audio only with no viseme or timing metadata, and both are hundreds of megabytes with no browser build in scope. They are noted only to close the field; neither serves fixture generation or a lightweight runtime.

## Comparison table

| Engine | Licence (verified) | Audio | Phoneme/timing metadata | Viseme timeline derivable | Rough size | Surface |
|---|---|---|---|---|---|---|
| espeak-ng | GPLv3 (VERIFIED) | yes | phoneme events + ms `audio_position` (VERIFIED) | yes, native | few MB | Node CLI / native addon (dev only) |
| Kokoro (kokoro-js) | Apache-2.0 (VERIFIED) | yes | phonemes in stream, no timestamps (VERIFIED) | phonemes yes, timing by derivation | ~330 MB fp32, smaller q4/q8 (quant REPORTED) | in-browser WASM/WebGPU + Node |
| Piper | MIT engine + MIT phonemizer (VERIFIED) | yes | none via CLI | no | 40 to 120 MB per voice | Node CLI for audio |
| Coqui XTTS-v2 | MPL-2.0 code, CPML model (VERIFIED) | yes | Python API only | yes but disqualified | hundreds of MB | Python server |
| macOS `say` | Apple proprietary (REPORTED) | yes | none | no | 0 on Mac | Mac shell |
| OpenTTS | MIT (REPORTED) | yes | phoneme timing via espeak-ng backend | yes | small + engines | local Docker server |

## Key question: fixture generator and future runtime

For a dev-time fixture generator the deciding factors are native timing metadata, a licence that permits dev use without contaminating shipped artefacts, and small footprint. espeak-ng is the only engine that returns phoneme events with millisecond audio offsets through a documented API, and it is tiny and fast. The GPLv3 licence is a non issue for fixtures because the output is plain data: the GPLv3 `COPYING` text states "The output from running a covered work is covered by this License only if the output, given its content, constitutes a covered work." A viseme-timeline JSONL is textual data, not a covered work, so the generated fixtures are clean to commit and redistribute even though the generator binary is GPLv3 and must stay out of the package.

For a future in browser mode 2 adapter the deciding factors flip to licence cleanliness for redistribution, browser execution, and no server or API key. Kokoro is the only option that satisfies all three (Apache-2.0 weights and JS, onnxruntime-web in the browser). Its gap is that it exposes phonemes but not timestamps, so a runtime adapter would need a small alignment step to turn the phoneme stream into `VisemeFrame[]`. That gap, plus the model size and the autoplay gesture requirement, is exactly why `dec.speech-architecture.md` already defers on-device Kokoro to post-v1.

## Recommendation

### Fixture generator: espeak-ng

Adopt espeak-ng as the dev-time fixture generator. It is the only reviewed engine that emits a phoneme timeline with millisecond audio offsets natively, it is a few megabytes, and its GPLv3 licence does not attach to the JSONL it produces.

Concrete first steps:
1. Add a dev-only Node script (for example `tools/tts-fixtures/espeak-timeline.ts`) that loads `libespeak-ng` through a thin native binding, calls `espeak_Initialize(AUDIO_OUTPUT_RETRIEVAL, 0, NULL, espeakINITIALIZE_PHONEME_EVENTS)`, and registers a synth callback that collects every `espeakEVENT_PHONEME` with its `audio_position` (ms) and `id.string` mnemonic. Compute each phoneme's end as the next event's `audio_position`.
2. Map each espeak mnemonic to a Polly alphabet symbol using a static table (sketch below), then emit one JSONL line per phoneme in the exact Polly shape from `res.viseme-provider-format.md`: `{"time": start_ms, "type": "viseme", "start": start_ms, "end": end_ms, "value": "<polly-symbol>"}`. This reuses the committed mode 2 parser unchanged.
3. Keep espeak-ng out of the package: install it only in dev (system package or a dev container), never as a runtime dependency, and never commit its binary or modified source.

Proposed espeak mnemonic to Polly symbol map (REPORTED design, grounded in the espeak phoneme inventory; the Polly symbol to canonical viseme step is already specified in `res.viseme-provider-format.md`):
- `p`, `b`, `m` -> `p`
- `f`, `v` -> `f`
- `T`, `D` (voiced th) -> `T`
- `t`, `d`, `l` -> `t` (Polly maps `t` and `l` to `viseme_dd`)
- `k`, `g` -> `k`
- `s`, `z` -> `s`
- `S`, `Z`, `tS`, `dZ` (sh, zh, ch, j) -> `S` (Polly maps `S` to `viseme_ch`)
- `r` -> `r`
- `@`, `a`, `A` -> `@` (Polly maps `@`,`a` to `viseme_aa`)
- `e`, `E` -> `e`
- `i`, `I` -> `i`
- `o`, `O` -> `o`
- `u`, `U` -> `u`
- silence / pause -> `sil`

Caveats:
- `viseme_nn` coverage gap. The Polly-shaped fixture format as specified covers only 14 of the 15 canonical visemes; it has no nasal symbol, so `viseme_nn` is not representable through the Polly alphabet (verified by re-reading `res.viseme-provider-format.md`: its alphabet and map yield `sil, aa, ee, ih, oh, ou, pp, ff, th, dd, ss, ch, kk, rr` and omit `nn`). espeak-ng does produce nasals (`n`, `m`, `N`), so either (a) extend the fixture generator and parser to accept an explicit canonical-viseme value for `nn`, or (b) accept that `viseme_nn` is covered only by a dedicated unit test. Recommend option (a) as a small, documented extension to the fixture contract.
- Phoneme to viseme is approximate and coarser than a real provider; it is for deterministic dev testing, not for judging visual fidelity against Polly or Azure.
- Add a coverage check in the generator that warns when any of the 15 canonical visemes is never exercised across the fixture corpus.

### Future runtime candidate: Kokoro

Adopt Kokoro (via `kokoro-js`) as the deferred in-browser mode 2 adapter candidate. It is the only licence-clean, browser-runnable neural TTS reviewed, and it aligns with the existing deferral in `dec.speech-architecture.md`.

Concrete first steps (for post-v1 work, not now):
1. Wrap `KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "webgpu" })` in a `TTSAdapter` whose `mode` is `"provider"`.
2. Use the streaming API (`tts.stream(...)`) which yields `{ text, phonemes, audio }`; accumulate `audio` chunk durations (using the known sample rate) to derive per phoneme start and end times, then map phonemes to Polly symbols and on to canonical visemes, emitting `VisemeFrame[]`.
3. Route the generated audio through the shared `AudioContext` and call `resumeFromGesture()` from a user gesture, per `dec.performance-budget.md` and `src/contracts.ts`.

Caveats:
- No native timing. `kokoro-js` yields phonemes but not offsets (VERIFIED from the npm README), so timing must be derived from accumulated audio length; expect some roughness at phoneme boundaries until a proper alignment is added.
- Model size. fp32 is roughly 330 MB (82M params times 4 bytes, derived) and must be lazy loaded on demand, never counted against the 1.5 MB GLB head budget (that budget is for the mesh only). Quantized `q4`/`q8` variants are smaller but still tens of megabytes (REPORTED exact sizes; confirm from the ONNX repo).
- Autoplay and embed-ability. Streaming a several-hundred-megabyte model conflicts with the v1 embed-ability goal, which is the stated reason for the deferral; keep it strictly optional and off the default path.
- Licence is fine. Apache-2.0 weights and JS survive sublicensing (VERIFIED), so shipping Kokoro inside the npm package is permitted provided the model is fetched lazily and not embedded in the package tarball.

## Open caveats

- The Polly-shaped fixture contract does not represent `viseme_nn`; resolve via the small extension noted above before relying on local fixtures for full rig coverage.
- Exact quantized Kokoro ONNX download sizes and the precise phoneme-to-timing derivation for a runtime adapter remain to be measured at implementation time (marked REPORTED above).
- Piper voice licences are a mix and were not individually verified here; if Piper audio is ever shipped rather than used only in dev, audit the specific voice file licence first.
