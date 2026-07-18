# Repository Guidelines

## Project Overview

Hologlyph is a web-native, text-skinned talking-head library: a small 3D avatar
that renders a face and speech from a declarative text surface, not a video
stream. TypeScript strict, built on Three.js, shipped as an ES module with thin
framework wrappers. Architecture is declared and enforced by cairn (see
Development Commands and the cairn sections below).

## Architecture & Data Flow

Three containers, 16 nodes, declared in `cairn.blueprint` (acyclic graph):

- `hologlyph.runtime` - core, renderer, text-skin, shaders, motion, speech,
  audio, behavior
- `hologlyph.asset` - loader (`src/asset/`, `assets/`), pipeline
  (`tools/asset-pipeline/`, build-time only, never bundled)
- `hologlyph.adapter` - web component (`src/element/`), framework wrappers
  (`src/adapters/`)

Contract-first: `src/contracts.ts` is the shared type-and-constant spine and the
ONLY permitted cross-container import surface beyond edges declared in
`cairn.blueprint`. Every subsystem interface (`Engine`, `MotionEngine`,
`SpeechEngine`, `AudioEngine`, `VFXEngine`, `RendererHost`, `TextSkinEngine`,
`AssetLoader`, `BehaviorMachine`) plus the canonical rig vocabulary
(`RIG_VISEME_MORPHS`, `RIG_EXPRESSION_MORPHS`, `RIG_BONES`) lives there. Modules
implement the interfaces and never import each other's concrete types.

Data flow: `createEngine()` builds `EngineImpl` (`src/core/engine.ts`), the
composition root that owns every subsystem. `engine.init(canvas)` creates the
renderer (WebGPU with WebGL2 fallback), loads the avatar (default bust or
`avatarUrl`), wires text-skin materials onto morph meshes (skipping
`KEEP_MATERIALS` such as `mouth_interior`), and starts the rAF loop. Each frame:
behaviour machine (explicit FSM, data-driven transition table in
`src/behavior/machine.ts`) -> motion engine (blendshapes, gaze, nods, viseme
lip-sync) -> VFX emergence -> render. Speech reaches the mouth via
`visemeTap()`, which wraps a `TTSAdapter` and forwards viseme/energy frames to
motion. Viseme weights override expression weights on the mouth region; viseme
frames pin `jaw_open` to 0 because authored visemes embed their own jaw deltas.

## Key Directories

- `src/` - runtime source, one directory per blueprint node; `contracts.ts` and
  `index.ts` (public entry) at the root.
- `test/` - vitest suite, `test/*.test.ts` mirroring `src/` modules; fixtures in
  `test/fixtures/`.
- `tools/asset-pipeline/` - offline GLB build: `build-bust.ts` (composites 27
  morphs from pinned ICT-FaceKit sources, sha256-verified against
  `ict-source-manifest.json`), `optimize.ts` (Meshopt/KTX2, enforces a 1.5 MB
  budget).
- `tools/smoke/` - headless Playwright browser smoke scripts (dev-only).
- `demo/` - Vite demo app served by `bun run dev`.
- `meta/` - cairn artefacts: `changes/` (+ `archive/`), `decisions/`, `todos/`,
  `research/`, `sources/`, and `cairn-feedback.jsonl` (friction log).
- `cairn.blueprint`, `cairn.config.yaml` - architecture graph and reconciler
  config. `map.json`/`map.md` are generated; never hand-edit.
- `.cairn/AGENTS.md` - auto-scaffolded cairn guide; it can lag the live CLI.
  Where it disagrees with this file, this file wins.

## Development Commands

- `bun install` - install dependencies (runtime is Bun, not Node).
- `bunx tsc --noEmit` - type-check (strict).
- `bunx vitest run` - full test suite once; `bunx vitest` to watch;
  `bunx vitest run test/<file>.test.ts` for one file.
- `bun run build` - Vite library build to `dist/` plus declarations via
  `tsconfig.build.json`.
- `bun run dev` - serve the demo app.
- `bun run build-asset` / `bun run optimize-asset` - asset pipeline.
- `bun run lint` - Biome lint (lint-only gate; formatter disabled).
- `cairn hook all` - the authoritative commit gate; MUST exit 0 before any
  commit lands. Also runs the language battery from `cairn.config.yaml`
  (`gates:` block). `cairn scan` before committing; zero findings is the target.
  Tension findings are advisory.

### Cairn workflow essentials

- Orientation: `cairn context`, `cairn status`, `cairn change list`,
  `cairn get <id>` / `cairn neighbourhood <id>` (dotted node IDs, e.g.
  `hologlyph.runtime.core`). All commands accept `--json`.
- Work flows through typed changes: `cairn change new <id>` -> implement on a
  feature branch -> `cairn change show <id>` -> `cairn change accept <id>` ->
  `cairn change archive <id>` after merge. Note: the accept gate's
  `cairn lint --strict` sub-step still fails on 12 pre-existing advisory
  `CAIRN_CONTRACT_LEAF_UNCOVERED` warnings; `cairn hook all` remains the
  authoritative gate.
