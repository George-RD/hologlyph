# Tasks: 2026-07-18-blend-zone-ghosting-metric

- [x] Scaffold typed cairn change and set the todo status through in_progress to done
- [x] Add a 45-degree (`yaw-0.785.png`) camera-orbit capture pose (after flow,
      so existing close-up/flow poses are unchanged)
- [x] Write failing vitest estimator test on synthetic PNG buffers
- [x] Implement pure run-aware twin-fraction ghosting estimator in score.mjs
- [x] Wire metric into normal scoring and `--negative-control` mode
- [x] Calibrate baseline.json and update eval report shape
- [x] Document the metric in tools/evals/README.md and change artefacts
- [x] Confirm the estimator discriminates via synthetic duplicate control
- [x] Run tsc, vitest, lint; flip todo status to done and tick tasks
