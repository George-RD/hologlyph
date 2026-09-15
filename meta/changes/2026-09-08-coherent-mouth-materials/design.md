# Design

## Identity before illumination

The combined mouth primitive retains a VEC2 `_ORAL_REGION` attribute containing
[teeth, tongue] weights. The pipeline derives teeth from category 4 (`M_Teeth`)
and tongue from category 3 intersected with the committed tongue vertex mask.
Gums receive [0, 0]. The attribute survives simplification and compression;
GLTFLoader exposes it as `_oral_region`. A legacy/custom avatar without the
attribute falls back to a dark cavity instead of guessing anatomical identity.

## Shading

One opaque, depth-writing NodeMaterial shares the head's live glyph colour,
position and normal graphs. Teeth use a cool neutral base with directional
shading and restrained text detail. The tongue uses muted violet, a dark root,
rounded sides and a subtle centre groove. Those spatial terms modulate the
labelled tongue's illumination only; they never classify gum walls as anatomy.
There is no cavity-wide rim glow, extra atlas, updater or draw pass.

The unlit NodeMaterial base honours normalNode. Three r178's Basic subclass
does not. Existing disposal and normal-graph regression tests remain in place.
The engine retains original materials for disposal and builds one replacement
mouth material per avatar. Original geometry and speech poses are unchanged.

## Visual acceptance

Inspect both text and glass modes, front and oblique views, and closed, AA, EE,
SS, OH, TH and raised-tongue poses. SS exposes the incisors naturally; AA/EE do
not need to show every tooth because the authored upper lip occludes them.
Do not move the teeth or alter visemes merely to make a screenshot show incisors.
Review actual renderer frames, not generated concept images. Match the canvas
CSS size and engine resize call so the face is not stretched in review captures.
