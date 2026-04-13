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

This plugin provides the missing enforcement layer, compatible with
Superpowers + oh-my-claudecode skill ecosystems.

## Plugin stack this assumes

| Tool | Role | Install |
|---|---|---|
| Superpowers | Workflow discipline (brainstorm → TDD → verify) | `/plugin install superpowers@claude-plugins-official` |
| oh-my-claudecode (OMC) | Multi-agent orchestration (team, ralph, wiki) | `/plugin install oh-my-claudecode@omc` |
| **mega-template** | Spec enforcement + phase gating | See below |
| GitNexus | Code intelligence + impact analysis | `npm i -g gitnexus` (Windows: global only) |
| Context7 | Live SDK docs | `claude mcp add context7 --url https://mcp.context7.com/mcp` (Windows: remote only) |

**NOT included:** Claude-Mem (rejected — HTTP :37777 no-auth + ChromaDB
subprocess leaks). Replaced by OMC `/wiki` skill + CLAUDE.md + SP plan
checkboxes.

## Install (for consumer repos)

### Quick start — npm (recommended)

```bash
cd <consumer-repo>
npm install @agentic-gateway/mega-template
npx mega-template-init
```

Interactive prompts ask 5 questions (project, package, phase, sections, spec path).

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

## Hooks provided

| Hook | Event | What it blocks |
|------|-------|----------------|
| `check-spec.mjs` | PreToolUse Write/Edit | File in `packages/*/src/` without matching spec in `docs/` |
| `check-phase-gate.mjs` | PreToolUse Write/Edit | File outside current phase scope per `spec-index.yaml` |
| `check-spec-coverage.mjs` | PreToolUse Write | New src file without `@spec(...)` annotation |
| `require-tests.mjs` | PostToolUse Bash (git commit) | Commit without matching test for new src file |
| `load-context.mjs` | UserPromptSubmit | (non-blocking) injects CLAUDE.md digest + active phase |
| `orphan-sweep.mjs` | SessionEnd | (non-blocking) reports sections without code coverage |

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

- **GitNexus**: MUST install global (`npm i -g gitnexus`). `npx` mode has
  peer-dependency conflicts.
- **Context7**: MUST use remote mode (`--url https://mcp.context7.com/mcp`).
  Local `npx` mode causes Marketplace refresh loop.
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
