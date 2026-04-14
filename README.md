# @agentic-gateway/mega-template

Plugin thực thi spec (spec-enforcement) cho các dự án multi-phase lớn chạy
trong Claude Code. Biến các quy tắc CLAUDE.md (vốn chỉ là lời khuyên) thành
**gate cứng ở tầng harness** mà agent không thể bypass.

Thiết kế để dùng cùng bộ kỹ năng **oh-my-claudecode (OMC)**:
`deep-interview → ralplan → autopilot → verify → phase-promote`.

---

## Mục lục

1. [Tại sao cần mega-template?](#tại-sao-cần-mega-template)
2. [Cài đặt](#cài-đặt)
3. [Workflow 5-gate tổng quan](#workflow-5-gate-tổng-quan)
4. [Cấu trúc file sinh ra](#cấu-trúc-file-sinh-ra)
5. [Các hook harness-level](#các-hook-harness-level)
6. [Các slash command](#các-slash-command)
7. [Các CLI (npx)](#các-cli-npx)
8. [File cấu hình: `spec-index.yaml`](#file-cấu-hình-spec-indexyaml)
9. [Workflow state: `.omc/state/workflow.json`](#workflow-state-omcstateworkflowjson)
10. [Rule registry](#rule-registry)
11. [Ví dụ minh hoạ](#ví-dụ-minh-hoạ)
12. [Ghi chú Windows/PowerShell](#ghi-chú-windowspowershell)
13. [Bypass khẩn cấp](#bypass-khẩn-cấp)
14. [Chạy 2 phase song song](#chạy-2-phase-song-song)

---

## Tại sao cần mega-template?

Quy tắc prose trong `CLAUDE.md` chỉ đạt ~70% compliance. Dự án có spec
100KB+ và 8+ phase **cần gate thật, không phải gợi ý**.

Mega-template cung cấp:

- **Hook tầng harness** — hook chạy bên ngoài mô hình, không thể "quên"
- **Rule ID cố định** — tham chiếu quy tắc kiểu `V5-R011` trong commit/code
- **Phase scope enforcement** — chặn write file ngoài phase hiện tại
- **Spec traceability** — annotation `@spec()` + coverage matrix
- **Independent review gate** — 3 agent reviewer/verifier/critic bắt buộc trước khi promote phase
- **Slice-order enforcement** — commit phải đúng thứ tự slice trong plan
- **Drift detection** — nhận diện prompt lạc đề và kéo user về flow chính
- **Resume tự động** — session mới biết nên tiếp tục slice nào

---

## Cài đặt

### Quick start (npm — khuyến nghị)

```bash
cd <consumer-repo>
npm install @agentic-gateway/mega-template
npx mega-template-init
```

Init sẽ:
- Tự chạy `git init` nếu thư mục chưa là repo (dùng `--no-git-init` để tắt)
- Hỏi 5 câu: project, package, phase, sections, spec path
- Sinh toàn bộ file baseline: `CLAUDE.md`, `AGENTS.md`, `PROGRESS.md`, `spec-index.yaml`, `.claude/settings.json`, `.claude/commands/*.md`, `.gitignore`

### Non-interactive (CI)

```bash
npx mega-template-init --non-interactive \
    --project my-consumer \
    --package memory-consumer \
    --phase phase-1 \
    --sections "2,3.1,3.2,4,5,6,7" \
    --spec docs/memory-consumer-spec.md \
    --layout monorepo
```

Flag:
- `--layout flat|monorepo` — layout của consumer repo
- `--no-git-init` — không auto `git init`

### One-shot (không cài cục bộ)

```bash
cd <consumer-repo>
npx -p @agentic-gateway/mega-template mega-template-init
```

### Upgrade consumer cũ lên version mới

```bash
cd <consumer-repo>
npm install @agentic-gateway/mega-template@latest
npx mega-template-upgrade            # idempotent patch
# hoặc: npx mega-template-upgrade --dry-run   # xem trước, không ghi
```

Upgrade tự:
- Thêm hook mới vào `.claude/settings.json`
- Heal path cũ (relative → absolute) nếu sai
- Thêm block cấu hình mới (`review:`, `decisions:`) vào `spec-index.yaml`
- Copy slash command mới vào `.claude/commands/`
- Backup mọi file chỉnh sửa: `*.bak-<timestamp>`

Chạy lại sẽ báo "No changes needed" — an toàn trong CI hoặc sau mỗi `npm install`.

### Cài qua Claude Code plugin marketplace (tuỳ chọn)

```
/plugin marketplace add vunh2301/agentic-gateway-mega-template
/plugin install mega-template@agentic-gateway-mega-template
```

**Lưu ý**: npm install và plugin marketplace cung cấp cùng 1 bộ hook +
slash command (v0.9.1+ copy slash command vào `.claude/commands/`).
Chọn 1 cách, không cần cả 2.

---

## Workflow 5-gate tổng quan

Mỗi tính năng code phải đi qua 5 gate (thêm Gate 4.5 từ v0.4.0):

```
Gate 1 — Memory & Spec Review
  ↓ (read CLAUDE.md, PROGRESS.md, spec-index.yaml, spec doc)
  ↓ (confirm state với user)
Gate 2 — Plan Written
  ↓ (/oh-my-claudecode:ralplan — consensus Planner + Architect + Critic)
  ↓ (output: .omc/plans/<phase>-plan.md)
Gate 3 — Execute
  ↓ (linear / autopilot / team / ralph)
  ↓ (hooks active: check-spec, check-phase-gate, check-spec-coverage, enforce-tdd)
Gate 4 — Verify
  ↓ (/oh-my-claudecode:verify — evidence check)
  ↓ (npm test, coverage, build — hook check-e2e-real, enforce-verification)
Gate 4.5 — Independent Review   ← v0.4.0
  ↓ (/phase-review — 3 agents parallel)
  ↓ (.omc/reviews/<phase>-{reviewer,verifier,critic}.md)
  ↓ (verdict: approved | approved-with-notes)
Gate 5 — Phase Promote
  ↓ (/phase-promote — check-review-evidence hook block nếu thiếu artifact)
  ↓ (spec-index.yaml: active_phase advance)
```

Tự động hoá flow này qua skill `consumer-feature` (có sẵn trong
OMC khi trigger keyword: "build", "add feature", "implement", "start phase").

---

## Cấu trúc file sinh ra

```
<consumer-repo>/
├── CLAUDE.md                  # quy tắc + workflow entry
├── AGENTS.md                  # mirror cho Codex/Gemini
├── PROGRESS.md                # SSOT tiến độ phase
├── spec-index.yaml            # phase → sections → paths map + config blocks
├── rules/                     # (tuỳ chọn) Doorstop-style rule YAML
│   ├── V5-R001.yaml
│   └── …
├── .claude/
│   ├── settings.json          # hook wiring (absolute paths)
│   ├── settings.local.json    # secrets (gitignored)
│   └── commands/              # slash commands copy từ plugin
│       ├── spec-status.md
│       ├── phase-promote.md
│       ├── phase-review.md
│       └── spec-init.md
├── .omc/
│   ├── state/
│   │   └── workflow.json      # slice order + progress (driver cho slice-order hook)
│   ├── plans/                 # ralplan output (gitignored)
│   ├── specs/                 # deep-interview output (gitignored)
│   └── reviews/               # Gate 4.5 artifacts (gitignored)
└── docs/
    └── <your-spec>.md         # north-star spec
```

---

## Các hook harness-level

Toàn bộ 12 hook chạy ở level Claude Code (bên ngoài mô hình), không bypass
được trừ khi set `CLAUDE_SKIP_HOOKS=1`.

| Hook | Event | Chặn gì | Rule |
|------|-------|---------|------|
| `load-context.mjs` | UserPromptSubmit | (không block) Inject context: workflow-protocol, intent classifier, active-flow, off-topic warning, CLAUDE.md digest, active phase | — |
| `inject-decision-rules.mjs` | UserPromptSubmit | (không block) Inject guidance để agent auto-apply rule V5-R011/R030/R053/R054 + constraint defaults, skip câu hỏi lễ nghi | V5-R057, V5-R058 |
| `check-spec.mjs` | PreToolUse Write/Edit | File trong `src/` (flat) hoặc `packages/*/src/` không có spec doc cho package | V5-R004 |
| `check-phase-gate.mjs` | PreToolUse Write/Edit | File ngoài scope của `active_phase.paths` trong `spec-index.yaml` | V5-R016 |
| `check-spec-coverage.mjs` | PreToolUse Write | File src mới không có `@spec(phase=N,section=X)` annotation | V5-R017 |
| `enforce-tdd.mjs` | PreToolUse Write/Edit | Src file write mà test pair chưa tồn tại trên disk (check bằng git log, không phải mtime) | V5-R030..R034 |
| `check-review-evidence.mjs` | PreToolUse Bash (git commit/tag) | Commit `phase-promote:` hoặc tag `phase-*-verified` mà thiếu `.omc/reviews/<phase>-{reviewer,verifier,critic}.md` với verdict accepted | V5-R055, V5-R056 |
| `enforce-slice-order.mjs` | PreToolUse Bash (git commit) | Commit có slice-id không match slice tiếp theo trong `workflow.json` (bỏ qua khi không có workflow.json) | V5-R059, V5-R060 |
| `require-tests.mjs` | PostToolUse Bash (git commit) | (cảnh báo) Commit có src file mới mà không có test pair | V5-R006 |
| `check-e2e-real.mjs` | PostToolUse Bash (git commit) | E2E test file chứa mock pattern (`jest.mock`, `vi.mock`, `nock`, `sinon.stub`) | V5-R040..R043 |
| `enforce-verification.mjs` | PostToolUse Bash (git commit) | Src commit không có evidence test (strict/session/relaxed mode, mặc định session) | V5-R050, V5-R053, V5-R054 |
| `orphan-sweep.mjs` | SessionEnd | (không block) Report section đã declare trong `spec-index.yaml` nhưng chưa có `@spec` annotation trong code | V5-R018 |

### Chi tiết từng hook

#### UserPromptSubmit chain

- **load-context.mjs** — Chèn vào đầu mỗi prompt:
  - `<workflow-protocol>` — bắt buộc đọc state files trước khi Write/Edit
  - `<prompt-classifier>` — phân loại intent (coding/trivial/promote/none) để mạnh hoá protocol
  - `<active-flow>` — nếu có `workflow.json`: phase, slice hiện tại, slice tiếp theo, resume hint
  - `<off-topic-warning>` — nếu prompt (≥6 từ) không share keyword với phase sections
  - `[MEGA-TEMPLATE CONTEXT]` — active phase + package + rules digest

- **inject-decision-rules.mjs** — Chèn `<decision-guidance>`:
  - Liệt kê rule `auto_apply` (agent tự quyết theo rule, không hỏi user)
  - `constraint_defaults` (hot-path purity, session-ended trigger, model reuse, bounded backoff)
  - `user_choice` (scope prioritization, oversight level, external API design) — vẫn phải hỏi
  - Hướng dẫn skill skip câu hỏi lễ nghi, log rule-id trong commit

#### PreToolUse Write/Edit chain

- **check-spec.mjs** — Tìm spec doc cho package. Ví dụ với `packages/memory-consumer/src/foo.ts`, tìm `docs/memory-consumer-spec*.md`. Không có → block.

- **check-phase-gate.mjs** — So path của file Write với `phases[active_phase].paths` pattern. Most-specific-pattern-wins khi tie. Ngoài scope → block.

- **check-spec-coverage.mjs** — Chỉ trigger trên Write **mới** (Edit thì skip). Yêu cầu annotation `@spec(phase=N,section=X)` trong 30 dòng đầu. Thiếu → block.

- **enforce-tdd.mjs** — Với src file, tìm test pair theo `tdd.test_conventions`. Check bằng `git log --diff-filter=A` rằng test commit TRƯỚC src file (không dùng mtime vì không ổn định trên Windows). Test chưa có → block.

#### PreToolUse Bash chain

- **check-review-evidence.mjs** — Bắt commit prefix `phase-promote:` hoặc tag `phase-*-verified`. Đọc `spec-index.yaml review.*` config. Yêu cầu 3 file artifact với frontmatter `verdict: approved` hoặc `approved-with-notes`. Thiếu → block exit 2.

- **enforce-slice-order.mjs** — Bắt `git commit`. Nếu `.omc/state/workflow.json` tồn tại, trích slice-id từ commit message (pattern `v5-<phase>.slice-<NN>:` hoặc `.step-<NN>:`). Mismatch slice tiếp theo → block. Prefix exempt: `docs:`, `chore:`, `infra:`, `ci:`, `build:`, `test:`, `refactor:`, `revert:`, `merge:`, hotfix, phase-promote.

#### PostToolUse Bash chain

- **require-tests.mjs** — Scan commit vừa làm (`git diff-tree HEAD`). Nếu thêm src file mà không có test pair → warn (không block). Initial commit dùng `--root`.

- **check-e2e-real.mjs** — Scan staged E2E file (match `e2e.test_patterns`) tìm mock pattern. Có thể bypass per-line (`// @allow-mock`), per-block, per-file. V5-R040 cấm mock gateway trong E2E.

- **enforce-verification.mjs** — Nếu commit đụng src file, yêu cầu evidence (staged artifact HOẶC artifact mtime <30min ở session mode). Prefix `docs:/chore:/...` exempt. `verification.strictness` = `strict|session|relaxed`.

#### SessionEnd

- **orphan-sweep.mjs** — So `active_phase.sections` vs `@spec` annotations grep trong src files. Section declare nhưng 0 file annotation → report orphan.

---

## Các slash command

4 command copy vào `.claude/commands/` khi init/upgrade. Gõ `/` trong Claude Code để autocomplete.

| Command | Mục đích |
|---------|----------|
| `/spec-status` | Hiển thị phase hiện tại + declared sections + coverage matrix + orphan sections |
| `/spec-init` | Bootstrap `spec-index.yaml` từ spec doc có sẵn (giúp khởi tạo cho repo đã có spec) |
| `/phase-review` | Chạy Gate 4.5 — spawn 3 agent (reviewer + verifier + critic) song song, mỗi agent ghi verdict vào `.omc/reviews/<phase>-<role>.md` |
| `/phase-promote` | Gate 5 — pre-check (orphan=0, tests pass, build pass, PROGRESS.md <24h, 3 reviews approved) → update `spec-index.yaml active_phase` → commit `phase-promote:` |

---

## Các CLI (npx)

Dùng khi không có slash command (ví dụ CI, hoặc consumer dùng pure npm install).

| Lệnh | Mục đích |
|---|---|
| `npx mega-template-init` | Bootstrap consumer mới |
| `npx mega-template-upgrade [--dry-run]` | Idempotent patch consumer cũ lên version mới nhất |
| `npx mega-template-status` | Tương đương `/spec-status`, output table |
| `npx mega-template-coverage` | Coverage matrix chi tiết (grep `@spec` trong mọi src file) |

---

## File cấu hình: `spec-index.yaml`

Toàn bộ hook đọc từ file này — 1 nơi chỉnh = đổi tất cả gate.

```yaml
active_phase: phase-1
spec: docs/memory-consumer-spec-v4.md
layout: monorepo                # flat | monorepo

phases:
  phase-1:
    status: in-progress
    sections: [2, 3, 4, 5, 6, 7]
    paths:
      - packages/memory-consumer/src/**
      - packages/memory-consumer/tests/**

  phase-2:
    status: planned
    gate: "phase-1.status == verified"
    sections: [8, 9]
    paths:
      - packages/memory-consumer/src/phase2/**

# === Quality Gates ===

tdd:
  enabled: true
  src_patterns: ["packages/memory-consumer/src/**"]
  test_conventions:
    - pattern: "^packages/memory-consumer/src/(.*)\\.ts$"
      test: "packages/memory-consumer/tests/$1.test.ts"
  exclude:
    - "**/*.d.ts"
    - "**/index.ts"
    - "**/types.ts"

e2e:
  enabled: true
  test_patterns:
    - "**/*.e2e.test.*"
    - "**/e2e/**/*.test.*"
  extra_blocked_patterns: []

verification:
  enabled: true
  strictness: session           # strict | session | relaxed
  evidence_patterns:
    - "test-results/**/*.json"
    - "coverage/**"
    - "e2e/results/**"
  exclude_prefixes:
    - "docs:"
    - "chore:"
    - "infra:"
    - "ci:"
    - "build:"

review:
  enabled: true
  required: [reviewer, verifier, critic]
  artifact_dir: .omc/reviews
  accept_verdicts: [approved, approved-with-notes]

decisions:
  enabled: true
  auto_apply:
    - V5-R011   # fix root cause over band-aid
    - V5-R030   # TDD-first ordering
    - V5-R053   # commit-prefix exclusions
    - V5-R054   # session-mode verification
  constraint_defaults:
    - hot_path_purity
    - session_ended_trigger
    - model_reuse
    - bounded_backoff
  user_choice:
    - scope_prioritization
    - oversight_level
    - external_api_design
```

---

## Workflow state: `.omc/state/workflow.json`

File điều khiển slice-order. Tạo bởi `/ralplan` hoặc `/autopilot`,
cập nhật sau mỗi commit slice xong.

```json
{
  "phase": "phase-1",
  "plan_file": "docs/plans/phase-1-plan.md",
  "started_at": "2026-04-14T04:50:00Z",
  "slices": [
    {"id": "01", "title": "Project scaffold", "status": "done", "commit": "cd0d170"},
    {"id": "02", "title": "WS client", "status": "in-progress", "commit": null},
    {"id": "03", "title": "Extraction pipeline", "status": "pending", "commit": null}
  ],
  "updated_at": "2026-04-14T05:10:00Z"
}
```

**Commit convention khi có workflow.json:**

```
v5-<phase>.slice-<NN>: <mô tả>        # ví dụ: v5-phase-1.slice-02: implement WS client
v5-<phase>.step-<NN>: <mô tả>         # alias
v5-<phase>.hotfix: <mô tả>            # exempt
docs: / chore: / infra: / ci:         # exempt
phase-promote: <mô tả>                # gated bởi check-review-evidence
```

Không có `workflow.json` → `enforce-slice-order` no-op, repo không bị ảnh hưởng.

---

## Rule registry

60+ rule Doorstop-style trong thư mục `rules/`. Tham chiếu bằng ID cố định:

```yaml
# rules/V5-R011.yaml
id: V5-R011
title: Fix root cause, not symptoms
status: active
category: no-workaround
severity: high
description: |
  Khi gặp bug, agent phải tìm root cause và fix tại gốc,
  không được viết workaround che symptom.
enforcement:
  type: doc
added: 2026-04-10
```

Query:
```bash
# Rule by ID
cat rules/V5-R011.yaml

# Search by category
grep -l "category: enforcement" rules/*.yaml

# Xem hook nào bind rule nào
grep -H "hook:" rules/*.yaml
```

Phân vùng ID:
- `V5-R001..R015` — baseline consumer rules
- `V5-R016..R018` — mega-template v0.1.0 enforcement
- `V5-R030..R034` — TDD
- `V5-R040..R043` — E2E integrity
- `V5-R050..R054` — verification evidence
- `V5-R055..R056` — independent review gate (v0.4.0)
- `V5-R057..R058` — decision mode (v0.5.0)
- `V5-R059..R060` — slice-order enforcement (v0.8.0)

---

## Ví dụ minh hoạ

### 1. Bootstrap dự án mới

```bash
mkdir my-consumer && cd my-consumer
git init
npm install @agentic-gateway/mega-template
npx mega-template-init --non-interactive \
    --project my-consumer \
    --package my-consumer \
    --phase phase-1 \
    --sections "1,2,3" \
    --spec docs/my-consumer-spec.md \
    --layout flat

# Viết spec thật tại docs/my-consumer-spec.md
code docs/my-consumer-spec.md

git add .
git commit -m "infra: bootstrap mega-template"
```

Mở Claude Code tại thư mục root, gõ:
```
start my-consumer phase-1
```

Skill `consumer-feature` tự trigger, Gate 1 chạy.

### 2. Agent bị drift off-topic

User trong session gõ:
```
how do i configure printer spooler driver on windows 11 machines
```

load-context hook inject `<off-topic-warning>` → agent phản hồi:
> "Prompt này không chia sẻ từ khóa với phase-1 sections (architecture, data, model). Bạn muốn:
> - Pause phase hiện tại?
> - Thêm vào backlog phase-N+1?
> - Pivot chính thức qua `/ralplan` (revise workflow.json)?"

Agent kéo user về flow chính thay vì lạc theo.

### 3. Agent cố commit nhảy slice

Agent (đã code xong slice-02 WS client) cố commit:
```
git commit -m "v5-phase-1.slice-03: jump ahead"
```

Hook `enforce-slice-order` block exit 2:
```
[mega:enforce-slice-order] BLOCKED: slice-id mismatch (V5-R060 — no mid-phase pivot).
  Commit claims slice-3, workflow expects slice-2.
  Active phase: phase-1
  Expected next: 02 — WS client + event router
  Complete the pending slice first, or revise the plan via /ralplan.
```

Agent đổi về `v5-phase-1.slice-02: implement WS client` → commit pass.

### 4. Agent cố promote phase thiếu review

```
git commit -m "phase-promote: phase-1 verified -> phase-2 active"
```

Hook `check-review-evidence` block:
```
[mega:check-review-evidence] BLOCKED: phase-promote requires independent reviews (V5-R055, V5-R056).
  Active phase: phase-1
  Missing:
    - .omc/reviews/phase-1-reviewer.md
    - .omc/reviews/phase-1-verifier.md
    - .omc/reviews/phase-1-critic.md
  Fix: run /phase-review to generate artifacts, or address reviewer findings.
```

User gõ `/phase-review` → 3 agent spawn song song → tạo 3 artifact với verdict.
Rồi mới `/phase-promote` pass được.

### 5. Resume session mới

User mở Claude Code trong consumer repo đã có `workflow.json` phase-1
đang làm slice-03. Gõ bất kỳ prompt nào, load-context inject:

```xml
<active-flow>
Phase: phase-1 — slice 2/7
Current: slice-03 Extraction pipeline
Last done: slice-02 (commit 8ab44a2)
Next: slice-04 — Injection pipeline
Resume hint: reply "continue" or "/autopilot resume" to proceed.
</active-flow>
```

Agent biết ngay context, user gõ `continue` → agent resume slice-03 không cần nói lại gì.

### 6. Emergency bypass

Có bug pre-commit khẩn, không chờ CI được:

```bash
CLAUDE_SKIP_HOOKS=1 git commit -m "v5-phase-1.slice-02: emergency fix

Bypass reason: CI xuống, patch hotfix để giữ service up.
Follow-up: issue #42 sẽ restore proper test coverage.
"
```

Mọi bypass **phải** document lý do trong commit body + link follow-up issue. Git log audit được.

---

## Ghi chú Windows/PowerShell

### PowerShell 5 không hỗ trợ `&&`

Dùng `;` để chain hoặc chạy từng lệnh:
```powershell
npm install @agentic-gateway/mega-template ; npx mega-template-init
```

### Node 20+ yêu cầu

Hook dùng ES modules + `node:fs/promises`. Kiểm tra:
```powershell
node --version   # >= 20.0.0
```

### Absolute path

Từ v0.8.1, hook command trong `.claude/settings.json` dùng absolute path.
Hoạt động dù Claude Code CWD là monorepo root hay subpackage. Không cần
mở session từ đúng folder root.

### Line endings

Hook tự handle CRLF normalization. Không cần action.

---

## Bypass khẩn cấp

```bash
CLAUDE_SKIP_HOOKS=1 <command>
```

Disable **toàn bộ hook**. Dùng cho:
- Emergency hotfix
- Rescue workflow khi config corrupt
- Migration giữa version mega-template

Bypass **phải** document trong commit body:
```
Bypass reason: <lý do cụ thể>
Follow-up: <link issue restore proper flow>
```

Alternative chỉ disable 1 hook cụ thể:
- `verification.strictness: relaxed` — tắt enforce-verification
- `review.enabled: false` — tắt check-review-evidence + phase-review gate
- `decisions.enabled: false` — tắt inject-decision-rules

---

## Chạy 2 phase song song

`spec-index.yaml` chỉ có 1 `active_phase`. Muốn làm phase-2a infra +
phase-2b feature spike đồng thời → dùng **git worktree**:

```bash
# Main checkout: đang làm phase-2a
cd <consumer-repo>

# Tạo worktree thứ 2 cho phase-2b spike
git worktree add ../<consumer-repo>-phase-2b phase-2b-branch

# Worktree mới: flip active_phase
cd ../<consumer-repo>-phase-2b
# edit spec-index.yaml → active_phase: phase-2b

# Mở Claude Code session thứ 2 tại worktree này
```

Mỗi Claude Code session chỉ thấy worktree của nó → enforcement fully scoped.
Spike xong merge branch + `git worktree remove`.

---

## License

MIT

## Support

- GitHub: https://github.com/vunh2301/agentic-gateway-mega-template
- Issues: https://github.com/vunh2301/agentic-gateway-mega-template/issues
- npm: https://www.npmjs.com/package/@agentic-gateway/mega-template
