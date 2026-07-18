# Tasks: 2026-07-18-lifecycle-repair

- [x] Add red-first regression tests for renderer init dispose race and overlapping mounts.
- [x] Update renderer host to share an in-flight init and dispose disposed instance.
- [x] Update engine mount to serialise with generations and track displaced materials for teardown.
- [x] Dispose KTX2 loader resources in asset loader cleanup.
- [x] Add Engine.resize contract and delegate implementation to renderer host.
- [x] Verify with focused tests and full `tsc` + `vitest` + `lint`.
