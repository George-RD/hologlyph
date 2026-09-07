# Merge review, 2026-09-07

PR #94 head ec75d3c passed both CI jobs, but later review comments identified
state defects not covered by the selected-button assertions.

## Corrections

- Preserve the selected demo expression across behaviour transitions. The
  engine emits statechange before setting its default expression, so restore
  the latest selection in a microtask. Unsubscribe on terminal pagehide and
  discard queued work after disposal. Persisted pagehide keeps the listener.
- Follow live OS reduced-motion changes in the checkbox. Reapply its current
  value after mount so the engine's initial OS default does not erase a choice
  made while assets loaded. Remove the media-query listener on disposal.
- Keep the settings trigger's accessible action aligned with its open state.

No runtime, public API, shader, asset or visual-baseline changes.

## Verification

Reconstructed the controller through the GitHub connector and verified its
original Git blob SHA, 20acfb52225f586be5ed8361c96437acfedbf8dc.
Local Chromium tests execute the transpiled controller with a stub engine
which reproduces EngineImpl's event-before-default ordering. The old controller
loses the selected mood on emergence and speech start/end, loses a pre-mount
motion choice, and displays a stale checkbox after an OS preference change.
The corrected controller passes these cases, cached-page restoration and the
queued-restoration-after-disposal check without browser errors.

The new mobile-demo-state-smoke.mjs runs against the real engine in CI. It checks
all seven moods through eight transitions each, both OS preference changes,
settings action labels and terminal cleanup. It drives the public behaviour
machine directly; the unchanged mobile-demo-smoke.mjs separately covers real
button taps, speech/replay, six viewports, focus and touch dragging. JavaScript
syntax checking passes locally. Existing visual capture, scoring and negative
control gates are retained.

Bun, dependency checkout and Cairn are unavailable locally. Full repository and
real-renderer verification must come from the new commit's CI, not the stub
results. Physical iPhone audio, high-DPI performance and actual Safari BFCache
eligibility remain outside this automated evidence. The inherited studio-label
and cycle-state issues and the earlier relocated-reference comment remain
separate follow-up work; this review does not mark them fixed.
