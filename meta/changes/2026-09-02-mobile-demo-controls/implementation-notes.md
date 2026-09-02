# Implementation notes

## 2026-09-02

The broad `todo.studio-showcase-overhaul` remains open. This change resolves the
specific mobile disclosure and speech request without claiming the wider camera
and full-studio presentation work is complete.

The previous `demo/index.html` is retained as `demo/studio.html` rather than
reimplemented. The new root intentionally exposes only live-look controls. This
keeps one public presentation URL while preserving the deep diagnostic surface
for deliberate use.

Local repository checkout was unavailable in the execution environment. The
new TypeScript was checked with TypeScript 5.8.3 under strict mode and
`noUncheckedIndexedAccess`; the repository pull-request workflow remains the
authoritative full gate.
