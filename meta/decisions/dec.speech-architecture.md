---
id: dec.speech-architecture
nodes: [hologlyph.runtime.speech, hologlyph.runtime.audio, hologlyph.runtime.motion]
status: accepted
date: 2026-07-08
informed_by: [res.facial-behavior, src.deep-research-1, src.deep-research-2]
---

Three-mode, provider-first speech layer with a clean adapter seam:

1. Demo mode = browser `SpeechSynthesis` (no visemes, coarse mouth motion only).
2. Production mode = cloud TTS returning viseme metadata (Azure 55-frame blend-shape JSON at 60 FPS, Amazon Polly speech marks) mapped to the blendshape rig.
3. Fallback mode = Web Audio `AnalyserNode` energy -> coarse jaw-open / lip-roundness.

On-device Kokoro TTS (WebGPU/WASM emitting viseme indices + AudioWorklet STFT) is a FUTURE fourth adapter, DEFERRED from v1: it conflicts with the < 1.5 MB asset budget and adds `AudioContext`/autoplay-gesture complexity that fights the widget's embed-ability.

Speech generation is strictly separated from facial driving data; the viseme -> blendshape adapter is provider-agnostic so any metadata-capable provider can plug in.

Rationale (adjudicated from adversarial debate): for a drop-in website widget, provider visemes give higher fidelity than energy inference, avoid shipping a model/WASM runtime, and sidestep autoplay restrictions (cloud audio can stream from the same user gesture that resumes the AudioContext). The reformer's privacy/key/network concerns are real but secondary to the v1 embed-ability goal.
