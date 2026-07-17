# Design: lipsync-skin-projection

## 1. Demo-mode visemes (src/speech)

New pure module `src/speech/visemes.ts`:

- `wordAt(text, charIndex, charLength?)`: extract the word the boundary
  event points at. Uses `charLength` when the browser supplies it, else a
  word-character scan from `charIndex`.
- `visemeSequenceForWord(word)`: grapheme-to-viseme mapping with digraph
  handling (`th`, `ch`/`sh`/`tch`, `ph`, `oo`, `ee`, `ou`/`ow`, `qu`).
  Letters map onto the canonical `RIG_VISEME_MORPHS` vocabulary; unknown
  characters are skipped.
- `weightsForViseme(viseme)`: per-viseme `BlendshapeWeights` giving the
  viseme morph 1.0 with `jaw_open` pinned to 0: the authored viseme targets
  embed their own jawOpen deltas, so any extra coupling double-opens the
  mouth (see section 4).

`DemoTTSAdapter.speak` keeps its 30 ms timer but walks a viseme sequence
instead of decaying an energy scalar:

- `onboundary(event)`: extract the word via `wordAt`, build the sequence,
  reset the cursor. Boundary events with no word yield an empty sequence.
- Timer tick: advance the cursor at ~75 ms per viseme and emit
  `handle.viseme({ time, weights })`. Past the end of the sequence, emit a
  silence frame (`viseme_sil` with zero jaw) so the mouth closes between
  words rather than freezing.
- No `energy` events from the demo adapter any more; core's energy path
  remains for the fallback adapter only.

The fallback adapter is untouched: it has only analyser energy, so
inventing phonemes there would be dishonest. Its jaw motion is smoothed by
the motion-engine change below.

## 2. Mouth smoothing (src/motion)

MotionEngine keeps a persistent smoothed weight per mouth-region morph.
Each `update(dt)`:

- target = viseme-frame weight when a frame is active, else the
  expression-derived weight (mouth morphs) or 0 (viseme morphs).
- current += (target - current) * (1 - exp(-dt / tau)), with
  tau_attack = 0.05 s when rising and tau_release = 0.12 s when falling.
- Non-mouth morphs keep the existing crossfade path unchanged.

This removes the per-frame snap for every speech mode (demo visemes,
provider visemes, fallback jaw energy).

## 3. Projected grid, translucency, glow (src/shaders, src/text-skin)

`buildSkinMaterial` stops sampling `uv()` and instead computes a frontal
planar object-space projection in TSL (final decision after a cylindrical
first attempt pinched the grid into radial strings at the crown and fanned
it across the chest):

- u = position.x * U_SCALE + 0.5
- v = position.y * V_SCALE + scroll

`U_SCALE`/`V_SCALE` derive from one `PLANAR_DENSITY` (glyph cells per world
unit), aspect-corrected for the default 96x64 grid so cells stay square.
The visible front carries one straight constant-scale grid across face,
neck, and chest; the reported face-versus-chest mismatch was a UV-island
artefact and disappears with authored UVs out of the sample path. The
canvas texture gets `RepeatWrapping` on both axes so the grid tiles under
scroll. Glyphs stretch along the silhouette at grazing angles, accepted as
part of the projected-hologram look.

`drawText` (text-skin) fills every cell from one continuous repeating
character stream instead of cycling word-wrapped lines: cycled lines
stacked their spaces into fixed columns, which rendered as dark vertical
barcode channels. The repeat unit is space-padded until its length no
longer divides the column count, so successive rows start at different
phases.

Material look:

- `transparent = true`; `opacityNode = clamp01(base + luma * (1 - base))`
  with base ~0.35, so the unlit backdrop is translucent and lit glyphs are
  near-opaque.
- `emissiveNode = sampled.rgb * GLOW_GAIN` (subtle glow without a bloom
  pass; no post-processing pipeline exists and adding one is out of scope).
- A small fresnel rim term added to the emissive for the holographic edge.

Pure helpers (projection maths on plain numbers) are exported for unit
tests; the node graph itself stays lazily built and happy-dom safe.

## 4. Eyes read as closed; mouth reads as a glowing hole

Diagnosed: the shipped GLB was ONE primitive with ONE material, so the
eyeball and mouth-interior geometry shared the text-skin material, and
their UVs sat in the squeezed dark strip of the atlas. Fixed at asset
generation:

- Eyeballs split into a separate `eyes` mesh (no morph targets, skinned to
  eye_l/eye_r) with `eye_sclera` (light) and `eye_iris` (dark) materials.
- Mouth interior (gums/tongue AND teeth, merged into one dark cavity after
  a separate light teeth material rendered as fang-like silhouettes) split
  into a `mouth_interior` primitive INSIDE the bust mesh; it keeps all 27
  morph targets and deforms with the jaw.
- The engine applies the text-skin material only to morph meshes whose
  material name is not in a keep-set {mouth_interior}; the placeholder
  avatar still receives the skin.
- Vowel viseme recipes restrained (viseme_aa jawOpen 1.0 -> 0.55 and
  similar) so weight-1 shapes read as natural speech, and viseme frames pin
  `jaw_open` to 0 rather than coupling it on top of the authored targets,
  which double-opened the mouth.

## Open points (resolved during implementation)

- Projection density, base opacity, and glow gain were tuned via headless
  captures against the dev server; the committed constants
  (`PLANAR_DENSITY` 124, `BASE_OPACITY` 0.35, `GLOW_GAIN` 1.4, `RIM_GAIN`
  0.12) are what the captures settled on.
- positionLocal in the fragment stage DOES include morph displacement
  (MorphNode mutates the shared varying before the fragment stage reads
  it), so the grid subtly follows jaw motion; details in
  implementation-notes.md.

## Deferred (recorded as todos, not this change)

- Gaze follows the pointer, returning to forward when idle. Seam exists:
  `GazeController` modes.
- Baseline idle motion (breathing, micro head drift) so the bust does not
  read as a statue. Seam exists: procedural nod envelope in motion.
