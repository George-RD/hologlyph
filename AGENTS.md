# AGENTS.md: Hologlyph

## What Hologlyph is

Hologlyph is a web-native, text-skinned talking-head library: a small 3D avatar
that renders a face and speech from a declarative text surface, not a video
stream. It is a TypeScript library built on Three.js, shipped as an ES module
with thin framework wrappers. The core runtime drives a player loop, a renderer
with WebGPU/WebGL2 fallback, an offscreen text skin, motion and speech engines,
audio analysis, and a behaviour state machine. An asset pipeline (build-time only,
not shipped) optimises GLB avatars under a tight delivery budget, and adapter
modules package the engine as a Web Component plus React/Vue/Svelte wrappers.
The architecture is declared and enforced by cairn (see below).

## Repository map

- `src/` - runtime source, one directory per cairn.blueprint node: `core/`,
  `renderer/`, `text-skin/`, `shaders/`, `motion/`, `speech/`, `audio/`,
  `behavior/`, `asset/`, `element/`, `adapters/`. `contracts.ts` (see
  Conventions) and `index.ts` (entry point) live at `src/` root.
- `tools/asset-pipeline/` - build-time GLB optimisation (`hologlyph.asset.pipeline`),
  never bundled into the shipped library.
- `demo/` - the Vite demo app served by `bun run dev`.
- `meta/` - cairn artefact tree: `changes/` (active and `archive/`),
  `decisions/`, `research/`, `sources/`, `todos/`, `contracts/`, plus
  `cairn-feedback.jsonl` (friction log, see below).
- `cairn.blueprint` - the declared architecture graph; `cairn.config.yaml`
  configures the reconciler. `map.json`/`map.md` are generated snapshots, do not
  hand-edit.
- `.cairn/` - cairn's own state and the scaffolded agent guide `.cairn/AGENTS.md`.

## Cairn workflow

Cairn keeps `cairn.blueprint` and the code in sync and gates drift at commit.
Read `.cairn/AGENTS.md` for the full agent guide (orientation, artefact formats,
the dev-loop skills in `.claude/skills/`). Caveat: that file was scaffolded
before the cairn 0.2.0 CLI rename and is not regenerated on upgrade; where its
commands disagree with this file (e.g. `cairn changes` vs `cairn change list`),
this file wins. This section covers the essentials you must not skip.

### Orientation

- `cairn context` - structural overview; start every session here.
- `cairn get <id>` / `cairn neighbourhood <id>` - inspect a node and neighbours.
  Node IDs are dotted, e.g. `hologlyph.runtime.core`.
- `cairn status` and `cairn change list` - project state and active changes.
- All commands accept `--json`.

### Change lifecycle

Work flows through typed changes, not ad-hoc edits:

1. `cairn change new <change-id>` - scaffold the change.
2. Implement under a feature branch; run the gates as you go.
3. `cairn change show <change-id>` - review before landing.
4. `cairn change accept <change-id>` - pass the acceptance gate. Known
   limitation: acceptance gates were cargo-hardcoded through 0.1.x (upstream
   issue #234); verify against this TypeScript repo before relying on it, and
   fall back to the Gate commands below if it misfires.
5. `cairn change archive <change-id>` - archive once merged.

### Gate

`cairn hook all` is the strict boundary. It must exit 0 before a commit lands.
Run it (and `cairn scan`) before committing; zero findings is the target.
Tension findings are advisory and do not fail the hook.

### Blueprint changes need decisions

Editing `cairn.blueprint` (a new module, a `path` claim, or a dependency edge)
is an architecture change and requires a paired decision artefact under
`meta/decisions/`. Scaffold one with `cairn decision new <slug> --node <id>`
(chained via `informed_by:`), then make the blueprint edit. The hook gate checks
structure and interface promises; an undeclared structural change is caught.

### Development loop (start here in a fresh session)

To pick up the next unit of work, run `cairn brief` (no arguments): it selects
the next open todo and fuses the task, binding decisions, contract, and gates.
Caveat: its gate list is cargo-hardcoded and wrong for this repo; the Build and
test section below is authoritative. Then, per unit:

1. Branch from main (`git checkout -b <type>/<slug>`).
2. Set the todo's frontmatter `status: in_progress` (`meta/todos/todo.<slug>.md`).
3. TDD: write the failing test first and confirm it fails for the right reason,
   then implement to green. Required for bugfixes, expected for features;
   deviations get a line in the change dir's `implementation-notes.md`.
4. When you resolve a decision the design flagged as open (e.g. commit-vs-fetch
   asset delivery), record it as a decision artefact BEFORE building on it, and
   link the research that informed it via `informed_by:`.
5. Log cairn friction to `meta/cairn-feedback.jsonl` as it happens, not at the end.
6. Run the full gate (Build and test section plus `cairn hook all`), set the todo
   `status: done`, tick the matching box in the change's `tasks.md`, then land
   via feature-branch PR, squash-merge, branch deleted.

Keep a running `implementation-notes.md` in the active change directory logging
every deviation from the plan and every discovered edge case.

## Build and test

- `bun install` - install dependencies.
- `bunx tsc --noEmit` - type-check (project is TypeScript strict).
- `bunx vitest run` - run the test suite once (CI mode).
- `bun run build` - bundle with Vite to `dist/`.
- `bun run dev` - serve the `demo/` app locally for manual checks.

Run the type-check and tests before any commit, alongside `cairn hook all`.

## Conventions

- TypeScript strict mode; no implicit `any`, no non-null assertions as a habit.
- Contract-first: `src/contracts.ts` is the ONLY permitted cross-container import
  surface beyond the edges declared in `cairn.blueprint`. Modules implement
  those interfaces and are wired together by `hologlyph.runtime.core`.
- Feature-branch and squash-merge pull requests. Never commit directly to main.
- Stage explicit paths (`git add src/foo.ts`), never `git add -A` or `git add .`.
- Commit with a message file: `git commit -F <file>` (write the message to a
  temp file, review it, then commit).
- British spelling, no em dashes, in code comments and docs.
- Test-first: write the failing test before the implementation (see Development
  loop). One regression test per defect: when fixing a bug, the test must fail
  without the fix and pass with it.

## Cairn friction feedback

When cairn surprises you, gives a confusing message, or blocks you wrongly,
record it before working around it. Append one JSON object per line to
`meta/cairn-feedback.jsonl` with these fields:

```json
{"ts":"2026-07-13T00:00:00Z","phase":"implementation","area":"cli","observation":"what happened","improvement":"what would fix it","severity":"minor"}
```

Fields: `ts` (ISO timestamp), `phase` (scoping|implementation|review|...),
`area` (cli|skill|hook|blueprint|...), `observation`, `improvement`,
`severity` (minor|moderate|major). This structured log feeds cairn's own
improvement; prefer it over the prose `cairn feedback` channel for this project.
