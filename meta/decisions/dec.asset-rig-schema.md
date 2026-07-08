---
id: dec.asset-rig-schema
nodes: [hologlyph.asset.loader]
status: accepted
date: 2026-07-08
informed_by: [res.packaging-delivery, src.deep-research-1, src.deep-research-2]
---

Default male and female busts share ONE rig and naming schema: identical skeleton semantics, identical morph-target names for mouth/expression shapes, identical material-slot conventions, and a common animation vocabulary. This lets a single lip-sync, gesture, and behavior engine drive both defaults cleanly.

The internal expression/gaze vocabulary is deliberately VRM-like (standardized pose, facial expression, gaze operations) so bring-your-own-avatar support can expand later with less refactoring. v1 ships custom GLBs; arbitrary-rig import is explicitly deferred (arbitrary-rig normalization cost rises sharply, per the phased rollout).
