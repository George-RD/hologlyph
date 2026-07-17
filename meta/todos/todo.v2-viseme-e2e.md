---
node: hologlyph.runtime.speech
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Viseme E2E Fixtures

Two e2e tests per design: a committed dev-only espeak-ng script generates a strictly Polly-shaped speech-mark JSONL fixture replayed through SpeechEngine -> MotionEngine with a mock clock (14 reachable morphs), plus a canonical VisemeFrame timeline fixture asserting all 15 canonical morphs are drivable (res.viseme-provider-format, res.local-tts-dev).

Resolved 2026-07-17: committed espeak-ng generator (tools/asset-pipeline/gen-viseme-fixture.ts) emits a strictly Polly-shaped speech-mark JSONL fixture (test/fixtures/viseme-polly-hello.jsonl, deterministic); test/speech-e2e.test.ts replays it through the provider adapter with a mock clock asserting the 14 Polly-reachable morphs and that viseme_nn is never driven, plus a canonical VisemeFrame timeline asserting all 15 morphs drivable.
