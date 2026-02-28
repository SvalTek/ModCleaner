# AGENTS.md

## Project Purpose
- ModCleaner is a Deno-based utility that manages a game-folder keeplist and performs scan/clean operations.
- It supports optional literal rename directives using `!rename <from> -> <to>` in `#keeplist.txt`.

## Key Files
- `main.ts`: UI + orchestration layer (input handling, status/results display, command flow).
- `logic.ts`: core behavior (keeplist parsing, rule matching, scan planning, deletion, rename execution).
- `logic_test.ts`: behavioral test suite for core logic.
- `deno.json`: canonical task entrypoints.

## Safety Invariants (Do Not Break)
- Never delete `#keeplist.txt`.
- `scan` must be non-destructive: only plan/report removals and renames.
- `clean` may delete only files identified by scan planning logic, then apply renames.
- Renames must remain:
  - relative paths only,
  - no wildcards,
  - no empty / `.` / `..` segments,
  - non-identical source/target,
  - duplicate `from` or duplicate `to` rejected.
- Paths referenced by rename directives (`from` and `to`) must be protected from deletion planning.
- Missing keeplist or empty keep rules must fail with explicit errors (no implicit fallback behavior).
- Rename outcomes are `applied`, `missing_source`, and `target_exists`.
- `missing_source` and `target_exists` are non-fatal; other rename I/O errors are fatal.
- No rollback is provided for partial progress during `clean`.

## Keeplist and Rename Parsing Semantics
- Only lines beginning with `# ` (hash + space) are comments.
- Lines beginning with `#` without a following space are literal keep rules.
- Keep-rule normalization:
  - convert `\\` to `/`,
  - strip optional leading `./`,
  - treat trailing `/` as recursive `/**`.
- `!rename` path normalization (for both `from` and `to`) occurs before validation:
  - convert `\\` to `/`,
  - strip optional leading `./`.

## Determinism and Output Behavior
- File discovery and planning order must remain deterministic (lexicographic relative paths).
- `writeKeeplist` intentionally overwrites `#keeplist.txt` with the current snapshot-style relative paths.

## Architecture Boundaries
- Keep `main.ts` thin:
  - no business-rule reimplementation,
  - no filesystem mutation logic beyond invoking exported core APIs.
- Keep `logic.ts` authoritative for:
  - parsing and validating keeplist/rename directives,
  - keep-rule matching and removable-file calculation,
  - cleanup and rename execution semantics.
- New behavior affecting scan/clean/rename semantics belongs in `logic.ts` (and tests), not UI handlers.

## Testing Expectations
- Any behavior change in `logic.ts` requires corresponding updates/additions in `logic_test.ts`.
- Add tests for both success and failure paths when touching parsing, removal selection, or rename handling.
- Preserve and verify safety invariants via tests before considering work complete.

## Task / Command Usage (`deno.json`)
- Dev: `deno task dev`
- Test: `deno task test`
- Build: `deno task build`
- Use these tasks as the default execution path; do not introduce ad-hoc alternatives unless necessary.
- Keep `deno.json` imports aligned with active usage; remove stale imports when appropriate.

## Definition of Done
- Changes respect all safety invariants above.
- Layering remains intact (`main.ts` orchestration, `logic.ts` core semantics).
- `logic_test.ts` fully reflects behavior changes and passes via `deno task test`.
- User-facing scan/clean status remains consistent with underlying plan/execution outcomes.
