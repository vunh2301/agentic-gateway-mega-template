# Architecture

## Problem statement

Claude Code workflows rely on prose-level rules in CLAUDE.md. Research
shows this yields ~70% agent compliance. Large projects (100KB+ specs,
8+ phases, multi-package monorepos) need real gates, not suggestions.

## Design principles

1. **Harness-level enforcement** — hooks run via Claude Code harness,
   not via agent prompt. Non-bypassable except via explicit env var.
2. **Fail-open on crash** — a hook bug must never block user work.
3. **Stable IDs over prose** — rules have immutable IDs (Doorstop pattern).
4. **Version-pinned distribution** — consumer repos pin plugin version
   (pre-commit framework pattern).
5. **No HTTP servers** — security lesson from Claude-Mem (:37777 no-auth).
6. **Windows parity** — primary dev platform. Line endings, path separators,
   npx quirks all handled.

## Layers

### L1 — Workflow discipline (Superpowers)
Brainstorming, planning, TDD, debugging, verification skills. Provided by
external `superpowers` plugin.

### L2 — Multi-agent orchestration (oh-my-claudecode)
Parallel workers, team delegation, persistent wiki. Provided by external
`oh-my-claudecode` plugin.

### L3 — Spec enforcement (this plugin)
Hook-level gates: spec existence, phase scope, traceability, test coverage,
orphan detection. Skill: consumer-feature 6-gate workflow.

### L4 — Intelligence (GitNexus + Context7)
Code graph + impact analysis via GitNexus (local CLI). Live SDK docs via
Context7 (remote MCP on Windows).

### Rejected layers

- **Claude-Mem** — security CVE (HTTP :37777 no-auth) + stability
  (ChromaDB subprocess leak). Replaced by OMC `/wiki`.

## Data flow

```
User prompt
    │
    ▼
┌─────────────────────┐
│ UserPromptSubmit    │───► load-context.mjs (inject CLAUDE.md digest)
└─────────────────────┘
    │
    ▼
Claude thinks + calls tool
    │
    ▼
┌─────────────────────┐
│ PreToolUse          │───► check-spec.mjs
│ (Write/Edit)        │───► check-phase-gate.mjs
│                     │───► check-spec-coverage.mjs
└─────────────────────┘
    │  (exit 0 = allow, exit 2 = deny)
    ▼
Tool executes
    │
    ▼
┌─────────────────────┐
│ PostToolUse         │───► require-tests.mjs (on git commit)
│ (Bash)              │
└─────────────────────┘
    │
    ▼
Response to user
```

## Hook contracts

Each hook:
- Reads JSON payload from stdin (tool_name, tool_input)
- Writes diagnostics to stderr
- Exits with code: 0 (allow), 2 (deny/block), other (warn but allow)
- Respects `CLAUDE_SKIP_HOOKS=1` env bypass
- Fails open on any uncaught error (R-PLUGIN-001)
- Uses only Node built-ins (R-PLUGIN-002)
- Has timeout declared in settings.json (R-PLUGIN-003)

## File responsibilities

```
.claude-plugin/plugin.json   — Claude Code plugin manifest
hooks/                       — PreToolUse/PostToolUse/UserPromptSubmit hooks
skills/                      — consumer-feature skill with HARD-GATE workflow
commands/                    — /spec-status, /phase-promote, /spec-init
templates/                   — CLAUDE.md.tpl, PROGRESS.md.tpl, spec-index.yaml.tpl
rules/                       — V5-R001..R018.yaml (stable ID registry)
scripts/                     — init.mjs, spec-coverage.mjs (CLI tools)
docs/                        — architecture, windows-setup, philosophy
```

## Distribution

See `README.md` — published to npm + Claude Code plugin marketplace.
Consumer repos install via `/plugin install` or `npx mega-template-init`.

## Non-goals

- Spec parsing / LLM-based spec verification (non-deterministic,
  expensive). We use grep-based matrix instead.
- Full requirements management (use Doorstop or sphinx-needs for
  safety-critical work).
- Replacing Superpowers or OMC (we compose with them, not replace).
- Cross-session AI memory (rejected — security). Use OMC /wiki.
