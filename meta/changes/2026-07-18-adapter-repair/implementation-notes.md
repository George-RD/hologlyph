# Implementation notes: 2026-07-18-adapter-repair

## 2026-07-18

- Added `ResizeObserver` callback path in `src/element/hologlyph-head.ts` to call the
  engine resize contract (`engine.resize(width, height)`).
- Kept the initial canvas creation path as-is and removed inline resize-related
  canvas size writes from the resize observer callback.
- Changed observer lifecycle so `_ensureResizeObserver()` is used from `_boot()` and
  only re-created when `_resizeObserver` is null.
- Removed `mode` from `observedAttributes`, comment/property assumptions, and
  from adapter wiring where present.
- React adapter now sets `src`, `text`, and `reduced-motion` in the `ref`
  callback before connect-style effects, and clears those props when undefined.
- React adapter event `useEffect` deps now include all callback props, so listeners
  rebind when callbacks are replaced.
- Svelte adapter now clears `src`, `text`, and `reduced-motion` when values are
  undefined.

### TDD notes

- Added/updated tests in `test/element.test.ts` for:
  - resize observer disconnect on teardown,
  - resize observer reinstallation on reconnect,
  - resize observer callback driving `engine.resize`.
- Added/updated tests in `test/adapters.test.ts` for:
  - React initial props set during create-element/ref path,
  - React and Svelte prop clearing on `undefined`,
  - callback listener refresh on callback prop churn.

### Deviations

- `Engine.resize` is referenced via a local narrow type in the element to satisfy
  the current branch until `LifecycleRepair` lands the contract in
  `src/contracts.ts` and implementation in core. A runtime guard is included:
  `if (engine && typeof engine.resize === 'function')`.

### Verification

- Planned verification command sequence:
  `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`.
