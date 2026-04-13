# CLAUDE.md — {{PROJECT_NAME}}

> This project uses **@agentic-gateway/mega-template** v0.3.0 — spec-enforcement
> plugin with hook-level gates, stable rule IDs, phase scope enforcement,
> TDD enforcement, E2E integrity, and verification evidence.

## Plugin Stack

| Plugin | Role | Install |
|--------|------|---------|
| oh-my-claudecode | Full pipeline: spec→plan→execute→verify, model routing, parallel execution | `/plugin install oh-my-claudecode@omc` |
| **mega-template** | Spec enforcement + phase gating + TDD gate + E2E integrity + verification | `npm install @agentic-gateway/mega-template` |
| Context7 | Live SDK docs (Windows: remote MCP only) | `claude mcp add context7 --url https://mcp.context7.com/mcp` |
| psmux *(Windows)* | tmux compatibility for OMC team/parallel execution | `cargo install psmux` |

**Removed in v0.3.0:**
- **Superpowers** — workflow conflict with OMC pipeline. Quality gates
  (TDD, verification, code-review) absorbed into mega-template hooks.
  Hook-level enforcement is stronger than skill-level prompts.
- **GitNexus** — removed from mega-template integration. Use independently
  if desired; not coupled with phase-gate.
- **Claude-Mem** — security CVE (HTTP :37777 no-auth) + ChromaDB leak.
  Memory = OMC `/wiki` + PROGRESS.md + spec-index.yaml.

## Phase Entry Protocol

Every new phase follows this sequence. Hooks enforce violations at harness level.

```
┌──────────────────────────────────────────────────────────────┐
│ 1. SPEC + PLAN (OMC)                                         │
│    /oh-my-claudecode:deep-interview "Phase N: [desc]"        │
│    → docs/specs/phase-N-spec.md                              │
│    /oh-my-claudecode:ralplan                                 │
│    → docs/plans/phase-N-plan.md                              │
│                                                              │
│ 2. EXECUTE (OMC team or autopilot)                           │
│    /oh-my-claudecode:autopilot or /oh-my-claudecode:team N   │
│    Hooks active per write/commit:                            │
│      - check-phase-gate: file in active phase scope?         │
│      - check-spec: matching spec doc exists?                 │
│      - check-spec-coverage: @spec(phase=N,section=X) present?│
│      - enforce-tdd: corresponding test file exists?          │
│      - require-tests: test for src in commit?                │
│      - check-e2e-real: no mock patterns in E2E tests?        │
│      - enforce-verification: test evidence for src commits?  │
│                                                              │
│ 3. VERIFY                                                    │
│    npm test + typecheck + build all PASS                     │
│    Stage test-results/ for verification gate                 │
│                                                              │
│ 4. PROMOTE                                                   │
│    /phase-promote → checks gates, advances active_phase      │
│                                                              │
│ 5. CAPTURE                                                   │
│    /oh-my-claudecode:wiki add "Phase N decisions"            │
└──────────────────────────────────────────────────────────────┘
```

## Routing — when to use which

| Situation | Action |
|-----------|--------|
| "I want to build X" | `/oh-my-claudecode:deep-interview` or `ralplan` |
| "Plan it" | `/oh-my-claudecode:ralplan` (consensus planning) |
| "Execute the plan" | `/oh-my-claudecode:autopilot` |
| "Do tasks 3-7 in parallel" | `/oh-my-claudecode:team N:executor` or `/ultrawork` |
| "Loop until done" | `/oh-my-claudecode:ralph` |
| "How does library Y work?" | Context7 via `use context7` in prompt |
| "What did we decide last time?" | `/oh-my-claudecode:wiki query` |
| "What's current phase status?" | `/spec-status` |
| "Can I advance phase?" | `/phase-promote` |

## Quality Gates (Harness-Enforced)

These hooks run at the Claude Code harness level. They CANNOT be bypassed
by the model. Bypass only via `CLAUDE_SKIP_HOOKS=1` env (document in commit).

### TDD Gate (`enforce-tdd.mjs`)
- Writing src/ files requires a corresponding test file to exist FIRST
- Convention: `src/foo/bar.ts` → `tests/foo/bar.test.ts` (configurable)
- New src file without test → BLOCKED
- Git history check: test must be committed before or with src
- Rules: V5-R030..R034

### E2E Integrity (`check-e2e-real.mjs`)
- E2E test files must not contain mock patterns (`jest.mock`, `vi.mock`, `nock`, `sinon.stub`, etc.)
- Exceptions:
  - Line-level: `// e2e-mock-ok` on same line
  - Block-level: `// e2e-mock-ok-start` ... `// e2e-mock-ok-end`
  - File-level: `// e2e-real-verified` in first 10 lines
- Rules: V5-R040..R043

### Verification Evidence (`enforce-verification.mjs`)
- Commits with src changes require test evidence (default mode: `session`)
- session mode: accepts staged artifact OR recent test artifact (mtime < 30 min)
- strict mode: must stage `test-results/`, `coverage/`, etc.
- Excluded prefixes: `docs:`, `chore:`, `infra:`, `ci:`, `build:`
- Rules: V5-R050, V5-R053, V5-R054

### Phase Scope (`check-phase-gate.mjs`)
- Writes restricted to paths declared in `spec-index.yaml` active phase
- Most-specific pattern match (deeper paths win)
- Rules: V5-R016

### Spec Existence + Coverage (`check-spec.mjs`, `check-spec-coverage.mjs`)
- src files require matching spec doc
- New src files require `@spec(phase=N,section=X)` annotation
- Rules: V5-R004, V5-R012, V5-R017

### Test Pairing (`require-tests.mjs`)
- Post-commit warning if src files lack test pairs
- Rules: V5-R006

## Rules

Full registry: `node_modules/@agentic-gateway/mega-template/rules/`
Reference rules by stable ID (e.g., V5-R030) in code, comments, commits.

## Commit convention

```
{package}.{phase-or-type}: {description}

Types: {{PACKAGES_CSV}} | infra | docs | fix | chore | ci | build
```

`docs:`, `chore:`, `infra:`, `ci:`, `build:` prefixes skip verification gate.

## Enforcement bypass

`CLAUDE_SKIP_HOOKS=1` disables hooks. Document bypass in commit body.
Never bypass for new features or logic bug fixes. OK for: typos, renames,
version bumps, docstring-only changes.

## Phase Registry

See `spec-index.yaml` for authoritative phase state. Manual summary:

| Phase | Description | Status | Spec | Plan |
|-------|-------------|--------|------|------|
| {{ACTIVE_PHASE}} | {{PHASE1_DESC}} | in-progress | {{SPEC_PATH}} | `docs/plans/{{ACTIVE_PHASE}}-plan.md` |
| phase-2 | {{PHASE2_DESC}} | planned | tbd | tbd |

## Quick Reference

```bash
# Start new phase
claude
> /oh-my-claudecode:deep-interview "Build Phase N: [description]"

# Check status
claude
> /spec-status

# Advance phase
claude
> /phase-promote

# Run tests with evidence
npx vitest run --reporter=json --outputFile=test-results/latest.json
git add test-results/latest.json
```
