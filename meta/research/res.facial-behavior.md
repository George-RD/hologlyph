---
id: res.facial-behavior
nodes: [hologlyph.runtime.motion, hologlyph.runtime.speech, hologlyph.runtime.audio, hologlyph.runtime.behavior]
sources: [src.deep-research-1, src.deep-research-2]
date: 2026-07-08
---

Both reports agree on a blendshape-driven face with a VRM-like semantic expression vocabulary, a saccadic gaze engine (empirical main-sequence: duration/amplitude + peak-velocity model), micro-saccadic fixation jitter, gaze aversion during speaking/thinking (15-30 deg cone), and at least three distinct nod classes (listener backchannel, affirmative, speech-emphasis). Both model behavior as an explicit state machine rather than one continuous procedural loop.

Contested: lip-sync / speech architecture. Report-1: on-device Kokoro TTS (WebGPU/WASM) that emits viseme indices directly, plus an AudioWorklet STFT FFT fallback mapping spectral energy to mouth-open/width/roundness; 15 Oculus visemes via rule-based G2P. Report-2: cloud-provider viseme metadata (Azure 55-frame blend-shape JSON, Amazon Polly speech marks) with a browser `SpeechSynthesis` demo mode and a Web Audio `AnalyserNode` energy fallback. Resolved by accepted decision `dec.speech-architecture`: provider-first three-mode (demo / cloud visemes / AnalyserNode fallback), on-device Kokoro deferred from v1.