- Editing `cairn.blueprint` (new module, `path` claim, dependency edge) is an
  architecture change and requires a paired decision artefact under
  `meta/decisions/` (`cairn decision new <slug> --node <id>`).
- Fresh session: run `cairn brief` (no arguments) to fuse the next open todo
  with its binding decisions and gates. Then: branch from main
  (`git checkout -b <type>/<slug>`), set the todo `status: in_progress`, TDD,
  record decision artefacts BEFORE building on resolved open decisions, log
  cairn friction to `meta/cairn-feedback.jsonl` as it happens, run the full
  gate, set the todo `status: done`, tick the change's `tasks.md`, land via
  squash-merged PR.
- Keep a running `implementation-notes.md` in the active change directory
  logging every deviation from the plan and every discovered edge case.

## Code Conventions & Common Patterns

- TypeScript strict mode; no implicit `any`, no habitual non-null assertions.
- British spelling, no em dashes, in code comments and docs.
- Naming: factories `create*()`; implementation classes `*Impl`; private fields
  `_`-prefixed; constants `UPPER_SNAKE`; file names match their primary export.
- Dependency injection is lightweight and constructor-based; no DI container.
  Time, RNG, `AudioContext`, and canvas factories are injectable for
  deterministic tests (`GazeController(rng, clock)`,
  `TextSkinEngineOptions.canvasFactory`).
- Dispose discipline: every subsystem implements `Disposable` with idempotent
  `dispose()`; the engine tears down in reverse order; the renderer walks the
  scene graph disposing geometry, materials, and textures.
- Error handling degrades, it does not throw: `validateRig()` returns a
  structured report; KTX2 failures fall back to plain GLB; adapters emit
  `error` + `end` events rather than raising.
- State: behaviour is a plain data-driven FSM table, no state library.
- Pure logic is extracted from GPU code (`src/shaders/emergence.ts`,
  `src/speech/visemes.ts`, `src/text-skin/grid.ts`,
  `src/motion/expressions.ts`) so it is testable without WebGL.
- Reduced-motion support is a first-class path (`setReduced(true)` damps nods,
  disables saccades, shortens ramps).

### Git conventions

- Feature branch + squash-merge PR; never commit directly to main.
- Stage explicit paths (`git add src/foo.ts`); never `git add -A` or
  `git add .`.
- Commit with a message file: write the message to a temp file, review it, then
  `git commit -F <file>`.
- Test-first: failing test before the implementation; one regression test per
  defect (must fail without the fix).

## Important Files

- `src/index.ts` - public entry: `createEngine`, contract types,
  `defineHologlyphHead`.
- `src/contracts.ts` - the contract spine (see Architecture).
- `src/core/engine.ts` - composition root and frame loop.
- `src/core/default-avatar.ts` - resolves the bundled bust GLB; Vite lib mode
  inlines it as a lazy data-URL chunk so the main bundle stays ~11 kB gzip.
- `cairn.blueprint` / `cairn.config.yaml` - architecture and gate config.
- `vite.config.ts` (library, four entries, `three` externalised),
  `demo/vite.config.ts` (demo app), `vitest.config.ts` (happy-dom).
- `package.json` - exports `.`, `./react`, `./vue`, `./svelte`; only `dist/` is
  published.

## Runtime/Tooling Preferences

- Bun is the package manager and script runner; invoke tools via `bunx`.
- `three` is a runtime dependency externalised from the library build; framework
  adapters take the framework namespace as a parameter (zero peer
  dependencies).
- CI (`.github/workflows/pages.yml`) only builds and deploys the demo to GitHub
  Pages; the verification battery runs locally via `cairn hook all`.
- npm publish is deferred; do not publish without an explicit go-ahead.

## Testing & QA

- Vitest with happy-dom; tests in `test/*.test.ts` matching `src/` modules;
  inline fakes and `vi.mock()` at module level; no shared setup file.
- Deterministic by injection: manual schedulers, injected clocks and RNGs.
- Notable suites: `test/asset-bust.test.ts` loads the real GLB, validates the
  rig (zero warnings expected), checks the 1.5 MiB budget, and guards
  regen-from-source byte equality; `test/speech-e2e.test.ts` drives the full
  viseme pipeline from a committed fixture.
- Full verification chain before any merge: `bunx tsc --noEmit`,
  `bunx vitest run`, `bun run build`, `bun run lint`, `cairn hook all`, plus a
  live browser smoke test for anything visual (`bun run dev` + the
  `tools/smoke/` Playwright scripts).
- Asset exports need pinned reproducible provenance: upstream SHA, acquisition
  command, consumed paths, licence copy at that SHA, and final asset hash.

## Cairn friction feedback

When cairn surprises you, misleads you, or blocks you wrongly, append one JSON
object per line to `meta/cairn-feedback.jsonl` before working around it:

```json
{"ts":"2026-07-13T00:00:00Z","phase":"implementation","area":"cli","observation":"what happened","improvement":"what would fix it","severity":"minor"}
```

Fields: `ts`, `phase` (scoping|implementation|review|...), `area`
(cli|skill|hook|blueprint|...), `observation`, `improvement`, `severity`
(minor|moderate|major). Prefer this over the prose `cairn feedback` channel.
