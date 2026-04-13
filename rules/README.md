# Rule Registry

Stable, ID'd rules. Reference by ID in CLAUDE.md, code comments, commit
messages, and docs. Never renumber or delete — use `status: deprecated`
and add `superseded_by: V5-RXXX` instead (Doorstop + ADR pattern).

## Schema

```yaml
id: V5-R001                          # stable, immutable
title: short title (one line)
status: active | deprecated | proposed
category: phase-task | code-testing | empirical | no-workaround | security | enforcement
severity: critical | high | medium | low
description: |
  Full text of the rule.
rationale: |
  Why this rule exists. Past incident, constraint, or risk.
enforcement:
  type: hook | skill | doc
  hook: <hook-name>                  # if type: hook
  skill: <skill-name>                # if type: skill
examples:
  good: | (optional)
  bad:  | (optional)
added: YYYY-MM-DD
superseded_by: V5-RXXX               # only if status: deprecated
```

## ID ranges

- `V5-R001..R015` — consumer repo baseline rules (phase/code/empirical/no-workaround/security)
- `V5-R016..R018` — mega-template enforcement rules (phase-gate, trace, orphan)
- `V5-R019+` — future additions

## Query by ID

```bash
# Show rule V5-R004
cat rules/V5-R004.yaml

# Search all rules by category
grep -l "category: security" rules/*.yaml

# Find enforcement bindings
grep -H "hook:" rules/*.yaml
```
