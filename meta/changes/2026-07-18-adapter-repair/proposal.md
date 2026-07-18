# Proposal: 2026-07-18-adapter-repair

## Motivation

Six verified findings show that adapter/element wiring regressed on reconnect,
initial prop propagation, callback refresh, and inert API drift (`mode`). The
fix keeps the same architecture and interfaces while making resize, lifecycle, and
adapter prop semantics deterministic.

## Scope

- `src/element/hologlyph-head.ts`:
  - use `ResizeObserver` to drive engine resize calls,
  - keep observer lifecycle safe through reconnects,
  - remove `mode` from observed attributes and property surface.
- `src/adapters/react.ts`:
  - apply prop attributes in `ref` callback,
  - clear `src`, `text`, `reduced-motion` on `undefined`,
  - refresh event listener bindings when callback props change.
- `src/adapters/svelte.ts`:
  - clear `src`, `text`, `reduced-motion` when undefined.
- `src/adapters/vue.ts`: remove `mode` surfaces if any present.
- `test/element.test.ts` and `test/adapters.test.ts`: add red-first tests for
  lifecycle and wiring.

## Out of scope

- `src/contracts.ts` and `src/core/*` implementation of `Engine.resize`:
  `LifecycleRepair` owns that contract addition and `EngineImpl` wiring.
- Any non-identified adapter families beyond React and Svelte.
