# spec-index.yaml — phase and section map for mega-template enforcement
#
# Schema:
#   active_phase: which phase is currently in progress (string)
#   spec: path to the authoritative spec document (string)
#   phases: map of phase-name to config
#     status: in-progress | planned | verified | deprecated
#     sections: [list of spec section IDs implemented by this phase]
#     paths: [list of glob patterns — files this phase is allowed to touch]
#     gate: condition that must pass before this phase becomes in-progress
#
# Used by:
#   - check-phase-gate hook (blocks writes outside active phase paths)
#   - orphan-sweep hook (reports sections without @spec annotation)
#   - /spec-status command (shows coverage)
#   - /phase-promote command (advances active_phase)

active_phase: {{ACTIVE_PHASE}}
spec: {{SPEC_PATH}}
layout: {{LAYOUT}}   # flat | monorepo (default: monorepo)

phases:
  {{ACTIVE_PHASE}}:
    status: in-progress
    sections: [{{ACTIVE_SECTIONS}}]
    paths:
{{ACTIVE_PATHS}}

  # Example future phase (edit to match your spec):
  # phase-2:
  #   status: planned
  #   gate: "{{ACTIVE_PHASE}}.status == verified"
  #   sections: [8, 9]
  #   paths:
  #     - src/phase2/**        # flat layout example
  #     # OR packages/{{ACTIVE_PACKAGE}}/src/phase2/**  (monorepo)
