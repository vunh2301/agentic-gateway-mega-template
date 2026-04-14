#!/usr/bin/env node
/**
 * PostToolUse hook (Bash `git commit`): detect mock patterns in E2E test files.
 *
 * Rule IDs: V5-R040 (no mock in E2E), V5-R043 (line-level exception),
 *           V5-R044 (block-level exception)
 *
 * Algorithm:
 *   1. Trigger only on `git commit` (not amend, not log)
 *   2. Get staged files via `git diff --cached --name-only`
 *   3. Filter for E2E patterns from spec-index.yaml `e2e:` block
 *   4. Scan content for blocked mock patterns (regex)
 *   5. Honor exception annotations:
 *      Line-level:  `// e2e-mock-ok` on same line as mock
 *      Block-level: `// e2e-mock-ok-start` ... `// e2e-mock-ok-end`
 *      File-level:  `// e2e-real-verified` in first 10 lines (with justification)
 *
 * Fix vs spec proposal: added block-level annotation (avoid noisy per-line
 * annotation for legitimate test doubles like clock mocking).
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_BLOCKED_PATTERNS = [
  { name: "jest.mock", re: /jest\.mock\s*\(/ },
  { name: "vi.mock", re: /vi\.mock\s*\(/ },
  { name: "sinon stub/mock/fake/spy", re: /sinon\.(stub|mock|fake|spy)\s*\(/ },
  { name: "nock", re: /\bnock\s*\(/ },
  { name: ".mockImplementation", re: /\.mockImplementation\s*\(/ },
  { name: ".mockResolvedValue", re: /\.mockResolvedValue\s*\(/ },
  { name: ".mockReturnValue", re: /\.mockReturnValue\s*\(/ },
  { name: "fetch reassign mock", re: /\b(fetch|axios)\s*=\s*(jest|vi)\.fn/ },
  { name: "nock .reply", re: /\.reply\s*\(\s*\d{3}/ },
  { name: "createMock factory", re: /createMock[A-Z]/ },
];

const FILE_LEVEL_EXEMPTION = /\/\/\s*e2e-real-verified\b/;
const LINE_LEVEL_EXEMPTION = /\/\/\s*e2e-mock-ok\b/;
const BLOCK_START = /\/\/\s*e2e-mock-ok-start\b/;
const BLOCK_END = /\/\/\s*e2e-mock-ok-end\b/;

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";
  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
  if (/--amend/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const config = readE2eConfig(repoRoot);
  if (!config.enabled) process.exit(0);

  const staged = getStagedFiles(repoRoot);
  const e2eFiles = staged.filter((f) =>
    config.test_patterns.some((g) => matchGlob(f, g)),
  );
  if (e2eFiles.length === 0) process.exit(0);

  const violations = [];
  const allPatterns = [
    ...DEFAULT_BLOCKED_PATTERNS,
    ...(config.extra_blocked_patterns || []).map((s) => ({ name: s, re: new RegExp(s) })),
  ];

  for (const file of e2eFiles) {
    const fullPath = join(repoRoot, file);
    if (!existsSync(fullPath)) continue;
    let content;
    try { content = readFileSync(fullPath, "utf8"); } catch { continue; }

    // File-level exemption (in first 10 lines)
    const head = content.split(/\r?\n/).slice(0, 10).join("\n");
    if (FILE_LEVEL_EXEMPTION.test(head)) continue;

    const lines = content.split(/\r?\n/);
    let inExemptBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (BLOCK_START.test(line)) { inExemptBlock = true; continue; }
      if (BLOCK_END.test(line)) { inExemptBlock = false; continue; }
      if (inExemptBlock) continue;
      if (LINE_LEVEL_EXEMPTION.test(line)) continue;

      for (const p of allPatterns) {
        if (p.re.test(line)) {
          violations.push({ file, line: i + 1, pattern: p.name, code: line.trim() });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[mega:check-e2e-real] BLOCKED: mock patterns in E2E tests (V5-R040).\n` +
      violations.map((v) =>
        `  ${v.file}:${v.line}  [${v.pattern}]\n    ${v.code}`,
      ).join("\n") +
      `\n\n  E2E tests must hit real infrastructure. Options:\n` +
      `    1. Remove the mock — use real Gateway/DB/API.\n` +
      `    2. If mock IS legitimate (e.g., clock mock), annotate:\n` +
      `       // e2e-mock-ok                       (single line)\n` +
      `       // e2e-mock-ok-start ... e2e-mock-ok-end (block)\n` +
      `       // e2e-real-verified                 (file header, with justification)\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1.`
    );
    process.exit(2);
  }

  process.exit(0);
}

function readE2eConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  const defaults = {
    enabled: true,
    test_patterns: ["**/*.e2e.test.*", "**/e2e/**/*.test.*", "**/e2e/**/*.spec.*"],
    extra_blocked_patterns: [],
  };
  if (!existsSync(yamlPath)) return defaults;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const m = yaml.match(/^e2e:\s*\n((?:\s+.*\n?)+)/m);
    if (!m) return defaults;
    const block = m[1];
    const enabled = !/^\s+enabled:\s*false/m.test(block);
    const patternsM = block.match(/test_patterns:\s*\n((?:\s+-\s+.+\n?)+)/);
    const extraM = block.match(/extra_blocked_patterns:\s*\n((?:\s+-\s+.+\n?)+)/);
    return {
      enabled,
      test_patterns: patternsM
        ? patternsM[1].split("\n").filter(Boolean).map((l) =>
            l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
        : defaults.test_patterns,
      extra_blocked_patterns: extraM
        ? extraM[1].split("\n").filter(Boolean).map((l) =>
            l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
        : [],
    };
  } catch {
    return defaults;
  }
}

function getStagedFiles(repoRoot) {
  try {
    return execSync("git diff --cached --name-only", {
      cwd: repoRoot, encoding: "utf8", timeout: 3000,
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function matchGlob(path, pattern) {
  // Standard glob semantics:
  //   **/foo  matches both `foo` and `a/b/foo`
  //   foo/**  matches both `foo` and `foo/a/b`
  //   **      matches anything (incl empty)
  // Normalize by collapsing `**/` and `/**` to optional path segments.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*\//g, "§DSS§")  // **/  → optional dir prefix
    .replace(/\/\*\*/g, "§SDS§")  // /**  → optional dir suffix
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/§DSS§/g, "(?:.*/)?")
    .replace(/§SDS§/g, "(?:/.*)?");
  return new RegExp("^" + regex + "$").test(path);
}

async function readStdinJson() {
  // Hard-kill guard: if the whole hook hasn't finished in 3s, force-exit 0
  // so harness never sees a stuck child process. Covers Windows/IDE cases
  // where stdin is never closed.
  setTimeout(() => process.exit(0), 3000).unref();
  // Soft-timeout on the read itself: destroy stdin after 1.5s so the
  // iteration resolves and main() can continue to exit cleanly.
  const t = setTimeout(() => { try { process.stdin.destroy(); } catch {} }, 1500);
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    clearTimeout(t);
    try { return JSON.parse(raw); } catch { return null; }
  } catch {
    clearTimeout(t);
    return null;
  }
}

main().catch((e) => {
  console.error(`[mega:check-e2e-real] hook crash: ${e.message}`);
  process.exit(0);
});
