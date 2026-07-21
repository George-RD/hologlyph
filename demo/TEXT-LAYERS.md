# How the text layers work (feature-shading lab)

You are looking at ONE mesh + one eyeball pair, but several distinct visual
layers stack up. Everything below is verified against the actual material
config (FrontSide, transparent, bind-space triplanar projection).

## 1. Front skin glyphs (the crisp layer)

The character grid is drawn once onto a canvas texture, then projected onto
the bust in bind space (triplanar, normal-weighted, three axes). Each grid
row advances at its own GPU scroll rate (row-staggered flow), so rows drift
apart - that alone reads as "multiple streams".

Controls: text scroll speed, glyph size, horizontal/line density, per-zone
opacity sliders, glyph glow gain.

## 2. Triplanar ghosting (doubled text, different directions)

Text is projected along three axes and blended by the surface normal. Where
the surface faces between axes (nose sides, jaw line, temples, crown) two
projections overlap at partial weight - doubled, criss-crossing glyphs
moving in different directions. This is the main "layers behind" effect and
it lives ON the near surface.

Controls: "projection sharpness" narrows the blend zone (higher = less
double-vision, at the cost of a harder seam between projections).

## 3. Far-side surfaces at grazing angles

The skin is translucent and single-sided (FrontSide): the inside of the
shell is never rendered, so there is no true "inner layer". What shows
through the low-opacity gaps between glyphs is the dark interior plus, near
silhouettes, far surfaces whose outward normals still face the camera (the
far cheek seen across the head, mirrored because you view its projection
from the other side).

Controls: "base opacity floor" gates how much shows through the glyph gaps.

## 4. Eye micro-text (fully independent layer)

The eyeballs are separate meshes with their own much denser grid: sclera
rings + iris polar flow (text falls into the pupil like a waterfall),
scrolling at 0.4x the head speed.

Controls: eye text density, sclera text glow, iris glow / hue / size, pupil
size, reverse iris flow, eyeball presence.

## 5. Rim glow and specular sheen

A fresnel term adds the cool blue edge at grazing angles (unshaded so the
contour always reads). The scene lights add a specular sheen on top of the
glyph emissive.

Controls: "rim glow", "surface roughness" (1 kills sheen), "glyph glow gain"
(overall emissive brightness).

## Individually controllable?

| Layer | Slider(s) | Independent? |
|---|---|---|
| Front glyphs | scroll, glyph size, densities, zone opacities, glow gain | yes |
| Triplanar ghosting | projection sharpness | yes (trade: seam hardness) |
| See-through gaps | base opacity floor | yes |
| Eye micro-text | the whole eyes group | fully independent material |
| Rim/specular | rim glow, roughness | yes |

## Asset-level layers (not shader)

- mouth_interior: dark cavity primitive, never text-skinned.
- eye_trim (PR #46): the caruncle-corner shell, dialable via
  "inner-corner trim opacity".
- The occlusion membrane, lash cards, and lacrimal tear film are gone from
  the asset (PRs #44, #46).
