# AGENTS.md — {{PROJECT_NAME}}

Mirror of `CLAUDE.md` for Codex, Gemini, and agents that don't auto-load
`CLAUDE.md`. Read `CLAUDE.md` first.

Enforcement hooks (via @agentic-gateway/mega-template v0.3.0) apply to all
agents equally. They run at the Claude Code harness level, not at the model
level — bypass requires explicit `CLAUDE_SKIP_HOOKS=1` env.

Key reminders:

- **V5-R001** Read CLAUDE.md + PROGRESS.md + spec-index.yaml before code
- **V5-R004** Zero imports from Gateway source (consumer = public API only)
- **V5-R016** Writes only in active_phase scope (see `spec-index.yaml`)
- **V5-R017** New src files need `@spec(phase=X,section=Y)` annotation
- **V5-R030** Every src file needs a corresponding test file (TDD gate)
- **V5-R040** No mock patterns in E2E tests (use real Gateway/infra)
- **V5-R050** Commits with src changes need test evidence
- **V5-R011** Fix root cause, not symptoms
- **V5-R013** Three failed fixes → question architecture
- **V5-R014** REDACT secrets before any output

Removed plugins (do NOT install):
- Superpowers (workflow conflict — OMC owns pipeline now)
- Claude-Mem (security CVE)

Current phase: see `spec-index.yaml` `active_phase`.
Active package: see `PROGRESS.md` "Active package" section.
Rule registry: `node_modules/@agentic-gateway/mega-template/rules/*.yaml`.
