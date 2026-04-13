#!/usr/bin/env node
/**
 * PostToolUse hook (Bash `git commit`): require test evidence for src commits.
 *
 * Rule IDs: V5-R050 (evidence required), V5-R053 (commit prefix exclude),
 *           V5-R054 (session-mode fallback)
 *
 * Strictness levels (configurable, DEFAULT = "session"):
 *   strict   — must stage evidence artifact
 *   session  — accept recent test command in this session OR staged artifact
 *   relaxed  — warn only, never block
 *
 * Fix vs spec proposal: default = "session" (not strict). Strict mode bloat
 * git history with JSON reports + creates friction for small fixes.
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_EVIDENCE_PATTERNS = [
  "test-results/**/*.json",
  "test-results/**/*.xml",
  "coverage/**",
  "e2e/results/**",
  ".verification/**",
];

const DEFAULT_EXCLUDE_PREFIXES = [
  "docs:", "chore:", "infra:", "ci:", "build:",
];

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";
  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
  if (/--amend/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const config = readVerificationConfig(repoRoot);
  if (!config.enabled) process.exit(0);
  if (config.strictness === "relaxed") process.exit(0);

  // Check commit message for excluded prefixes (best-effort)
  const msgFromCmd = extractCommitMessage(cmd);
  if (msgFromCmd && config.exclude_prefixes.some((pre) => msgFromCmd.startsWith(pre))) {
    process.exit(0);
  }

  // Did this commit touch src files?
  const tddConfig = readTddPatterns(repoRoot);
  const staged = getStagedFiles(repoRoot);
  const srcFiles = staged.filter((f) =>
    tddConfig.src_patterns.some((g) => matchGlob(f, g)) &&
    !/\.(test|spec|d)\.(ts|tsx|mjs|js|cjs)$/.test(f)
  );
  if (srcFiles.length === 0) process.exit(0);

  // Evidence in staged files?
  const hasStagedEvidence = staged.some((f) =>
    config.evidence_patterns.some((g) => matchGlob(f, g)),
  );
  if (hasStagedEvidence) {
    process.exit(0);
  }

  // Strict: must have staged evidence
  if (config.strictness === "strict") {
    console.error(
      `[mega:enforce-verification] BLOCKED: no test evidence staged (V5-R050, strict).\n` +
      `  Staged src files:\n` +
      srcFiles.map((f) => `    - ${f}`).join("\n") +
      `\n  Fix: stage test output, e.g.:\n` +
      `    npx vitest run --reporter=json --outputFile=test-results/latest.json\n` +
      `    git add test-results/latest.json\n` +
      `  Or set verification.strictness: session (accept session test runs).\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1.`
    );
    process.exit(2);
  }

  // Session: accept recent test artifact (mtime within 30 min) OR staged evidence
  if (config.strictness === "session") {
    const recent = findRecentEvidenceArtifact(repoRoot, config.evidence_patterns, 30 * 60 * 1000);
    if (recent) {
      console.error(
        `[mega:enforce-verification] NOTE: accepting recent test artifact ${recent} ` +
        `(session mode). Stage with commit for auditable trail.`,
      );
      process.exit(0);
    }
    console.error(
      `[mega:enforce-verification] BLOCKED: no test evidence (V5-R050, session).\n` +
      `  Staged src files:\n` +
      srcFiles.map((f) => `    - ${f}`).join("\n") +
      `\n  No evidence file modified in last 30 min, none staged.\n` +
      `  Fix: run tests in this session, e.g.:\n` +
      `    npx vitest run --reporter=json --outputFile=test-results/latest.json\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1.`
    );
    process.exit(2);
  }

  process.exit(0);
}

function readVerificationConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  const defaults = {
    enabled: true,
    strictness: "session", // FIX vs spec: session not strict
    evidence_patterns: DEFAULT_EVIDENCE_PATTERNS,
    exclude_prefixes: DEFAULT_EXCLUDE_PREFIXES,
  };
  if (!existsSync(yamlPath)) return defaults;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const m = yaml.match(/^verification:\s*\n((?:\s+.*\n?)+)/m);
    if (!m) return defaults;
    const block = m[1];
    const strictM = block.match(/strictness:\s*"?(strict|session|relaxed)"?/);
    const enabled = !/^\s+enabled:\s*false/m.test(block);
    const evidenceM = block.match(/evidence_patterns:\s*\n((?:\s+-\s+.+\n?)+)/);
    const excludeM = block.match(/exclude_(commits|prefixes):\s*\n((?:\s+-\s+.+\n?)+)/);
    return {
      enabled,
      strictness: strictM ? strictM[1] : defaults.strictness,
      evidence_patterns: evidenceM
        ? evidenceM[1].split("\n").filter(Boolean).map((l) =>
            l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
        : defaults.evidence_patterns,
      exclude_prefixes: excludeM
        ? excludeM[2].split("\n").filter(Boolean).map((l) =>
            l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "").replace(/\*+$/, ""))
        : defaults.exclude_prefixes,
    };
  } catch {
    return defaults;
  }
}

function readTddPatterns(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  const defaults = { src_patterns: ["packages/*/src/**", "src/**"] };
  if (!existsSync(yamlPath)) return defaults;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const m = yaml.match(/^tdd:\s*\n((?:\s+.*\n?)+)/m);
    if (!m) return defaults;
    const patternsM = m[1].match(/src_patterns:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (!patternsM) return defaults;
    return {
      src_patterns: patternsM[1].split("\n").filter(Boolean).map((l) =>
        l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "")),
    };
  } catch {
    return defaults;
  }
}

function extractCommitMessage(cmd) {
  // Try -m "msg" or -m 'msg' patterns
  const m = cmd.match(/-m\s+(["'])([^"']+)\1/);
  if (m) return m[2].trim();
  return null;
}

function findRecentEvidenceArtifact(repoRoot, patterns, maxAgeMs) {
  const now = Date.now();
  // Check known evidence directories
  const checkDirs = ["test-results", "coverage", "e2e/results", ".verification"];
  for (const dir of checkDirs) {
    const full = join(repoRoot, dir);
    if (!existsSync(full)) continue;
    try {
      const newest = findNewestFile(full);
      if (newest && now - newest.mtime < maxAgeMs) return newest.path;
    } catch {}
  }
  return null;
}

function findNewestFile(dir, depth = 0) {
  if (depth > 5) return null;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    let best = null;
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const sub = findNewestFile(full, depth + 1);
        if (sub && (!best || sub.mtime > best.mtime)) best = sub;
      } else if (e.isFile()) {
        const s = statSync(full);
        if (!best || s.mtimeMs > best.mtime) best = { path: full, mtime: s.mtimeMs };
      }
    }
    return best;
  } catch {
    return null;
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
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*\//g, "§DSS§")
    .replace(/\/\*\*/g, "§SDS§")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/§DSS§/g, "(?:.*/)?")
    .replace(/§SDS§/g, "(?:/.*)?");
  return new RegExp("^" + regex + "$").test(path);
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:enforce-verification] hook crash: ${e.message}`);
  process.exit(0);
});
