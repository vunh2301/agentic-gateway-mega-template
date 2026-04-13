---
name: consumer-feature
description: |
  MUST use when implementing or modifying any consumer package feature.
  Enforces 5-gate workflow: memory review → spec → plan → TDD → verify.
  Blocks ad-hoc coding. Triggers on: "build", "add feature", "fix bug",
  "implement", "new feature", "start phase", "work on package".
---

# Consumer Feature Workflow — 5 Hard Gates

This skill is the primary workflow for any feature work. Chains OMC pipeline
skills with mega-template enforcement hooks. Every gate passes or blocks.

## Gate 1 — Memory & Spec Review (V5-R001, V5-R002)

Before ANY code:

1. Read `CLAUDE.md`, `PROGRESS.md`, `spec-index.yaml`, and the authoritative
   spec referenced in `spec-index.yaml` `spec:` field.
2. Confirm with user: `"Active phase: X. Package: Y. Status: Z. Will do W."`
3. Invoke `/oh-my-claudecode:deep-interview "<feature scope>"`
4. Interview output lands in `.omc/specs/deep-interview-*.md`

**BLOCK** next gate until user approves interview output (ambiguity < 20%).

## Gate 2 — Plan Written (V5-R002)

1. Invoke `/oh-my-claudecode:ralplan` (consensus planning with Planner + Architect + Critic)
2. Plan output lands in `.omc/plans/<phase>-plan.md`
3. **Task ordering MUST be TDD-first** — each task must list:
   - Test file path FIRST
   - `npm test` expect RED
   - Src file path with `@spec(phase=N,section=X)` annotation
   - `npm test` expect GREEN
4. If plan skips TDD ordering → hook `enforce-tdd` will block writes

**BLOCK** code until plan file exists.

## Gate 3 — Execute (V5-R006, V5-R016, V5-R017, V5-R030)

Choose execution mode based on scope:

| Mode | When | Command |
|------|------|---------|
| Linear | Single task, < 1h | Work directly |
| Autonomous | Multi-task plan | `/oh-my-claudecode:autopilot` |
| Parallel | 2+ independent tasks | `/oh-my-claudecode:team N:executor` |
| Persistent loop | Complex with retries | `/oh-my-claudecode:ralph` |

Hooks active during execution (harness-level, cannot bypass):
- `check-spec` — spec doc exists for package (V5-R004)
- `check-phase-gate` — path in active phase scope (V5-R016)
- `check-spec-coverage` — `@spec()` annotation on new src (V5-R017)
- `enforce-tdd` — test file exists before src write (V5-R030)
- `require-tests` — warn on commit if src lacks test pair (V5-R006)

## Gate 4 — Pre-completion Verify (V5-R005, V5-R007, V5-R050)

Before claiming "done":

1. Invoke `/oh-my-claudecode:verify` for evidence-based completion check
2. Run full suite: `npm test --workspaces`
3. Typecheck: `npm run -s typecheck --workspaces --if-present`
4. Build: `npm run build`
5. Stage test evidence for `enforce-verification` hook:
   ```
   npx vitest run --reporter=json --outputFile=test-results/latest.json
   git add test-results/latest.json
   ```
6. If consumer package needs Gateway:
   - Start local Gateway (user confirms running + `GW_DEV_MODE=1` if using dev bypass)
   - Smoke test: `npm run smoke` or package-specific E2E suite
7. Update `PROGRESS.md` with verified status
8. If phase complete: invoke `/phase-promote`

**BLOCK** completion claim without command output evidence.

Hooks active at commit:
- `check-e2e-real` — no mock patterns in E2E tests (V5-R040)
- `enforce-verification` — test evidence staged or recent session run (V5-R050)

## Gate 4.5 — Independent Review (V5-R055, V5-R056)

Before `/phase-promote` on ANY phase:

1. Invoke `/phase-review` — spawns 3 agents in parallel with fresh context:
   - `code-reviewer` → severity-rated code findings
   - `verifier` → evidence cross-check for every acceptance criterion
   - `critic` → plan↔implementation coherence challenge
2. Each agent writes `.omc/reviews/<phase>-<reviewer>.md` with frontmatter
   `verdict: approved | approved-with-notes | changes-requested | rejected`
3. Gate-pass verdicts: `approved`, `approved-with-notes` (configurable in
   `spec-index.yaml review.accept_verdicts`)
4. Blocking verdicts: `changes-requested`, `rejected` → address findings and
   re-run `/phase-review` (or bypass via `CLAUDE_SKIP_HOOKS=1` with documented
   reason, audited via git log)

Hooks active at commit:
- `check-review-evidence` — blocks `phase-promote:` commits + `phase-*-verified`
  tags unless all three artifacts present with accepted verdicts (V5-R055, V5-R056)

**BLOCK** promote until Gate 4.5 passes. No self-approval — agents must be
spawned as subagents, never inherited context.

## Gate 5 — Stuck Handling (V5-R008, V5-R011, V5-R013)

If a task fails more than once:

1. Invoke `/oh-my-claudecode:debug` for root-cause diagnosis
2. Read logs, diff code, run empirical command with output — don't guess (V5-R008)
3. Fix root cause, not symptoms (V5-R011)
4. **After 3 failed fix attempts (V5-R013):**
   - STOP immediately
   - Question architecture: is interface wrong? is abstraction leaky?
   - Consult user
   - Do NOT attempt a 4th fix at the same layer

## Rule enforcement summary

| Gate | Rules | Tool/Hook |
|------|-------|-----------|
| 1 | V5-R001, V5-R002 | `/oh-my-claudecode:deep-interview` + `load-context` hook |
| 2 | V5-R002 | `/oh-my-claudecode:ralplan` |
| 3 | V5-R004, V5-R006, V5-R016, V5-R017, V5-R030 | `check-spec` + `check-phase-gate` + `check-spec-coverage` + `enforce-tdd` + `require-tests` |
| 4 | V5-R005, V5-R007, V5-R040, V5-R050 | `/oh-my-claudecode:verify` + `check-e2e-real` + `enforce-verification` |
| 4.5 | V5-R055, V5-R056 | `/phase-review` + `check-review-evidence` |
| 5 | V5-R008, V5-R011, V5-R013 | `/oh-my-claudecode:debug` |

## Bypass

`CLAUDE_SKIP_HOOKS=1` disables enforcement hooks. Use ONLY for:
- Typo/rename/import-reorg
- Comments/docstrings only
- Dependency version bumps

Document bypass in commit body. Never bypass for new features or bug fixes.
