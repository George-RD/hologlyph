---
id: src.owner-approved-look-2026-07-21
file: ./meta/sources/src.owner-approved-look-2026-07-21.md
verification: unverified
type: owner session config export
date: 2026-07-21
---

# Owner-approved text-skin look (feature-shading lab, 2026-07-21)

Exported via the lab's "copy config JSON" by George after live tuning on the
post-#46 asset (eye_trim primitive, float32 positions, PLANAR_DENSITY 40).
"In its current form, im way happier than yesterday." These values are the
lab's boot defaults and the 'Owner 07-21' preset, and MUST seed the TDD pins
when the feature-shading system is ported into src/ properly.

Owner caveat recorded verbatim: "some of the values to adjust are maybe not
the right things for us atm" - the control SET is still evolving (caruncle
size-not-opacity, lips mask tighter than the chin, background/theme
adaptation), but the rendered look below is the approved reference.

```json
{
  "scrollSpeed": 0.02,
  "expression": "neutral",
  "baseOpacity": 0.075,
  "lipsOp": 0.32,
  "noseOp": 0.38,
  "jawOp": 0.21,
  "orbitOp": 0.15,
  "browOp": 0,
  "socketShadow": 0.64,
  "socketMask": 1,
  "socketSize": 1,
  "cavity": 0.45,
  "lipDark": 0.5,
  "lipHue": 0.6,
  "lipGate": 1.4,
  "eyelid": 0.5,
  "brow": 0.3,
  "browGate": 2.2,
  "glyphScale": 0.79,
  "hDensity": 2,
  "vDensity": 2,
  "sharp": 5.5,
  "tone": 0.21,
  "toneAmt": 0.65,
  "skinWarm": 0,
  "rim": 0.065,
  "glowGain": 0.55,
  "eyeDensity": 300,
  "scleraGlow": 0.51,
  "irisGlow": 2.35,
  "eyePresence": 0.74,
  "pupil": 0.24,
  "flowDir": 1,
  "irisSize": 0.43,
  "irisColor": "#d78bf8",
  "scleraColor": "#e1edf9"
}
```
