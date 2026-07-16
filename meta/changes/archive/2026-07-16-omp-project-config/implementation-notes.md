# Implementation notes: omp-project-config

- Deviation from the standard loop: the change artefact was scaffolded after
  the config file was written and committed, not before; the initial commit
  predates this directory on the same branch. No code, tests, or blueprint
  affected, so TDD does not apply to this tooling-only unit.
- Global `~/.omp/agent/config.yml` has no `ignoredSkills`/`includeSkills`, so
  the array-replace merge semantics clobber nothing.
- Filter takes effect on the next session start; the session that authored it
  still had the full skill list loaded.
