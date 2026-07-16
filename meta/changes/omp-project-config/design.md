# Design: omp-project-config

Mechanism (per the omp-project-scope-skill-disables procedure, verified against
oh-my-pi source): a project-level `<repo>/.omp/config.yml` is merged over the
global config, and `skills.ignoredSkills` globs match skill names at load time.
Because project config is cwd-scoped, the filter applies only when a session
runs inside this repo; the same skills stay loaded everywhere else.

Decisions:

- Deny-list (`ignoredSkills`) over allow-list (`includeSkills`): an empty
  allow-list means "all", and an allow-list would hide every newly created
  skill by default. A deny-list only needs a new line when a new unrelated
  family appears.
- Arrays replace rather than merge across config levels; verified the global
  config declares no skill filters, so nothing is clobbered.
- The file is committed: the repo is private and the config travels with
  clones and worktrees.

Verification: globs replicated with `Bun.Glob(pattern).match(name)` against the
full 172-skill loaded list; 62 dropped, 110 kept, zero false positives or
negatives on an assertion set of must-keep (cairn-*, design-*, finding-unknowns
family) and must-drop names. `omp config get skills.ignoredSkills` from the
repo returns the merged list.
