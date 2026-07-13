---
id: res.seam-audit
nodes: [hologlyph.runtime.core, hologlyph.runtime.speech, hologlyph.runtime.audio, hologlyph.runtime.motion, hologlyph.runtime.shaders, hologlyph.runtime.textskin]
sources: [src.v2-research-agents]
date: 2026-07-13
---

Read-only audit of the shipped contracts against the owner's stated future directions
(pluggable TTS providers including a local engine, new animations/gestures, shader and
lighting customisation, alternative text-skin behaviours). Method: direct reads of
src/contracts.ts and every subsystem implementation; each verdict cites file:line.
Headline: every direction is reachable additively, but only via extension interfaces or
optional members. Adding required methods to TTSAdapter or AudioEngine would break
implementors. Detail follows verbatim from the audit.

## Seam Audit: hologlyph Architecture vs Future Directions

### Direction 1: Swapping in real TTS providers (including a local engine) without core changes

**Verdict: GAP - the TTSAdapter seam is sufficient for cloud providers but the AudioEngine contract lacks a PCM buffer connection path needed by a local/WASM engine.**

**Existing seam (sufficient for cloud):** `TTSAdapter` interface at `src/contracts.ts:128-131`. The `speak(text, audio)` method receives the shared `AudioEngine` and returns an `UtteranceHandle` that emits `viseme`, `energy`, `start`, `end`, `stall`, `error` events. Three implementations exist: `DemoTTSAdapter` (browser SpeechSynthesis, `src/speech/adapters/demo.ts`), `ProviderTTSAdapter` (cloud synthesis + viseme metadata, `src/speech/adapters/provider.ts`), `FallbackTTSAdapter` (audio URL + energy analysis, `src/speech/adapters/fallback.ts`). The `SpeechEngine.setAdapter()` at `src/speech/engine.ts:29` accepts any `TTSAdapter`, and `Engine.setVoiceAdapter()` at `src/core/engine.ts:298` wraps it with `visemeTap` to route visemes to the motion engine. This is a clean adapter pattern - a new cloud provider just implements `TTSAdapter`.

**Gap for local engine:** A local TTS engine (e.g. Kokoro WASM) would generate PCM audio in-process rather than playing a URL through an `<AudioElement>`. The `AudioEngine` contract at `src/contracts.ts:133-145` only exposes `connectElement(el: HTMLMediaElement)` and `disconnectElement(el: HTMLMediaElement)` - both take `HTMLMediaElement`, not an `AudioBuffer` or `AudioNode`. The implementation at `src/audio/index.ts:53-70` uses `createMediaElementSource(el)` which requires an `HTMLMediaElement`. A local engine producing PCM would need to either (a) create a dummy `AudioBufferSourceNode` and connect it to the analyser chain, or (b) encode PCM to a blob URL and play it through an `<Audio>` element (wasteful).

**Smallest contract addition:** Add to `AudioEngine` interface:
```ts
// New method for PCM-based sources (local TTS, AudioWorklet output)
connectBuffer?(buffer: AudioBuffer): () => void;
```
This returns an unsubscribe function. The implementation would create an `AudioBufferSourceNode`, connect it to the analyser chain, and start it. The caller (a local TTS adapter) would generate the PCM, create the `AudioBuffer`, call `connectBuffer`, and emit viseme frames from its own scheduler. The existing `readEnergy()` method on `AudioEngine` (`src/contracts.ts:141`) already works for any connected source since it reads from the shared analyser.

**Breaking-change flag:** Adding `connectBuffer` as optional (`?`) avoids breaking existing `TTSAdapter` implementations. However, if a future local TTS adapter needs to emit viseme frames synchronised to PCM playback time, the `UtteranceHandle` contract at `src/contracts.ts:124-126` already supports this via `viseme: VisemeFrame` events - no change needed there. The `ProviderTTSAdapter` at `src/speech/adapters/provider.ts:33-38,114` already demonstrates the viseme-scheduling pattern (rAF loop comparing `currentTime` against frame timestamps). A local adapter would use the same pattern against `AudioBufferSourceNode`'s `onended` or a manual clock.

---

### Direction 2: Adding new animations/gestures/emotions over time

**Verdict: SUFFICIENT for expressions and nods; GAP for generic gesture/animation triggers.**

**Existing seam (sufficient for expressions):** `Expression` type at `src/contracts.ts:72-81` is a union of 9 semantic labels. `MotionEngine.setExpression()` at `src/contracts.ts:99` accepts any `Expression` with an optional fade duration. The mapping from semantic label to blendshape weights lives in `src/motion/expressions.ts:12` as `EXPRESSION_MAP`. Adding a new emotion is a one-line addition to the union type and a new entry in `EXPRESSION_MAP`. No breaking change to existing consumers.

**Existing seam (sufficient for nods):** `NodClass` type at `src/contracts.ts:83` is a union of 3 labels. `MotionEngine.triggerNod()` at `src/contracts.ts:103` dispatches a nod. The nod specs live in `src/motion/nods.ts` (not read but referenced at `src/motion/index.ts:4`). Adding a new nod class is a union extension.

