# @agentic-gateway/mega-template

Spec-enforcement plugin for large multi-phase AI-agent projects running in
Claude Code. Combines:

- **Hook-level gates** (harness-enforced, not bypassable by the model)
- **Stable rule IDs** (Doorstop-style `V5-R001` for queryable rules)
- **Phase scope enforcement** (block writes outside current phase)
- **Spec traceability** (`@spec()` annotations + coverage matrix)
- **Version-pinned distribution** (pre-commit framework model)

## Why

Existing Claude Code workflows rely on prose-level CLAUDE.md rules. Research
showed this yields ~70% agent compliance. Large projects with 100KB+ specs
and 8+ phases need real gates, not suggestions.

This plugin provides the missing enforcement layer, composing with the
oh-my-claudecode skill ecosystem (deep-interview, ralplan, autopilot, ralph).

## Plugin stack this assumes (v0.3.0)

| Tool | Role | Install |
|---|---|---|
| oh-my-claudecode (OMC) | Full pipeline: spec→plan→execute→verify, model routing, parallel execution | `/plugin install oh-my-claudecode@omc` |
| **mega-template** | Spec enforcement + phase gating + TDD gate + E2E integrity + verification evidence | See below |
| Context7 | Live SDK docs | `claude mcp add context7 --url https://mcp.context7.com/mcp` (Windows: remote only) |
| psmux *(Windows)* | tmux compatibility for OMC team/parallel | `cargo install psmux` |

**Removed in v0.3.0:**
- **Superpowers** — workflow conflict with OMC pipeline. Quality gates
  absorbed into mega-template hooks (stronger than skill-level prompts).
- **GitNexus** — removed from mega-template integration. Use independently
  if desired; not coupled with phase-gate.
- **Claude-Mem** — security CVE (HTTP :37777 no-auth) + ChromaDB leak.
  Memory = OMC `/wiki` + PROGRESS.md + spec-index.yaml.

## Install (for consumer repos)

### Quick start — npm (recommended)

```bash
cd <consumer-repo>
npm install @agentic-gateway/mega-template
npx mega-template-init
```

If `.git/` is missing, `init` auto-runs `git init` (opt out with `--no-git-init`).

Interactive prompts ask 5 questions (project, package, phase, sections, spec path).

> **PowerShell 5 note:** `&&` is not supported. Use `;` to chain commands, or
> run on separate lines. Example:
> ```powershell
> npm install @agentic-gateway/mega-template ; npx mega-template-init
> ```

### Non-interactive (CI-safe)

```bash
npm install @agentic-gateway/mega-template
npx mega-template-init --non-interactive \
    --project my-consumer \
    --package memory-consumer \
    --phase phase-1 \
    --sections "2,3.1,3.2,4,5,6,7" \
    --spec docs/memory-consumer-spec.md
```

### One-shot (no local install)

```bash
cd <consumer-repo>
npx -p @agentic-gateway/mega-template mega-template-init
```

### Running two phases in parallel (git worktree)

`spec-index.yaml` has a single `active_phase`, so one consumer repo tracks
one phase at a time. If you need to work on two phases simultaneously
(e.g. phase-2a infra + phase-2b feature spike), use **git worktree** —
you get two independent checkouts sharing the same `.git` object store
but with separate `spec-index.yaml`, `.claude/`, and `.omc/state/` per
worktree. Hooks run in each worktree against its own `active_phase`.

```bash
# Main checkout stays on phase-2a
cd <consumer-repo>

# Spin up a second worktree for the phase-2b spike
git worktree add ../<consumer-repo>-phase-2b phase-2b-branch

# In the second worktree, flip active_phase + kick off work
cd ../<consumer-repo>-phase-2b
# edit spec-index.yaml → active_phase: phase-2b
# open a second Claude Code session in this directory
```

Each Claude Code session sees its own worktree — enforcement is fully
scoped. When the spike is done, merge the branch back and `git worktree
remove ../<consumer-repo>-phase-2b`.

### Upgrading an existing consumer repo

If you already initialised a consumer with an older version of mega-template,
bump the package and run the upgrade tool to idempotently patch
`.claude/settings.json` and `spec-index.yaml` with any newly required hooks
and config blocks (e.g. `review:`, `decisions:`). Existing hooks and user
customisations are preserved; only missing entries are added, and
`.bak-<timestamp>` backups are written before any modification.

```bash
cd <consumer-repo>
npm install @agentic-gateway/mega-template@latest
npx mega-template-upgrade          # patches the files
# or: npx mega-template-upgrade --dry-run   # preview only, no writes
```

