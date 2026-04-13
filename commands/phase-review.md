---
name: phase-review
description: Run independent review pass (reviewer + verifier + critic) before /phase-promote
---

Independent review gate for current phase. MUST run before `/phase-promote`.

Writes 3 artifacts to `.omc/reviews/<active_phase>-{reviewer,verifier,critic}.md`,
each with frontmatter `verdict: <approved|approved-with-notes|changes-requested|rejected>`.

## Workflow

1. Read `spec-index.yaml` → identify `active_phase`, referenced spec, phase sections/paths.
2. Read `.omc/plans/<active_phase>-plan.md` (if exists) for plan↔impl cross-check.
3. Collect evidence paths: `test-results/`, `coverage/`, `e2e/results/`, PROGRESS.md phase entry.
4. Spawn **3 agents in parallel** (single message, multiple Agent tool calls):

   **Agent A — code-reviewer**
   - Subagent type: `code-reviewer` (or `oh-my-claudecode:code-reviewer`)
   - Task: Review src files touched in active phase. Severity-rated findings
     (critical/high/medium/low). Check SOLID, style, perf, unused code, unsafe
     patterns. Cross-check @spec annotations match actual behavior.
   - Output file: `.omc/reviews/<active_phase>-reviewer.md`

   **Agent B — verifier**
   - Subagent type: `verifier` (or `oh-my-claudecode:verifier`)
   - Task: Cross-check each phase acceptance criterion against evidence. For
     every claim in PROGRESS.md or plan (coverage %, p99, E2E pass, etc),
     locate the artifact file and confirm the number/state. Flag any criterion
     lacking concrete evidence as UNVERIFIED.
   - Output file: `.omc/reviews/<active_phase>-verifier.md`

   **Agent C — critic**
   - Subagent type: `critic` (or `oh-my-claudecode:critic`)
   - Task: Multi-perspective challenge of plan↔implementation coherence. Is
     the architecture as planned? Any scope creep or silent descoping?
     Hidden technical debt introduced? Skipped spec sections?
   - Output file: `.omc/reviews/<active_phase>-critic.md`

5. Each artifact MUST start with YAML frontmatter:

   ```yaml
   ---
   phase: <active_phase>
   reviewer: <reviewer|verifier|critic>
   date: <ISO date>
   verdict: <approved|approved-with-notes|changes-requested|rejected>
   ---
   ```

   Accepted verdicts for gate-pass (configurable in spec-index.yaml `review.accept_verdicts`):
   - `approved` — no blockers
   - `approved-with-notes` — minor findings, tracked as phase-N+1 backlog

   Blocking verdicts:
   - `changes-requested` — must fix before promote
   - `rejected` — plan/impl mismatch, consult user

6. Collate findings into a summary printed to user:
   - Total findings by severity
   - Per-agent verdict
   - Items that must be addressed before promote
   - Items deferred to backlog

7. If any verdict is `changes-requested` or `rejected`:
   - STOP. Do not proceed to `/phase-promote`.
   - List the blocking items clearly.
   - User decides: fix now, or force-promote (requires `CLAUDE_SKIP_HOOKS=1` + documented reason).

8. If all verdicts pass: user can now run `/phase-promote`.

## Rules enforced
- V5-R055 (independent review required before promote)
- V5-R056 (3 reviewer lanes: code-reviewer + verifier + critic)

## Notes
- Do NOT self-review. Agents must be spawned as subagents with fresh context.
- Each agent gets spec path, plan path, evidence paths — briefed independently.
- The review artifacts are committed with the phase-promote commit (audit trail).
