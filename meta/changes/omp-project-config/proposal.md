# Proposal: omp-project-config

## Motivation

Sessions started inside this repo load the developer's entire global skill
library, including skill families that belong to other repositories (gnss-watch,
yarnling, meerk40t) and unrelated domains (marketing workshops, video
production, Rust release tooling). This bloats the agent prompt and increases
mis-triggering risk.

## Scope

- Add a project-scoped Oh My Pi config at `.omp/config.yml` with
  `skills.ignoredSkills` name globs hiding unrelated skill families in this
  repo only.

## Out of scope

- Any runtime, blueprint, or code change. This is developer tooling only.
- Global (`~/.omp/agent/config.yml`) changes.