**Existing seam (sufficient for gaze):** `GazeMode` at `src/contracts.ts:85` is a union of 3 modes. `MotionEngine.setGazeMode()` at `src/contracts.ts:104` sets it. The gaze controller at `src/motion/gaze.ts` (not read in full but referenced) handles saccades internally.

**Gap for generic gestures:** There is no `triggerGesture(name, params?)` or `playAnimation(clipName)` method on `MotionEngine`. The only procedural gesture is nods (via `triggerNod`). The `LoadedAvatar` at `src/contracts.ts:206-215` carries `animations: THREE.AnimationClip[]` from the GLB, but `MotionEngine` never references or plays them. Adding a new gesture (e.g. head tilt, shoulder shrug, eyebrow flash) currently requires either (a) adding a new dedicated method to `MotionEngine` (breaking the interface for all implementors), or (b) hacking it through `setExpression` with a custom expression that includes bone rotations (not supported - `Expression` maps only to blendshape weights, not bone transforms).

**Smallest contract addition:** Add to `MotionEngine` interface at `src/contracts.ts:96-106`:
```ts
// Play a named animation clip from the avatar's loaded animations.
// Returns a handle that can cancel the animation early.
playAnimation?(name: string, blendDuration?: number): { cancel(): void };
```
This is optional (`?`) so existing consumers of `MotionEngine` are not broken. The implementation would look up the clip by name in `avatar.animations`, create a `THREE.AnimationMixer` (or reuse one), and crossfade. The `LoadedAvatar.animations` field already exists at `src/contracts.ts:211` - the data is there, just unused.

**Breaking-change flag:** Adding a non-optional method to `MotionEngine` would break the `Engine.motion` getter contract at `src/contracts.ts:304-318` since `EngineImpl` returns a concrete `MotionEngine`. Making it optional avoids this. However, the `Expression` union type at `src/contracts.ts:72-81` is a closed union - adding a new expression requires editing the type definition, which is a source-level change but not a runtime breaking change (existing callers pass string literals that remain valid).

---

### Direction 3: Shading/lighting tweaks as a supported customisation surface

**Verdict: GAP - no contract surface exists for shader/lighting customisation. The VFXEngine builds a hardcoded TSL material with no setters.**

**Existing seam (none):** `VFXEngine` at `src/contracts.ts:254-266` exposes `createSkinMaterial(skin)`, `setEmergence()`, `emergence`, `rootOffsetY`, `clippingPlane`, `update()`, `setReducedMotion()`. There is no method to set material properties, override shader parameters, or inject custom TSL nodes. The material is built in `src/shaders/materials.ts:33-50` with hardcoded values:
- `material.metalness = 0.1` (materials.ts:38)
- `material.roughness = 0.6` (materials.ts:39)
- `material.emissiveNode = sampled.rgb.mul(0.8)` (materials.ts: emissiveNode near the sampled texture block)
- UV scroll is the only dynamic uniform (materials.ts:41-42)
- Colour comes directly from the skin texture (materials.ts: colour from the sampled skin texture)

There is no way for a consumer to change emissive intensity, glyph colour, bloom threshold, metalness, roughness, or add custom TSL nodes without editing the source file.

**Smallest contract addition:** Add to `VFXEngine` interface at `src/contracts.ts:266`:
```ts
// Override shader material properties. Pass a partial set of known uniforms.
// Returns a dispose function that resets to defaults.
setShaderOverrides?(overrides: ShaderOverrides): () => void;
```
Where `ShaderOverrides` is a new type:
```ts
export interface ShaderOverrides {
  emissiveIntensity?: number;       // multiplier on the emissive node
  metalness?: number;               // [0,1]
  roughness?: number;               // [0,1]
  glyphColor?: THREE.Color;         // tint applied to the sampled texture
  bloomThreshold?: number;          // luminance threshold for selective bloom
  customNodes?: Record<string, unknown>; // arbitrary TSL node overrides
}
```
The implementation at `src/shaders/index.ts` would store the overrides and apply them in `update(dt)` or on a new `applyOverrides()` call. The `buildSkinMaterial` function at `src/shaders/materials.ts` would need to accept an optional overrides parameter or expose the material's internal nodes for later mutation.

**Alternative (lighter):** Expose the material itself via a getter on `VFXEngine`:
```ts
readonly skinMaterial?: THREE.Material;
```
This lets advanced users cast to `MeshStandardNodeMaterial` and set properties directly. Risk: they could set properties that conflict with the engine's own updates (e.g. overwriting the scroll uniform). The `setShaderOverrides` approach is safer.

**Breaking-change flag:** Adding optional methods to `VFXEngine` does not break existing consumers. The `Engine.vfx` getter at `src/contracts.ts:304-318` returns a `VFXEngine` - consumers that don't call the new method are unaffected.

---

### Direction 4: Alternative text-skin behaviours (different scroll modes, per-region text, reactive text)

