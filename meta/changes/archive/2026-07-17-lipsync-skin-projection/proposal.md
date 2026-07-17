# Proposal: lipsync-skin-projection

## Why

Three perceived-quality defects reported against the v2 bust demo:

1. Speech looks like a bad dub: the mouth flaps open and shut instead of
   tracking speech shapes. Demo mode (SpeechSynthesis) emits only a coarse
   energy spike per word boundary, and core maps that scalar straight to
   `jaw_open`. The 15 shipped viseme morphs are never driven in demo mode,
   and viseme frames are applied unsmoothed (hard set per frame).
2. The glyph grid has weird gaps and seams: the skin material samples the
   text canvas through the mesh's authored UV map, so glyph density and
   alignment follow ICT-FaceKit UV islands rather than forming one solid
   projected grid.
3. The head reads as a solid opaque object. Requested look: slightly
   translucent base with a subtle glow on the glyphs.
4. The eyes read as closed and an open mouth reads as a glowing hole: the
   shipped GLB merged eyeballs, mouth interior, and teeth into the single
   text-skinned primitive.

## What

- Demo TTS adapter derives a grapheme-to-viseme sequence for the current
  word from `onboundary` metadata (`charIndex` into the original text) and
  emits real `viseme` frames. The fallback adapter stays energy-only
  (honest: it has no timing or phoneme data).
- MotionEngine smooths mouth-region weights with attack/release time
  constants instead of hard-setting them each frame.
- The skin material projects the glyph grid in object space (frontal
  planar, aspect-corrected) instead of sampling authored UVs, making the
  grid a single straight continuous matrix across face, neck, and chest.
- The text-skin canvas fills every cell from one continuous repeating
  character stream so word gaps never stack into dark vertical channels.
- The material becomes translucent where no glyph is lit, and glyphs get a
  boosted emissive term plus a subtle fresnel rim.

## Scope

- Runtime: `src/speech`, `src/motion`, `src/shaders`, `src/text-skin`, and
  a material keep-set in `src/core` so the mouth-cavity material survives
  skinning.
- Asset pipeline: `tools/asset-pipeline/build-bust.ts` splits eye geometry
  and a dark mouth-interior cavity (gums, tongue, and teeth merged) into
  named primitives, restrains vowel jaw recipes, and the shipped
  `assets/hologlyph-bust.glb` is regenerated (~1.04 MiB, under budget,
  regen byte-equality green).
- No contract changes; `cairn.blueprint` untouched (no new nodes or edges).
