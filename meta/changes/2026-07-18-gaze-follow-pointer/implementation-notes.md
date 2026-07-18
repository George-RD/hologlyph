# Implementation notes: 2026-07-18-gaze-follow-pointer

## Deviations

- Head-bone participation is gated on active following (not derived directly
  from the eye offset every frame): deriving it from the eased eye offset would
  let the idle saccades twitch the head. Gating on `isFollowing` with an eased
  local state keeps idle behaviour unchanged and avoids a snap when the follow
  ends. Conservative and reversible; revisit only if the product wants a
  permanently-slightly-following head.

## Discovered edge cases

- happy-dom performs no layout, so `getBoundingClientRect()` returns zeros in
  the element test; the test stubs the rect. Production uses the real rect.
- happy-dom exposes `requestAnimationFrame`/`cancelAnimationFrame`; the
  test stubs rAF, captures the callback, and invokes it directly for a
  deterministic throttle assertion without wall-clock timers.

## Questions for review

- Should `setGazeTarget` accept a pre-mapped direction instead of NDC? NDC was
  chosen so the element layer stays trivial; the clamp/mapping lives in
  `gaze.ts` and is unit-tested there.

## Summary

- Deviations: 1, the head fraction is gated during active follow and separately eased.
- Most likely revisit: whether the public target API should accept pre-mapped angles instead of NDC.
- Edge cases: zero-layout bounds in happy-dom, deterministic rAF capture, and leave/timeout return through zero.
- Next session should read this file, `src/motion/gaze.ts`, and the contract additions first.