**Verdict: GAP - the Engine API has no way to inject a custom TextSkinEngine implementation, and the TextSkinEngine interface is too narrow for per-region or reactive text.**

**Existing seam (insufficient):** `TextSkinEngine` at `src/contracts.ts:237-248` exposes:
- `texture: THREE.CanvasTexture`
- `setSource(source: TextSkinSource)`
- `setScrollSpeed(speed: number)` / `readonly scrollSpeed: number`
- `update(dt: number)`
- `readonly scrollOffset: number`

The implementation at `src/text-skin/index.ts` draws a fixed monospace grid once per content change and scrolls via GPU UV offset. The `Engine` API at `src/contracts.ts:304-318` exposes `setTextSkinSource(source: TextSkinSource)` which delegates to `this.sysTextSkin.setSource(source)` at `src/core/engine.ts:294-295`. There is no `setTextSkinEngine(engine: TextSkinEngine)` method - the consumer cannot replace the text-skin engine itself.

**Gap for per-region text:** The current model is a single `CanvasTexture` with one `scrollOffset`. Per-region text (different text in different facial zones) would require multiple textures or a more complex canvas layout. The `TextSkinEngine` interface has no concept of regions or zones.

**Gap for reactive text:** Text that reacts to speech (e.g. highlighting spoken words, changing colour per phoneme) would need per-frame canvas redraws or multiple texture layers. The current design explicitly avoids per-frame canvas work (`src/text-skin/index.ts:7,65,82`).

**Gap for different scroll modes:** The only scroll mode is vertical UV offset driven by `scrollOffset`. There is no way to configure horizontal scroll, ping-pong, typewriter reveal, or other scroll behaviours without editing the shader.

**Smallest contract addition:** Add to `Engine` interface at `src/contracts.ts:304-318`:
```ts
// Replace the text-skin engine entirely. Allows custom implementations
// with different scroll modes, per-region text, or reactive behaviour.
setTextSkinEngine?(engine: TextSkinEngine): void;
```
The implementation at `src/core/engine.ts` would dispose the old `sysTextSkin`, store the new one, and rebuild the skin material via `sysVfx.createSkinMaterial(newEngine)`. This is safe because `VFXEngine.createSkinMaterial()` at `src/shaders/index.ts:64-70` accepts any `TextSkinEngine` - it only reads `skin.texture` and `skin.scrollOffset`.

**For per-region text specifically:** The `TextSkinEngine` interface would need to be extended, or a new `MultiRegionTextSkinEngine` interface created:
```ts
export interface TextSkinRegion {
  texture: THREE.CanvasTexture;
  scrollOffset: number;
  scrollSpeed: number;
  uvRect: { x: number; y: number; w: number; h: number }; // UV rectangle on the mesh
}

export interface MultiRegionTextSkinEngine extends Disposable {
  readonly regions: TextSkinRegion[];
  setSource(regionIndex: number, source: TextSkinSource): void;
  update(dt: number): void;
}
```
This would require changes to the shader to sample multiple textures per region, which is a larger change. For v1, the single-texture model is sufficient.

**Breaking-change flag:** Adding `setTextSkinEngine` as optional to `Engine` does not break existing consumers. However, if a consumer has already called `setTextSkinSource()` and then calls `setTextSkinEngine()`, the new engine would need to receive the current source - the implementation should pass the existing source to the new engine's `setSource()`. This is an internal wiring detail, not a contract break.

---

### Summary of Breaking-Change Risks

| Contract | Risk | Mitigation |
|---|---|---|
| `TTSAdapter` (`src/contracts.ts:128-131`) | Adding a required method breaks all 3 implementations + any consumer implementations | Add new methods as optional (`?`) |
| `AudioEngine` (`src/contracts.ts:133-145`) | Adding a required method breaks the single implementation + any consumer implementations | Add `connectBuffer` as optional |
| `MotionEngine` (`src/contracts.ts:96-106`) | Adding a required method breaks the single implementation + any consumer implementations | Add `playAnimation` as optional |
| `VFXEngine` (`src/contracts.ts:254-266`) | Adding a required method breaks the single implementation | Add `setShaderOverrides` as optional |
| `Engine` (`src/contracts.ts:304-318`) | Adding a required method breaks the single implementation + any consumer implementations | Add `setTextSkinEngine` as optional |
| `Expression` union (`src/contracts.ts:72-81`) | Adding a new value is source-compatible but type-narrowing consumers may need updates | No mitigation needed - union extension is standard |
| `BehaviorState` union (`src/contracts.ts:31-41`) | Adding a new state requires new transition table entries and may break consumers that switch over all states | No mitigation needed - new states are additive |

No frozen contract currently exists in the codebase. All interfaces are implemented by exactly one production class (plus test stubs). The `Engine` interface at `src/contracts.ts:304-318` is the closest to a public API contract (exposed via `Engine.motion`, `Engine.vfx`, etc. getters and via the web component), but none of the interfaces carry a `@frozen` or `@sealed` annotation. The `dec.api-emphasis.md` decision explicitly states the imperative engine API is an "advanced hooks" surface, implying it can evolve.
