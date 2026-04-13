# CLAUDE.md — Mega Template (self-dev rules)

This repo IS the enforcement plugin. These rules apply when developing the
plugin itself. Consumer repos that install this plugin get their own
CLAUDE.md generated from `templates/CLAUDE.md.tpl`.

## Mandatory per-session flow

1. Read this file + `PROGRESS.md` + `docs/architecture.md`
2. Confirm: "Phase X of plugin dev. Will implement Y (stable ID Z)."
3. Work through task
4. Update `PROGRESS.md`
5. Commit: `plugin.{phase}: {description}`

## Self-referential enforcement

This repo dogfoods its own hooks during development. The `.claude/settings.json`
of THIS repo wires the same hooks from `hooks/` into its own dev process —
so building the plugin means the plugin blocks you if you break its own rules.

## Rules for plugin dev

### R-PLUGIN-001: Hooks must fail-open on crash
Any hook script crash → exit 0 (fail-open). Never block user work due to hook
bugs. Log errors to stderr, continue.

### R-PLUGIN-002: No external dependencies in hooks
Hooks run synchronously in agent hot path. Must use only Node built-ins.
No npm install in hooks/ path.

### R-PLUGIN-003: Timeouts on all hook scripts
Every hook declares `timeout` in settings.json. Default 5000ms (PreToolUse),
60000ms (PostToolUse for test runs).

### R-PLUGIN-004: Stable rule IDs are immutable
Once a rule has ID `V5-R001`, that ID cannot be reused or redefined. Rules
can be deprecated (status: deprecated) but not deleted or renumbered.

### R-PLUGIN-005: Phase gates block by path, not task
`check-phase-gate.mjs` decides scope by file path match against
`spec-index.yaml`. NOT by task name or commit message. Path-based = deterministic.

### R-PLUGIN-006: Templates use placeholder syntax
All files in `templates/` use `{{PLACEHOLDER}}` syntax for
parameterization. `scripts/init.mjs` replaces placeholders when bootstrapping
consumer repos.

### R-PLUGIN-007: Windows parity is non-negotiable
Every hook + script tested on Windows (primary dev platform). Path separators
normalized via `replace(/\\/g, '/')`. Line endings handled.

### R-PLUGIN-008: Security — no HTTP servers
This plugin does NOT start any HTTP/TCP server. Reason: Claude-Mem was
rejected for HTTP :37777 no-auth CVE. Plugin communicates via stdin/stdout
only.

### R-PLUGIN-009: Fail-closed on spec-index.yaml missing
If `spec-index.yaml` missing in consumer repo, `check-phase-gate.mjs` warns
but allows (fail-open). If yaml exists but is malformed → block (fail-closed
to catch config errors early).

### R-PLUGIN-010: Version discipline
Breaking changes to hook contracts = major version bump. Consumers pin via
`.claude/settings.json` plugin version. Follow semver.

## Commit convention

```
plugin.{phase}: {description}

phase = bootstrap | rules | gating | trace | distrib | fix | docs
```

Examples:
- `plugin.bootstrap: initial structure + manifest`
- `plugin.rules: add V5-R001..015 with YAML schema`
- `plugin.gating: check-phase-gate.mjs with spec-index.yaml`

## Key references

- `docs/architecture.md` — component design
- `docs/phase-entry-protocol.md` — consumer-facing workflow
- `rules/` — rule registry (authoritative, not CLAUDE.md prose)
- `templates/CLAUDE.md.tpl` — what consumer repos generate
