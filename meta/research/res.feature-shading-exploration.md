---
id: res.feature-shading-exploration
nodes: [hologlyph.runtime.shaders, hologlyph.runtime.textskin, hologlyph.asset.loader, hologlyph.runtime.motion, hologlyph.runtime.behavior]
sources: [src.feature-shading-lab-sessions]
date: 2026-07-21
---

Exploratory lab (demo/feature-shading-lab.html, demo/feature-shading-variants.html;
owner-driven slider sessions, not yet landed as library code) into making facial
features legible through the text skin. Findings, in confidence order:

1. Programmatic feature boundaries exist in the shipped GLB and cost nothing to
   extract: per-vertex morph-target delta magnitude gives clean masks for lips
   (visemes + jaw_open + mouth_round, 13% of bust verts), eyelids (blink morphs,
   8.2%), and brows (brow morphs, 5.3%). A fourth mask, geometric one-ring
   concavity ("cavity AO"), darkens sockets, nostrils, lip line and nasolabial
   folds with no morph data. Bake cost ~15 ms at load, +4 float attributes/vertex.
2. Separate micro-text eyes are the single largest legibility win. The eye
   meshes (eye_sclera/eye_iris) already stand apart from the bust shell, so the
   head text naturally stops at the socket; giving the eyeballs their own denser
   TextSkinEngine grid (smaller font) with a choosable iris glow colour makes the
   whole face parse as a face. Owner hypothesis confirmed visually.
3. Feature-mask shading modulation (darken creases, darken/warm lips, shadow eye
   orbits) is live-tunable as TSL uniforms. Verified monotonic against the
   baseline by screenshot pixel diff. Two traps found: (a) a multiplicative warm
   tint on cyan glyphs washes to grey; lip/skin hue cues must recolour via
   mix(glyph, colour*luma, mask); (b) the raw brow and lip masks are broad
   (jaw motion, forehead), so both need a pow() gate to tighten to the ridge/band.
4. Triplanar "text going both ways" confusion on the nose sides is the blend
   zone; a projection-sharpness uniform (weight exponent 2..8) trades ghosting
   against seam hardness. Related regression metric already exists
   (2026-07-18 blend-zone ghosting change).
5. Motion: natural head turning already ships (setHeadTarget: full pose on head
   bone + 0.35 neck-follow fraction, exp smoothing; idle drift/breath/blink via
   IdleController). The lab exposes the neck fraction as a pivot slider after the
   owner read the head-dominant turn as "too literal"; production may want a
   higher neck share. Scroll speed already has a public runtime API
   (TextSkinEngine.setScrollSpeed, reduced-motion aware); owner prefers 0.02
   as the idle default (current default 0.08).

Direction (owner, 2026-07-21, pending final look choice in the lab): a
"head config" JSON of these shading/fit/eye parameters per head, with static
defaults plus runtime setters so behaviour states can drive them (e.g. thinking
state raises scroll speed ~4x and applies an up-side contemplative gaze; the
BehaviorMachine already has a 'thinking' state to hook). Proper landing would
be: mask baking in buildLoadedAvatar, uniforms on buildSkinMaterial behind a
typed config surface, TDD constant pins, and an eval baseline for the accepted
look.

Round 3 (2026-07-21, owner slider session findings):

6. RIG LIMITATION (future todo, asset pipeline): every bust vertex is 100%
   weighted to the head joint (verified via JOINTS_0/WEIGHTS_0), so head yaw
   rotates the whole bust rigidly and neck articulation is impossible with the
   shipped weights. True neck pivoting needs graduated root->neck->head weight
   painting in tools/asset-pipeline/build-bust.ts.
7. Owner's key perceptual finding: CLARITY COMES FROM OPACITY, not hue. Zone
   opacity boosts (lips, nose, jaw/chin, eye orbit, brow) are the primary
   feature-legibility dial; hue/darkening are secondary. Nose has no morph, so
   its zone mask is positional (front-most surface in the mid-face band).
8. One-surface recess model (owner direction): text stays continuous over
   recesses and darkens as it goes in (socket recess shadow), the same
   mechanism cavity AO already applies to the nostrils. Opacity cutout over
   the eyes is kept only as a comparison mode. Lip mask must exclude jaw
   movers (jaw_open, viseme_aa) or "lip" effects paint the whole chin.
9. Iris sinkhole works: polar text (theta/r frame mirrored per side) flowing
   into a black pupil, live pupil-dilation uniform, reversible flow. Render
   lesson: the sclera sphere fully encloses the iris disc, so the sclera must
   be a transparent unlit cornea (no depth write, drawn before the shell)
   or the iris is invisible; eyes as unlit basic materials kill the specular
   glints that made the orbs read through the shell. An "eyeball presence"
   dial suppresses the orb in recess mode. Staged later: iris patterns and
   distortions, pupil reaction rules, eyelid-over-eye occlusion physics.

