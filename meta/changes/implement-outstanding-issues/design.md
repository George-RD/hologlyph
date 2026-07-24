# Design: implement-outstanding-issues

## Approach

Use one coordinated change because the five todos share the avatar, shader, demo, and speech integration surfaces. Load-time asset processing bakes feature attributes. The shader owns typed, uniform-backed look controls. Demo-only experiments remain isolated from production defaults. Kokoro is an optional, dynamically imported adapter exposed from a separate speech entry. Tongue articulation is authored as committed sparse source-vertex corrections consumed by the deterministic asset pipeline.

`kokoro-js` 1.2.1 exposes phoneme strings and audio chunks but no phoneme timestamps. The adapter therefore derives deterministic per-phoneme offsets from each chunk's measured PCM duration. This is recorded as a deviation from the todo's exact-timing premise rather than misrepresented as provider alignment.

## Changes

ADDED:
- Typed owner-approved head configuration, feature masks, eye material, and blink-hold control.
- Lab background themes, custom background, opaque-core prototype, day/night preset, caruncle-size control, and projection-seam comparison.
- Lazy Kokoro adapter, optional dependency, speech package entry, and demo load/fallback flow.
- Three canonical tongue morphs, local sculpt manifest/data, runtime coupling, and dedicated verification.

MODIFIED:
- Core avatar material wiring, text-skin ownership, shader material graph, motion engine, rig validation, asset pipeline, demo, tests, eval baseline, package exports, and Cairn artefacts.

REMOVED:
- Lab caruncle opacity control and competing production look constants.
- The obsolete claim that tongue articulation is unavailable.

RENAMED:
- None.
