# AGENTS.md — {{PROJECT_NAME}}

Mirror of `CLAUDE.md` for Codex, Gemini, and agents that don't auto-load
`CLAUDE.md`. Read `CLAUDE.md` first.

Enforcement hooks (via mega-template plugin) apply to all agents equally.
They run at the Claude Code harness level, not at the model level.

Key reminders:

- **V5-R001** Read CLAUDE.md + PROGRESS.md + spec-index.yaml before code
- **V5-R004** Zero imports from Gateway source
- **V5-R016** Writes only in active_phase scope (see `spec-index.yaml`)
- **V5-R017** New src files need `@spec(phase=X,section=Y)` annotation
- **V5-R011** Fix root cause, not symptoms
- **V5-R013** Three failed fixes → question architecture
- **V5-R014** REDACT secrets before any output

Current phase: see `spec-index.yaml` `active_phase`.
Active package: see `PROGRESS.md` "Active package" section.
Rule registry: `node_modules/@agentic-gateway/mega-template/rules/*.yaml`.
