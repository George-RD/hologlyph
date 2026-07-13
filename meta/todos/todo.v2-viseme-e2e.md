---
node: hologlyph.runtime.speech
status: open
created: 2026-07-13
satisfies: v2-embodiment
---

# Viseme E2E Fixtures

Two e2e tests per design: a committed dev-only espeak-ng script generates a strictly Polly-shaped speech-mark JSONL fixture replayed through SpeechEngine -> MotionEngine with a mock clock (14 reachable morphs), plus a canonical VisemeFrame timeline fixture asserting all 15 canonical morphs are drivable (res.viseme-provider-format, res.local-tts-dev).