Re-running on an already-upgraded repo reports "No changes needed — consumer
already up to date." so the command is safe in CI or on every `npm install`.

### Claude Code plugin marketplace (alternative)

```
/plugin marketplace add vunh2301/agentic-gateway-mega-template
/plugin install mega-template@agentic-gateway-mega-template
```

### What `init` generates

- `CLAUDE.md` + `AGENTS.md` — rules with stable IDs
- `PROGRESS.md` — SSOT phase tracking
- `spec-index.yaml` — phase → sections → files map
- `.claude/settings.json` — hooks wired to plugin path (auto-detected npm/marketplace/dev)
- `.gitignore` additions — `docs/specs/`, `docs/plans/`, `.omc/`, etc.

Idempotent: re-running `init` does NOT overwrite existing files. Delete to regenerate.

### Upgrade

```bash
npm update @agentic-gateway/mega-template
```

Or pin a specific version:

```bash
npm install @agentic-gateway/mega-template@0.1.2
```

### After install — start work

```bash
git add . && git commit -m "infra: adopt @agentic-gateway/mega-template"
```

Then in Claude Code (`cwd = <consumer-repo>`):

```
Start <package> phase-1
```

Enforcement hooks activate immediately. `consumer-feature` skill auto-fires.

## What you get

```
<consumer-repo>/
├── CLAUDE.md                           # rules with stable IDs
├── AGENTS.md                           # mirror for Codex/Gemini
├── PROGRESS.md                         # SSOT phase tracking
├── spec-index.yaml                     # phase → sections → files map
├── .claude/
│   ├── settings.json                   # hooks wired in
│   ├── hooks/ (via plugin)
│   └── skills/ (via plugin)
└── docs/
    ├── spec/                           # your actual specs
    ├── specs/                          # SP brainstorm output (gitignored)
    └── plans/                          # SP plan output (gitignored)
```

## Hooks provided (v0.3.0)

| Hook | Event | What it blocks | Rules |
|------|-------|----------------|-------|
| `check-spec.mjs` | PreToolUse Write/Edit | File in `src/` (flat) or `packages/*/src/` without matching spec | V5-R004 |
| `check-phase-gate.mjs` | PreToolUse Write/Edit | File outside active phase scope per `spec-index.yaml` | V5-R016 |
| `check-spec-coverage.mjs` | PreToolUse Write | New src file without `@spec(phase=N,section=X)` annotation | V5-R017 |
| **`enforce-tdd.mjs`** ✨ | PreToolUse Write/Edit | Src file write without corresponding test on disk (git history check) | V5-R030..R034 |
| `require-tests.mjs` | PostToolUse Bash (git commit) | (warn) Commit without matching test for new src file | V5-R006 |
| **`check-e2e-real.mjs`** ✨ | PostToolUse Bash (git commit) | E2E test files containing mock patterns (with annotation exceptions) | V5-R040..R043 |
| **`enforce-verification.mjs`** ✨ | PostToolUse Bash (git commit) | Src commits without test evidence (session/strict/relaxed modes) | V5-R050, V5-R053, V5-R054 |
| `load-context.mjs` | UserPromptSubmit | (non-blocking) inject CLAUDE.md digest + active phase + entry-flow detection | — |
| `orphan-sweep.mjs` | SessionEnd | (non-blocking) reports sections without code coverage | V5-R018 |

✨ = new in v0.3.0

## Skills provided

| Skill | Role |
|-------|------|
| `consumer-feature` | HARD-GATE workflow: brainstorm → plan → TDD → verify |
| `spec-lookup` | Query rules + spec sections by stable ID |
| `phase-manager` | Advance/verify phase lifecycle |

## Slash commands provided

| Command | Purpose |
|---------|---------|
| `/spec-status` | Show current phase + coverage matrix |
| `/phase-promote` | Mark current phase as verified, advance to next |
| `/spec-init` | Bootstrap spec-index.yaml from existing spec doc |

## Windows notes

- **Context7**: MUST use remote mode (`--url https://mcp.context7.com/mcp`).
  Local `npx` mode causes Marketplace refresh loop.
- **psmux**: install for OMC team/parallel execution (`cargo install psmux`).
- Hooks run via Node 20+. Use `cmd /c node` if `node` alias broken.
- Line endings: hooks handle CRLF normalization. No action required.

## Emergency bypass

```
CLAUDE_SKIP_HOOKS=1 npm test
```

Document the bypass in the commit message body. Any commit with bypass
must link to a follow-up issue that unblocks the normal path.

## Status

Version 0.1.0 — initial bootstrap. See `PROGRESS.md` for phase tracking.

## License

MIT
