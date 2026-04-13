# CLAUDE.md — {{PROJECT_NAME}}

> This project uses **@agentic-gateway/mega-template** — spec-enforcement
> plugin with hook-level gates, stable rule IDs, phase scope enforcement,
> and traceability.

## Plugin Stack

| Plugin | Role | Install |
|--------|------|---------|
| Superpowers | Workflow discipline (brainstorm → TDD → verify) | `/plugin install superpowers@claude-plugins-official` |
| oh-my-claudecode | Multi-agent orchestration + /wiki memory | `/plugin install oh-my-claudecode@omc` |
| **mega-template** | Spec enforcement (this plugin) | `/plugin install mega-template@...` |
| GitNexus | Code intelligence + impact analysis | `npm i -g gitnexus` (Windows: global only) |
| Context7 | Live SDK docs | remote MCP — NOT local npx on Windows |

**Not used:** Claude-Mem (rejected — security CVE + subprocess leaks).
Memory = OMC `/wiki` skill + PROGRESS.md + spec-index.yaml.

## Phase Entry Protocol

Every new phase follows this sequence. Do NOT skip steps. Enforcement hooks
will block violations.

```
┌──────────────────────────────────────────────────────────────┐
│ 1. UNDERSTAND (GitNexus + /wiki)                             │
│    npx gitnexus analyze                                      │
│    /oh-my-claudecode:wiki query "related to X"               │
│                                                              │
│ 2. BRAINSTORM (Superpowers auto-fires)                       │
│    "I want to implement Phase N: [desc]"                     │
│    → Socratic Q&A → docs/specs/phase-N-spec.md               │
│    [HARD GATE — no code until approved]                      │
│                                                              │
│ 3. PLAN (Superpowers)                                        │
│    "Write the plan"                                          │
│    → docs/plans/phase-N-plan.md (2-5 min tasks)              │
│                                                              │
│ 4. EXECUTE (Superpowers TDD + /team for parallel)            │
│    Per task: RED → GREEN → REFACTOR                          │
│    New src files MUST have @spec(phase=N,section=X) (V5-R017)│
│    Hook: check-phase-gate enforces path scope (V5-R016)      │
│                                                              │
│ 5. VERIFY (Superpowers + GitNexus)                           │
│    superpowers:verification-before-completion                │
│    npx gitnexus detect_changes                               │
│    npm test + typecheck + build all PASS                     │
│                                                              │
│ 6. PROMOTE                                                    │
│    /phase-promote → checks gates, advances active_phase      │
│                                                              │
│ 7. CAPTURE                                                    │
│    /oh-my-claudecode:wiki add "Phase N decisions"            │
└──────────────────────────────────────────────────────────────┘
```

## Routing — when to use which

| Situation | Action |
|-----------|--------|
| "I want to build X" | Superpowers brainstorm auto-fires |
| "Execute the plan" | `/execute-plan` (SP subagent-driven) |
| "Do tasks 3-7 in parallel" | `/oh-my-claudecode:team` or `/ultrawork` |
| "What does module X do?" | `gitnexus_query` (MCP) |
| "Will change X break Y?" | `gitnexus_impact` (MCP) |
| "How does library Y work?" | Context7 via `use context7` in prompt |
| "What did we decide last time?" | `/oh-my-claudecode:wiki query` |
| "What's current phase status?" | `/spec-status` |
| "Can I advance phase?" | `/phase-promote` |

## Rules

Full rule registry: `node_modules/@agentic-gateway/mega-template/rules/`
Reference rules by stable ID (e.g., V5-R004) in code comments and commits.

### Critical (enforced by hooks — will block tool calls)

- **V5-R001** Read CLAUDE.md + PROGRESS.md + spec before coding
- **V5-R004** Zero imports from Gateway source — public API only
- **V5-R016** Writes must be in active phase scope (check-phase-gate)
- **V5-R017** New src files require `@spec()` annotation (check-spec-coverage)

### High (enforced by hooks + skills)

- **V5-R005** No mock Gateway in E2E tests
- **V5-R006** Every src file has matching test
- **V5-R008** Empirical verify before runtime claims
- **V5-R011** Fix root cause, not symptoms
- **V5-R013** After 3 failed fixes → question architecture
- **V5-R014** REDACT secrets before output

Full list: `/spec-status` or `cat node_modules/@agentic-gateway/mega-template/rules/*.yaml`.

## Commit convention

```
{package}.{phase-or-type}: {description}

Types: {{PACKAGES_CSV}} | infra | docs | fix
```

## Enforcement bypass

`CLAUDE_SKIP_HOOKS=1` disables hooks. Document bypass in commit body.
Never bypass for new features or logic bug fixes. OK for: typos, renames,
version bumps, docstring-only changes.

## Phase Registry

See `spec-index.yaml` for authoritative phase state. Manual summary:

| Phase | Description | Status | Spec | Plan |
|-------|-------------|--------|------|------|
| phase-1 | {{PHASE1_DESC}} | ⬜ | `docs/specs/phase-1-spec.md` | `docs/plans/phase-1-plan.md` |
| phase-2 | {{PHASE2_DESC}} | ⬜ | `docs/specs/phase-2-spec.md` | `docs/plans/phase-2-plan.md` |

## Quick Reference

```bash
# Start new phase
claude
> I want to build Phase N: [description]

# Check status
claude
> /spec-status

# Advance phase
claude
> /phase-promote

# Query what changed
npx gitnexus detect_changes
```
