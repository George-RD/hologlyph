---
node: hologlyph.adapter.web-component
status: done
created: 2026-07-13
satisfies: v2-embodiment
---

# Demo Loads Real Bust

Demo loads the real bust by default with createPlaceholderAvatar as documented fallback when load fails or URL is empty; speak round-trip shows visible viseme motion on the mesh in the headless smoke test.

Resolved 2026-07-17: demo loads the real bust by default (no avatarUrl); placeholder is the documented fallback (regression tests in test/core.test.ts); headless speak round-trip shows visible viseme motion (tools/smoke/demo-smoke.mjs: 11-23% central-region pixel change during speech, state hidden->idle->speaking).
