# Implementation notes: gh-pages-demo

## Bun lockfile version vs setup-bun default

First Pages run failed: setup-bun@v2 installs bun 1.3.14 by default, which
cannot parse the repo's bun.lock (`lockfileVersion: 2`, written by local bun
1.4.0). `bun install --frozen-lockfile` then aborts because the unparsed
lockfile "had changes".

## Bun 1.4.0 pin also failed

Pinning `bun-version: 1.4.0` failed: no public GitHub release asset exists for
bun-v1.4.0 on linux-x64 (HTTP 404); the local 1.4.0 is ahead of published
releases. Resolution: `bun-version: latest` and a plain `bun install` (no
frozen flag) so the deploy build tolerates a CI bun older than the lockfile
writer. The library CI gates are unaffected; this workflow only builds the
static demo.
