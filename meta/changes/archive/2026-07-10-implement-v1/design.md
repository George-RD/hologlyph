# Design: implement-v1

## Approach

Contract-first parallel implementation. A single shared contract file (`src/contracts.ts`) defines every cross-module interface up front; module implementations code against it and are built in parallel. The dependency edges in `cairn.blueprint` are the authoritative import graph: a module may only import from modules it has an edge to, plus `src/contracts.ts`.

Key postures (from accepted decisions):

- Renderer: Three.js `WebGPURenderer` (WebGPU-first, WebGL2 auto-fallback). Materials authored once in TSL/NodeMaterial. Emergence = clipping plane + root translation (dec.renderer-posture).
- Text skin: `OffscreenCanvas` glyph grid uploaded as `CanvasTexture` only on content change; all scroll motion is GPU UV scroll in the shader (dec.text-skin).
- Speech: three-mode adapter seam. SpeechSynthesis demo mode, cloud viseme metadata production mode, AnalyserNode energy fallback (dec.speech-architecture).
- Behavior: explicit state machine (hidden, emerging, idle, listening, speaking, thinking, reacting-to-scroll, departing). Scroll progress normalized in JS, never CSS scroll timelines (dec.behavior-state-machine, dec.scroll-timeline).
- Motion: semantic expression vocabulary mapped to clamped blendshape weights; gaze saccades 800-1200 ms during listening, 15-30 deg aversion cone while speaking; three nod classes (dec.expression-vocab).
- Performance: single reused AudioContext, Page Visibility suspension, hard dispose() on disconnect, prefers-reduced-motion support (dec.performance-budget).
- API: `<hologlyph-head>` is primary; imperative `HologlyphEngine` exported as documented advanced surface (dec.api-emphasis).

## Delta operations

ADDED: package.json, tsconfig.json, vite/vitest config, src/contracts.ts, src/core/, src/renderer/, src/text-skin/, src/shaders/, src/motion/, src/speech/, src/audio/, src/behavior/, src/asset/, src/element/, src/adapters/, tools/asset-pipeline/, demo/, test suites per module.

MODIFIED: cairn.blueprint only if a path declaration needs an additional file claim (e.g. root config files claimed by the system node).

REMOVED: none.

## Meta

A cairn-friction log is maintained at `meta/cairn-feedback.jsonl`: one JSON object per observation of where cairn (CLI, MCP, or the cairn-* skills) missed the mark during this implementation, with the proposed improvement.
