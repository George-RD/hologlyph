# Tasks

- [x] Split M_EyeBlend into the eye_trim primitive (build-bust.ts); engine KEEP_MATERIALS; structural test updates
- [x] Drop M_LacrimalFluid (tear-film band capping the eyeball; owner screenshot evidence)
- [x] Root-cause the mesh tears by elimination and attribute-split bisect (position int16 = trigger)
- [x] optimize.ts: float32 base positions, quantise the rest; explicit reorder+quantize+EXT compression replacing meshopt()
- [x] PLANAR_DENSITY 20 -> 40 (production + lab) compensating the 2x shader-space position scale; constant-pin test updated
- [x] Tighten aperture oracle to /^eye_(sclera|iris)$/ so trim shells cannot masquerade as eye hits
- [x] Regenerate GLB (1.07 MB); 228/228 tests incl. byte determinism; tsc, build, lint, cairn hook all exit 0
- [x] Visual verification: 7-angle sweep at high density (front, yaw30/60, profile, back34, top-down, chin-up) all tear-free; blink closes; eval overall pass against unchanged baseline
