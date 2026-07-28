---
id: src.shojiwm-liquid-shaders-2026-07-25
file: ./meta/sources/src.shojiwm-liquid-shaders-2026-07-25.md
type: external source read
verification: unverified
date: 2026-07-25
---

# ShojiWM liquid terminal shaders, read 2026-07-25

Owner reference for the liquid-glass look: `bea4dev/liquid-terminal-config-shojiwm`,
a configuration for ShojiWM, a Wayland compositor with a Rust core and a
TypeScript server-side-decoration layer. Repository contents include
`liquid-glass.frag`, `water-terminal.frag`, `blur.frag`, `layer-blur-mask.frag`,
`electric-frame.frag`, `window-shadow.frag`.

Read from
https://raw.githubusercontent.com/bea4dev/liquid-terminal-config-shojiwm/main/src/liquid-glass.frag
and
https://raw.githubusercontent.com/bea4dev/liquid-terminal-config-shojiwm/main/src/water-terminal.frag

## liquid-glass.frag

Cites https://medium.com/@aghajari/liquid-glass-ios-effect-explanation-dabadd6414ae.
A 2D rounded-box SDF lens over the window texture:

```glsl
float distFromCenter = 1.0 - clamp(inversedSDF / max(distortion_depth, 0.0001), 0.0, 1.0);
float distortion = 1.0 - sqrt(max(1.0 - pow(distFromCenter, 2.0), 0.0));
vec2 offset = distortion * normalizedGlassCoord * glassSize * 0.5 * distortion_strength;
...
vec2 shift = normalizedGlassCoord * edge * chromatic_shift_px;
vec3 glassColor = vec3(
    getTextureColorAt(glassColorCoord - shift, rect_size).r,
    getTextureColorAt(glassColorCoord, rect_size).g,
    getTextureColorAt(glassColorCoord + shift, rect_size).b
);
```

Spherical displacement profile weighted by distance to the SDF edge, plus a
three-tap chromatic split and a flat tint. No IOR trace, no per-pixel normals.

## water-terminal.frag

An analytic ripple field, eight directional cosine waves, normals by finite
difference, UV refraction, plus a cheap reflection and directional ripple light:

```glsl
float dx = emboss * (center - water_height(uv + vec2(sample_delta.x, 0.0), t));
float dy = emboss * (center - water_height(uv + vec2(0.0, sample_delta.y), t));
vec2 refracted_uv = uv + vec2(dx, dy) * refraction_strength;
...
float ripple_light = clamp(dot(normalize(vec2(dx, dy) + 0.0001), light_dir), 0.0, 1.0);
```

## Relevance

Same technique family as `liquidGL` and as the fresnel-weighted refraction in
`src/shaders/materials.ts`. The difference is access, not sophistication: a
compositor owns every window as a GPU texture, so the content behind a surface
is simply an input. On the web that input does not exist without the page
supplying it (see `src.dom-capture-survey-2026-07-25`).
