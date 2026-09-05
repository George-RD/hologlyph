# Implementation notes

## 2026-09-02

The broad `todo.studio-showcase-overhaul` remains open. This change resolves the
specific mobile disclosure and speech request without claiming the wider camera
and full-studio presentation work is complete.

The previous `demo/index.html` is retained as `demo/studio.html` rather than
reimplemented. The new root intentionally exposes only live-look controls. This
keeps one public presentation URL while preserving the deep diagnostic surface
for deliberate use.

Local repository checkout was unavailable in the execution environment. The
new TypeScript was checked with TypeScript 5.8.3 under strict mode and
`noUncheckedIndexedAccess`; the repository pull-request workflow remains the
authoritative full gate.

## 2026-09-05: PR review corrections

The original CI failed on three invalid ARIA declarations in the new markup,
then separately on the zero-sized expression-menu visibility check. The fan
also overlapped its 48 px touch targets, despite keeping their centres onscreen.

- Give the menu a real box and fit the complete semicircle within the existing
  safe-area chrome. Do not clamp individual buttons into their neighbours.
- Focus the current expression or caption on opening and restore the trigger
  before hiding the selected control.
- Use a native modal dialog for settings, with an inert background, Escape,
  backdrop dismissal and focus restoration. It is hidden before script startup.
- Remove invalid generic-element ARIA labels and use a labelled section for
  expressions. Disable engine-dependent buttons in the initial HTML.
- Preserve the mounted engine on persisted pagehide and resize on pageshow;
  terminal pagehide still disposes. Reset drag state and clear the toast timer
  on terminal cleanup. Only the primary pointer starts a drag.
- Catch rejected speech promises without leaving Say pressed or leaking an
  unhandled rejection.

The smoke now checks six viewport sizes (320, 375, 390, 430, landscape 844 and
1280 px), option separation and hit-testing, all seven selections, keyboard
focus, sample speech and rapid replay, modal dismissal, touch drag, rejection
handling and both persisted and terminal page lifecycle paths. It awaits finite
control animations rather than measuring intermediate transforms. The fake
voice cancels pending callbacks. Browser teardown runs even after assertions
fail, and a failure screenshot is retained.

Local verification: the original HTML/CSS/controller were reconstructed from
the PR and their Git blob hashes verified. A real Chromium control harness with
a stub engine changed from 12 passing / 26 failing assertions to 38 passing / 0
failing. The expanded smoke also passed against that host-only harness. The
controller passed strict TypeScript with a local contract shim; the smoke
passed JavaScript syntax checking. Harnesses and shims are not production files.

Limits: this does not validate the renderer, audible iPhone speech, actual
Safari BFCache eligibility or the complete repository type/build/test battery.
Persisted lifecycle events are injected deterministically. Dependency checkout,
Bun and Cairn were unavailable locally, so cairn scan/hook all and the full
engine/visual checks remain unverified locally. Do not treat these host checks
as merge approval; the updated PR must pass the repository gates.
