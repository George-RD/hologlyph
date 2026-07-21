# Design: landing-quickbar

## Approach

Move, do not duplicate: the quickbar owns the single set of expression and
speak buttons (the panel keeps tuning-only controls), so there is no state
mirroring between two button sets. The expression wrapper uses
display:contents so all quickbar items share one flex row-wrap.

## Changes

ADDED:
- #quickbar overlay styles + markup in demo/index.html; gear glyph on
  #tuneBtn.

MODIFIED:
- Expressions/speak creation appends to the quickbar; speak onerror no
  longer zeroes the viseme window.

REMOVED:
- The panel's "expressions + speech" group (hint text folded into a code
  comment and the speak button title).
