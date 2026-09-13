# Final opaque-mouth handover correction

The final #98 review identified a valid mismatch: mouth_interior deliberately
uses NoBlending and writes depth, while the liquid gate modulated its alpha.
That alpha only participated in the final alpha-test cutoff. The mouth darkened
but retained opaque occlusion until it disappeared suddenly.

The mouth builder now enables Three r178's alpha-hashed fragment coverage.
The existing opacity ramp progressively discards fragments and their depth,
while head-mode opacity one retains every fragment. No transparent sorting,
extra mouth pass, new timer, viseme change or blend-mode change is introduced.
The colour and displacement graphs are otherwise unchanged.

Test-first head 2edfc450bc31541b49631b5c5211fd4cbbbd4ebf failed the newly
strengthened mouth assertion in run 34784383031, job 103797085860: alphaHash
was false, with the other 683 tests passing. Type-check and lint passed first.
The implementation follows that recorded failure, not a test-only workaround.

The existing liquid browser review now also runs a small isolated GPU probe
using the production mouth builder and liquid opacity gate. White foreground
and a blue backing distinguish disappearing fragment coverage from colour
darkening and prove that discarded fragments release depth. It checks multiple
transition amounts, exact off-mode pixel equality, and a negative control with
alpha hashing disabled. This fixture is not head artwork or a replacement for
the real fixed-camera handover captures, which remain unchanged.

The probe's first browser execution exposed a fixture teardown error: disposing
the renderer before its materials invalidated Three's node-cache callbacks.
Its cleanup now releases materials before the renderer. That failed browser
run is not claimed as successful pixel or fade evidence.

The new final-head gate and renderer results must be checked before #98 merges.
No local execution or new direct screenshot inspection is claimed for this
continuation: the container is unavailable. The existing connected-boundary
scope, deferred topology work and physical-device limitations still apply.
