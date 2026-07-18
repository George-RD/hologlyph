# Implementation notes: 2026-07-18 lifecycle repair

## 2026-07-18

- Added `Engine.resize(width, height): void` to `Engine` contract and implemented it in `EngineImpl` as a direct delegate to `RendererHost.setSize(...)`.
- Hardened `RendererHostImpl.init()` in `src/renderer/renderer-host.ts` with a single in-flight promise (`rendererInit`) and post-await disposed guard so a dispose during async `init()` cannot leak a created renderer.
- Serialised `EngineImpl.mount()` with `mountSerial` and generation tokens (`mountGeneration`) so overlapping mounts resolve deterministically and stale mount attempts dispose candidate avatars and do not duplicate observers.
- `EngineImpl.replaceAvatar()` now removes the previous avatar root from the renderer scene before disposing it and disposes displaced materials/textures on each swap.
- `EngineImpl.dispose()` now removes the current avatar root from scene before avatar teardown so renderer disposal does not traverse/dispose already-owned avatar assets a second time.
- `AssetLoader` now disposes and clears its `KTX2Loader` in `dispose()` to avoid worker leaks.
- `test/core.test.ts`, `test/renderer.test.ts`, and `test/asset.test.ts` expanded for red-first coverage:
  - overlapping mounts dispose superseded avatar and observe once;
  - init-dispose races in renderer host and core mount;
  - engine resize delegation contract.
  - displaced material teardown.
- `test/core.test.ts` now also verifies displaced authored materials and textures are disposed once on engine teardown.
- Verification required: `bunx tsc --noEmit`, `bunx vitest run`, `bun run lint`.
