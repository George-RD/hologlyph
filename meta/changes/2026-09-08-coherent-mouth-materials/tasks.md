# Tasks

- [x] Reject the dark/coordinate-band treatments after actual render review.
- [x] Retain teeth and tongue source identity in the combined mouth primitive.
- [x] Verify the labels survive optimisation and stay attached to tongue morphs.
- [x] Verify existing geometry/morph arrays and the source rebuild are unchanged.
- [x] Iterate directional tooth shading and tongue root/tip/side definition.
- [x] Pass local type-check, full tests, lint and build.
- [x] Inspect 18 final candidate frames with correct aspect ratio and no errors.
- [x] Apply the reviewed candidate and asset after the authoritative gate.
- [ ] Record final branch checks in PR #96.
- [ ] Owner acceptance before merge or live-demo deployment.

## Gate result

The reviewed runtime and regenerated asset landed on this feature branch in
`aed0d34805056e65d56e57cb67c0370c19319174`, after successful type-check, tests,
lint, build, `cairn scan` and `cairn hook all` in run 34362339822.
Cairn v0.10.0 reports Decision: pass. It still reports advisory provenance,
filename and test-ownership findings; this is not a zero-findings claim.
The exact candidate shader and GLB hashes were verified before the commit.
All temporary transfer/apply/source/owner-preview workflows are removed.
The retained read-only mouth review now captures both source-labelled anatomy
and the existing speech-animation, mobile, light-background and melt checks.
