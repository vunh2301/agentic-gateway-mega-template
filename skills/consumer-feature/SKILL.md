---
name: consumer-feature
description: |
  MUST use when implementing or modifying any consumer package feature.
  Enforces 6-gate workflow: memory review → brainstorm → plan → worktree →
  TDD → verify. Blocks ad-hoc coding. Triggers on: "build", "add feature",
  "fix bug", "implement", "new feature", "start phase", "work on package".
---

# Consumer Feature Workflow — 6 Hard Gates

This skill is the primary workflow for any feature work. It chains
Superpowers skills with mega-template enforcement. Every gate either
passes or blocks progress.

## Gate 1 — Memory & Spec Review (V5-R001, V5-R002)

Before ANY code:

1. Read `CLAUDE.md`, `PROGRESS.md`, `spec-index.yaml`
2. Read the active package spec in `docs/`
3. Confirm with user: `"Active phase: X. Package: Y. Status: Z. Will do W."`
4. Invoke `superpowers:brainstorming`
5. Save spec output to `docs/specs/<pkg>-<feature>.md`

**BLOCK** next gate until user approves spec.

## Gate 2 — Plan Written (V5-R002)

1. Invoke `superpowers:writing-plans`
2. Tasks must be 2-5 min each with exact file paths + test files
3. Save plan to `docs/plans/<pkg>-<feature>.md`
4. Update `PROGRESS.md` with plan reference

**BLOCK** code until plan file exists.

## Gate 3 — Worktree Isolation (optional)

For multi-day work:
1. Invoke `superpowers:using-git-worktrees`
2. Verify baseline tests pass: `npm test --workspaces`

Skip for single-commit fixes.

## Gate 4 — TDD Per Task (V5-R006)

For each task in plan:
1. Invoke `superpowers:test-driven-development`
2. RED → write failing test
3. Verify failure: `npm test` expects non-zero exit
4. GREEN → minimal passing code (with `@spec(phase=X,section=Y.Z)` annotation, V5-R017)
5. Verify pass: `npm test` expects zero exit
6. REFACTOR if needed
7. Commit: `{package}.{phase}: {task}`

Hooks that activate:
- `check-spec` (V5-R004) — blocks if no spec
- `check-phase-gate` (V5-R016) — blocks if outside active phase
- `check-spec-coverage` (V5-R017) — blocks if no `@spec()` annotation
- `require-tests` (V5-R006) — warns post-commit if missing test

## Gate 5 — Pre-completion Verify (V5-R005, V5-R007)

Before claiming "done":
1. Invoke `superpowers:verification-before-completion`
2. Run full suite: `npm test --workspaces`
3. Typecheck: `npm run -s typecheck --workspaces --if-present`
4. Build: `npm run build`
5. If consumer package needs Gateway:
   - Start local Gateway (user confirms running)
   - Smoke test: `npm run smoke -- --host localhost --port 2400`
6. Update `PROGRESS.md` with verified status
7. If phase complete: invoke `/phase-promote`

**BLOCK** completion claim without command output.

## Gate 6 — Stuck Handling (V5-R008, V5-R011, V5-R013)

If a task fails more than once:
1. Invoke `superpowers:systematic-debugging`
2. 4-phase process: investigate → analyze → hypothesis → implement
3. **After 3 failed fix attempts (V5-R013):**
   - STOP immediately
   - Question architecture: is interface wrong? is abstraction leaky?
   - Consult user
   - Do NOT attempt a 4th fix at the same layer

## Rule enforcement summary

| Gate | Rules | Hook/Skill |
|------|-------|------------|
| 1 | V5-R001, V5-R002 | SP brainstorming + load-context hook |
| 2 | V5-R002 | SP writing-plans |
| 3 | — | SP using-git-worktrees (optional) |
| 4 | V5-R004, V5-R006, V5-R016, V5-R017 | check-spec + check-phase-gate + check-spec-coverage + require-tests |
| 5 | V5-R005, V5-R007 | SP verification-before-completion |
| 6 | V5-R008, V5-R011, V5-R013 | SP systematic-debugging |

## Bypass

`CLAUDE_SKIP_HOOKS=1` disables enforcement hooks. Use ONLY for:
- Typo/rename/import-reorg
- Comments/docstrings only
- Dependency version bumps

Document bypass in commit body. Never bypass for new features or bug fixes.
