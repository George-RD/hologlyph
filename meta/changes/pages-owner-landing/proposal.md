# Make the owner-approved head the GitHub Pages landing page

## Why

https://george-rd.github.io/hologlyph/ still showed the plain engine demo;
the owner-approved look existed only in the lab page, which was not even in
the Pages build. Owner: "i'd like to see the best version of what I have so
far live atm".

## What

- demo/index.html is now the lab page: full-screen head booting the
  owner-approved config, controls hidden behind a "tune" button (?tune in
  the URL also opens them). Topbar links to the engine demo and GitHub.
- demo/engine.html: the previous landing page (scroll-emergence engine
  demo), unchanged content.
- demo/feature-shading-lab.html: redirect stub to ./?tune so the old lab
  URL keeps working.
- demo/vite.config.ts: multi-page rollup inputs (index, engine, stub).
- Harness retargeting so the visual eval keeps scoring the SAME content
  against the unchanged baseline: capture.mjs default URL, ci.yml health
  check + capture arg, demo-smoke.mjs all point at /hologlyph/engine.html;
  lab-shot.mjs points at /hologlyph/?tune.

## Non-goals

- No src/ changes; no eval baseline change (verified: eval pass + negative
  control still fails properly).

## Affected nodes

- hologlyph.adapter (demo pages), CI workflows, eval/smoke harnesses.
