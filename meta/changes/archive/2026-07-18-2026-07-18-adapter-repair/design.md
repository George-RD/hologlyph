# Design: 2026-07-18-adapter-repair

## Goal

Fix adapter and element regressions in one cohesive change without touching
`src/core` or `src/contracts.ts`:

- Route `<hologlyph-head>` resize events through the engine resize contract.
- Ensure the custom-element resize observer is reinstalled after reconnect.
- Make React and Svelte adapters pass and clear initial props correctly.
- Refresh adapter listeners when callback props change.
- Remove the deprecated `mode` API surface.

## Approach

### 1) Element: sizing flow

`HologlyphHeadElement` now owns its `ResizeObserver` lifecycle in
`_ensureResizeObserver`, disconnected only in teardown and re-created on the
next boot when `_resizeObserver` is null. Its callback now drives
`engine.resize(width, height)` and does not directly mutate canvas dimensions.

### 2) React adapter: prop and callback lifecycle

`createHologlyphHead` now:

- applies `src`, `text`, and `reduced-motion` inside the `ref` callback so props
  exist before initial boot reads options, and
- clears attributes when those props are undefined.

The event-effect dependency list now includes all callback props, so listener
rebinds happen when any callback changes.

### 3) Svelte adapter: prop clearing symmetry

`svelte.ts` mirrors the React contract and removes `src`, `text-skin`, and
`reduced-motion` when values become `undefined`.

### 4) Public API cleanup

The `mode` attribute and property surfaces are removed from the element and its
adapters. The live `mode` path was inert and had no consumer; removing it
reduces confusion and aligns adapters, element attributes, and tests.
