# PROGRESS — mega-template plugin

Single source of truth for plugin development.

## Current phase

**Phase 6 — Self-dogfood + publish** (in progress)

## Phase plan

| Phase | Status | Goal |
|-------|--------|------|
| 0 | ✅ done | Repo skeleton + plugin manifest + core docs |
| 1 | ✅ done | 6 hooks (check-spec, check-phase-gate, check-spec-coverage, require-tests, load-context, orphan-sweep) |
| 2 | ✅ done | Rule registry — 18 YAML files (V5-R001..R018) + schema |
| 3 | ✅ done | Phase gating (spec-index.yaml format + hook + most-specific match) |
| 4 | ✅ done | Traceability (`@spec()` convention + spec-coverage.mjs + orphan-sweep.mjs) |
| 5 | ✅ done | Distribution (init.mjs + 4 templates + /spec-init /spec-status /phase-promote cmds) |
| 6 | ✅ done | Self-dogfood + GitHub push |
| 7 | ✅ done | Code review fixes (8 bugs) |
| 8 | ✅ done | v0.2.0 flat layout support — `layout: flat\|monorepo` config field, 3 hooks branch, init --layout flag |
| 9 | ✅ done | v0.3.0 — drop Superpowers + drop GitNexus integration + 3 new hooks (TDD/E2E/verification) + 12 new rules |
| 10 | ✅ done | v0.3.1 — deadcode cleanup (remove active SP/GitNexus invocations from SKILL.md, hooks, rules, docs) |
| 11 | ✅ done | v0.4.0 — Gate 4.5 Independent Review (check-review-evidence hook, /phase-review command, V5-R055/R056) |
| 12 | ✅ done | v0.4.1 — auto git init + PowerShell-safe README |
| 13 | ✅ done | v0.5.0 — Decision Mode (inject-decision-rules hook, V5-R057/R058) — skip ceremonial questions |
| 14 | ✅ done | v0.5.1 — inject-decision-rules parser fix (strip YAML comments from list items) |
| 15 | ✅ done | v0.6.0 — `mega-template-upgrade` CLI — idempotent patch for existing consumer repos (manifest-driven hook + config wiring) |

## Verification evidence

- 8/8 JS files pass `node --check`
- 3/3 JSON configs valid (plugin.json, settings.json, package.json)
- 18/18 rule YAMLs present
- Phase gate hook integration test:
  - `packages/memory-consumer/src/extractor.ts` in phase-1 → **EXIT=0 (allow)**
  - `packages/memory-consumer/src/future/advanced.ts` in phase-6 → **EXIT=2 (block)** with diagnostic
  - Most-specific pattern match works correctly (fixed bug: `**` in phase-1 no longer swallows `future/**`)

## Session log

### 2026-04-13

- Phase 0: git init, dir skeleton, metadata, README, CLAUDE.md, AGENTS.md
- Phase 1: 6 hooks written + syntax-verified
- Phase 2: 18 rules in YAML with stable IDs + schema README
- Phase 3: spec-index.yaml format + phase-gate logic with most-specific match
- Phase 4: @spec convention + spec-coverage.mjs + orphan-sweep.mjs
- Phase 5: init.mjs + 4 templates (CLAUDE/AGENTS/PROGRESS/spec-index.yaml) + 3 slash cmds
- Phase 6: LICENSE, self-dogfood `.claude/settings.json`, phase-gate integration test PASS
- Phase 7 (code review fixes after external review, score 7.5/10 → ship-ready):
  - CRITICAL: load-context.mjs `require()` in ESM → import `readdirSync` at top
  - load-context.mjs: added 3-entry-flow detection (new repo / no spec-index / no spec / no plan / open tasks / advance phase)
  - check-phase-gate.mjs: rewrote YAML parser to handle mixed object + block-array siblings (no more `_last` hack)
  - check-spec.mjs: boundary-aware match (`mem` no longer matches `memory-consumer-spec.md`)
  - check-spec-coverage.mjs: removed dead `existsSync` check + unused import
  - require-tests.mjs: added `--root` flag for initial commit edge case
  - V5-R004.yaml: fixed wrong enforcement mapping (`check-spec-coverage` was wrong; switched to doc + planned_hook)
  - init.mjs: `--non-interactive` mode + plugin path auto-detection (npm vs marketplace vs dev) + renamed `writeIfAbsent`
  - PROGRESS.md.tpl: added `| Package | Status | Spec |` header
- Integration tests all PASS:
  - YAML parser mixed syntax (phase-1 with nested object + block array, phase-2 future)
  - load-context prints suggestion for each entry flow state
  - init.mjs --non-interactive mode generates correct files on fresh repo
  - check-spec boundary match rejects `mem` when only `memory-consumer-spec.md` exists

## First consumer

memory-consumer (in repo `agentic-gateway-consumer`) will adopt this plugin
once Phase 6 is complete. Will validate:
- 104KB spec handling (memory-consumer-spec-v4.md)
- 8-phase scope gating (V1 phases 1-5, future phases 6-8)
- Cross-session memory via OMC /wiki (not Claude-Mem)
