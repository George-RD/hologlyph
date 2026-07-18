# Tasks: 2026-07-18-adapter-repair

- [x] Update `hologlyph-head.ts` to pass resize events through `engine.resize`
  and remove inert `mode` attribute/property observations.
- [x] Ensure `_resizeObserver` is created in shared boot path and reinstalled after
  reconnect (`_resizeObserver` null check).
- [x] Update React adapter to apply `src`, `text`, and `reducedMotion` in the
  `ref` callback and clear them on `undefined`.
- [x] Update React/Svelte adapters to refresh event listener wiring when callback
  props change and include all callback deps.
- [x] Add element-level tests for observer teardown, reconnect re-install, and
  engine resize callback contract.
- [x] Add adapter tests for initial props before connect, undefined-clear, and
  listener refresh.
- [x] Keep `implementation-notes.md` updated and run `bunx tsc --noEmit`,
  `bunx vitest run`, `bun run lint`.
