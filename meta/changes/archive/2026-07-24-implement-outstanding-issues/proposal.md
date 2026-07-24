# Proposal: implement-outstanding-issues

## Motivation

Five Cairn todos remain open after the owner review rounds. The approved feature-shading look still lives only in the demo, the lab lacks the requested background and anatomy controls, speech has no opt-in high-quality voice, and the shipped rig cannot articulate the tongue.

## Scope

- Port the owner-approved feature-shading look into the library behind a typed head configuration.
- Add lab background, opaque-core, day/night, caruncle-size, lip-band, and projection-seam controls.
- Add a lazy Kokoro-82M adapter and demo load flow without increasing the default bundle.
- Add reproducible tongue articulation morphs and viseme coupling.
- Preserve graceful fallback, reduced-motion behaviour, disposal discipline, asset reproducibility, and the 1.5 MiB asset budget.

## Out of scope

- Shipping automatic host-background adaptation or an opaque-core production default before owner approval of the lab prototype.
- Bundling or automatically downloading Kokoro model weights.
- Adding a raw PCM method to `AudioEngine`.
- Adding a tongue bone or changing provider viseme payloads.
