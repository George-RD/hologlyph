# Proposal: mobile-demo-controls

## Motivation

The deployed studio opens with its full control rail over the canvas. On a
phone the rail consumes almost the whole viewport, so the head is technically
running but cannot be judged or played with. Speech and expressions also
remain absent from the consolidated root page even though both are public
engine capabilities.

Owner direction, 2026-09-02:

- keep the configuration surface collapsed and hidden by default;
- make the head the primary mobile surface;
- provide a small expression menu;
- provide predefined captions and a direct way to make the head speak.

## Scope

- Replace the deployed root with a full-viewport, mobile-first presentation
  surface built on the public `Engine` contract.
- Add a compact bottom dock for expression, speak and sample-line actions.
- Open expressions as a bounded radial menu that stays inside a phone viewport.
- Open sample captions as a small sheet; choosing one speaks it immediately,
  while the central Say button replays the selected line.
- Keep a compact live-look drawer hidden by default.
- Preserve the previous 49-control studio at `studio.html` for deep tuning.
- Add an iPhone-sized Playwright smoke that checks disclosure, menu bounds,
  caption-driven speech and the settings drawer.

## Non-goals

- No runtime or public API changes.
- No camera contract change.
- No redesign of the full deep-tuning studio in this change.
- No automatic speech on page load; mobile browsers require a user gesture.

## Affected nodes

- `hologlyph.adapter.web-component`, demo presentation only.