Round 4 (2026-07-21, fundamentals resolved):

10. Eye topology ground truth (gltf-transform angular scan + base-material
    render): eye_sclera and eye_iris are BOTH full concentric spheres; there
    is no corneal hole and no iris disc. The opaque sclera fully encloses the
    iris ball, so the original asset renders blank white orbs and the iris
    mesh has never been visible. Any visible-iris design must paint the iris
    procedurally; the lab now does so on the sclera's front cap (angular cone
    around +z through the ball centre, default 0.52 rad, bind-space anchored
    so it rotates with the eye bones) and hides the eye_iris mesh.
11. The bust has REAL eyelid apertures (confirmed visually on the base
    render): lid geometry with lens-shaped openings, eyeballs visible only
    through them, placement correct. The "surface in front of the eyeball"
    the owner saw is the lids, translucent under the text look. Masking
    therefore uses the real lids (socket skin-mask alpha boost), not fake
    aperture masks.
12. Iris donut spec (owner): small anatomical disc, text rings circling the
    pupil, soft brightness fade INTO the pupil void, sharp outer boundary.
    Earlier iris-covered-the-whole-cornea look was caused by normalising the
    polar frame to the full mesh cap.
13. Expressions and lab speak verified moving the face (mouth-region pixel
    diff ~40/255; surprised opens the jaw visibly). Speak drives visemes on a
    3.5 s timer with SpeechSynthesis as best-effort audio.
14. Process lesson: a "vision verification" task subagent silently fell back
    to a non-vision model and produced blind pixel-decode guesses; visual
    verification must confirm the model actually has image input, or be done
    by the orchestrator directly.

Round 5 (2026-07-21, membrane resolved):

15. APERTURE MEMBRANE (model defect, asset-pipeline todo): the bust primitive
    spans each eye opening with a thin skin membrane hugging the eyeball.
    Raycast-verified in the live scene: every ray across the aperture hits
    bust geometry 1-13 mm in front of the sclera, including dead centre. The
    membrane carries the head material, so it shows head text and blocks the
    eye when zone alpha rises (the owner's "lizard skin over the eyeball").
    It also explains the base render's grey eye: that surface is the
    membrane, not the eyeball. Proper fix: delete or separately-materialise
    the membrane faces in tools/asset-pipeline/build-bust.ts (like
    mouth_interior).
16. Lab fix that works: bake a world-space aperture mask (bust verts within
    0.98-1.10 x eyeball radius of either eye centre; one rigid matrix maps
    bind to world because the bust is 100% head-weighted) and multiply it
    out of the head material's opacity. Verified: no text over the eye at
    socket mask 1, natural dark aperture, lids intact.
17. Diagnostic lesson: the pale disc that appeared after the first (too wide,
    1.35R) cutout was NOT a membrane remnant; magenta-sclera and
    hide-eyeball probes proved it was the sclera itself, over-exposed
    because the wide band also cut lid skin. Band tightening plus a darker
    sclera floor (0.012) restored a natural almond opening. Disambiguate
    before strengthening a cut.

Round 6 (2026-07-21, owner defect reports):

18. Inner-corner cover = M_EyeBlend (caruncle shell, 24 verts/side). Real
    anatomy: split out as the dialable eye_trim primitive rather than
    dropped. M_LacrimalFluid measured as a tear-film band spanning the whole
    eye width (1.35R wide); opaque under a text skin it caps the eyeball, so
    it joined the dropped groups (PR #46).
19. Mesh tears (collar, crown, skull sides; angle-dependent black
    triangles, worse at high glyph density): pre-existing in EVERY shipped
    GLB, root-caused by attribute-split bisect to int16 quantisation of the
    base POSITION attribute on the skinned multi-primitive bust in three's
    WebGPU path. Everything else was exonerated by live A/B (masks, other
    primitives, morphs, depth-write, colour/emissive, quantisation volume,
    reorder, simplify, filters). Pipeline now ships float32 base positions,
    quantises the rest; 1.07 MB.
20. Quantised positions were 2x in shader-visible space; every density
    constant and the eval baseline encoded that scale. PLANAR_DENSITY
    doubled (20 -> 40) preserves the approved look exactly; eval passes
    against the unchanged baseline. Lesson: shader-space bind coordinates
    are part of the tuned contract; asset encoding changes can silently
    rescale them.
