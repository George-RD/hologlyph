---
node: hologlyph.runtime.shaders
status: done
created: 2026-07-21
---

# Background awareness: lab switcher now, adaptive look later

Exploratory direction from the owner (2026-07-21):

1. Lab: a background control (colour picker + a few host-page-like themes,
   light/dark/mid) so the head can be judged against different backdrops.
2. Product question: the head must stay visible on arbitrary host pages.
   Candidate: opaque (or near-opaque) core head with the text carried on a
   translucent shell over it - kills the back-of-head see-through at
   grazing angles AND gives a stable self-background so the look no longer
   depends on the page behind. Alternatively/additionally a theme parameter
   (day/night) adjusting glyph colour, base opacity floor, and rim.
3. Note the coupling: the "see-through gaps" are part of the current
   approved look on dark backgrounds; an opaque core changes the holo
   character. Prototype in the lab as a toggle (second inner mesh or
   backdrop-coloured base layer) and get owner reaction before any library
   work.

## Implementation checkpoint (2026-07-23)

The lab now provides dark, mid, and light host themes, a custom background
colour, an opaque-core toggle, and day/night look presets. Browser smoke
exercises every control. Production adaptive background, core, and theme
behaviour was approval-gated. The decision below closes this todo; moving any
of those controls into `src/` would require a new owner approval.

Owner decision (2026-07-23): keep these controls lab-only and preserve the
current library defaults.

## Owner reversal (2026-07-25)

The owner asked for the head to read as glass that works against arbitrary
website backgrounds. That is the separate approval the 2026-07-23 decision was
waiting on, for the background half only. The canvas is now transparent and
`HeadConfig.skin.backdrop` carries the host page colour, auto-detected on
mount, feeding a pure adaptation (`src/shaders/glass.ts`). See
`dec.glass-backdrop-adaptive`. The opaque-core toggle stays lab-only:
fresnel edge thickening solved the grazing-angle see-through without hiding
the page.
