# Implementation notes: public-camera-pose

- The original default `RendererHost` construction remains in place. The engine
  resolves and re-applies the same values, including `lookAt`, before first
  render so the host API and shipped camera share one live pose.
- `setView` rejects an entire patch when any supplied value is non-finite. This
  preserves the previously reconciled pose rather than partially applying a
  caller mistake.
- The stage lab's previous zero rotation maps to `lookAt: height`, which the
  pose contract expresses without widening its target surface.
- `cairn change accept` ran the language battery successfully but cannot pass
  the repository's strict lint baseline because it promotes 41 pre-existing
  warnings. The required `cairn scan` and `cairn hook all` gates pass.
- `setView` is a pointer-move path for the studio orbit control. Resolution now
  validates fields directly and returns the existing frozen pose when no value
  changes, avoiding both temporary arrays and camera writes for no-op patches.
- Regression proofs temporarily removed projection refresh and `lookAt`, reduced
  validation to yaw only, removed no-op reuse, and reset the pose on a
  different-canvas remount. Each targeted test failed before the code was
  restored.
