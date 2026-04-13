# AGENTS.md

Mirror of `CLAUDE.md` for Codex, Gemini, and agents that don't auto-load
`CLAUDE.md`. Read `CLAUDE.md` first.

Key reminders for plugin developers:

- Hooks fail-open on crash (R-PLUGIN-001)
- No npm deps in hooks (R-PLUGIN-002)
- Stable rule IDs immutable (R-PLUGIN-004)
- Windows parity mandatory (R-PLUGIN-007)
- No HTTP servers — security (R-PLUGIN-008)
- Follow semver for hook contracts (R-PLUGIN-010)

Current phase: see `PROGRESS.md`.
