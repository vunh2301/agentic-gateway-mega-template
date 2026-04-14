#!/usr/bin/env node
/**
 * PreToolUse hook (Write|Edit): enforce test-before-code at harness level.
 *
 * Rule IDs: V5-R030 (test required), V5-R031 (test before src), V5-R032 (stale)
 *
 * Algorithm:
 *   1. Match target file against src patterns from spec-index.yaml `tdd:` block
 *   2. Derive expected test path via configured conventions
 *   3. Block if test file does NOT exist
 *   4. Use git history (NOT mtime) to detect TDD discipline:
 *      - test committed in earlier or same commit as src → PASS
 *      - src committed alone (no test) → block
 *
 * Fix vs spec proposal: mtime check rejected (Windows 1s resolution + git
 * checkout resets mtime → false positives). Git log is deterministic.
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1
 * Fallback: fail-open on any uncaught error (R-PLUGIN-001)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isGenericExempt(p)) process.exit(0);

  const repoRoot = findRepoRoot(dirname(filePath)) || process.cwd();
  const config = readTddConfig(repoRoot);
  if (!config.enabled) process.exit(0);

  const relPath = relativize(p, repoRoot);

  // 1. Match excludes first
  if (config.exclude.some((g) => matchGlob(relPath, g))) process.exit(0);

  // 2. Match src patterns
  const isSrc = config.src_patterns.some((g) => matchGlob(relPath, g));
  if (!isSrc) process.exit(0);

  // 3. Don't enforce on test files themselves
  if (/\.(test|spec)\.(ts|tsx|mjs|js|cjs)$/.test(relPath)) process.exit(0);

  // 4. Derive candidate test paths
  const candidates = deriveTestPaths(relPath, config.test_conventions);
  if (candidates.length === 0) {
    // No convention matched — can't enforce
    process.exit(0);
  }

  const existingTest = candidates.find((c) => existsSync(join(repoRoot, c)));

  if (!existingTest) {
    console.error(
      `[mega:enforce-tdd] BLOCKED: TDD gate (V5-R030).\n` +
      `  Source: ${relPath}\n` +
      `  Expected test file (one of):\n` +
      candidates.map((c) => `    - ${c}`).join("\n") +
      `\n  Fix: write the failing test FIRST, then implement.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit).`
    );
    process.exit(2);
  }

  // 5. Git history check — test must be committed before or with src
  const history = checkGitHistory(repoRoot, relPath, existingTest);
  if (history.violation) {
    console.error(
      `[mega:enforce-tdd] BLOCKED: TDD discipline violation (V5-R031).\n` +
      `  Source: ${relPath}\n` +
      `  Test:   ${existingTest}\n` +
      `  ${history.reason}\n` +
      `  Fix: ensure test is committed before or with src changes.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1.`
    );
    process.exit(2);
  }

  if (history.warn) {
    console.error(`[mega:enforce-tdd] NOTE: ${history.reason}`);
  }
  process.exit(0);
}

function readTddConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  const defaults = {
    enabled: true,
    src_patterns: ["packages/*/src/**", "src/**"],
    test_conventions: [
      { pattern: "^src/(.*)\\.ts$", test: "tests/$1.test.ts" },
      { pattern: "^src/(.*)\\.ts$", test: "test/$1.test.ts" },
      { pattern: "^src/(.*)\\.ts$", test: "src/$1.test.ts" },
      { pattern: "^packages/([^/]+)/src/(.*)\\.ts$", test: "packages/$1/tests/$2.test.ts" },
      { pattern: "^packages/([^/]+)/src/(.*)\\.ts$", test: "packages/$1/test/$2.test.ts" },
    ],
    exclude: ["**/*.d.ts", "**/index.ts", "**/__generated__/**", "**/types.ts"],
  };
  if (!existsSync(yamlPath)) return defaults;

  // Lightweight YAML extraction — only `tdd:` block
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const block = extractYamlBlock(yaml, "tdd");
    if (!block) return defaults;
    return {
      enabled: block.enabled !== false,
      src_patterns: block.src_patterns || defaults.src_patterns,
      test_conventions: block.test_conventions || defaults.test_conventions,
      exclude: block.exclude || defaults.exclude,
    };
  } catch {
    return defaults;
  }
}

function deriveTestPaths(relPath, conventions) {
  const paths = [];
  for (const c of conventions) {
    try {
      const re = new RegExp(c.pattern);
      const m = relPath.match(re);
      if (!m) continue;
      let testPath = c.test;
      for (let i = 1; i < m.length; i++) {
        testPath = testPath.replace(new RegExp(`\\$${i}`, "g"), m[i]);
      }
      if (!paths.includes(testPath)) paths.push(testPath);
    } catch {}
  }
  return paths;
}

function checkGitHistory(repoRoot, srcRel, testRel) {
  try {
    // Was src ever committed?
    const srcLog = execSync(
      `git log --format=%H --diff-filter=A -- "${srcRel}"`,
      { cwd: repoRoot, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const testLog = execSync(
      `git log --format=%H --diff-filter=A -- "${testRel}"`,
      { cwd: repoRoot, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    // Both new (untracked) → fine, just check disk presence (already done)
    if (!srcLog && !testLog) return { violation: false };

    // Test never committed but src has history → violation
    if (srcLog && !testLog) {
      return {
        violation: true,
        reason: "Source committed previously but test was never committed.",
      };
    }

    // Both committed — get earliest commits, compare timestamps
    const srcFirst = execSync(
      `git log --format=%ct --diff-filter=A --reverse -- "${srcRel}"`,
      { cwd: repoRoot, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).split("\n")[0]?.trim();
    const testFirst = execSync(
      `git log --format=%ct --diff-filter=A --reverse -- "${testRel}"`,
      { cwd: repoRoot, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).split("\n")[0]?.trim();

    if (srcFirst && testFirst && parseInt(srcFirst) < parseInt(testFirst)) {
      return {
        warn: true,
        reason: "Test added in commit AFTER source — TDD discipline questionable.",
      };
    }

    return { violation: false };
  } catch {
    // Git not available or other error — degrade gracefully
    return { violation: false };
  }
}

function isGenericExempt(p) {
  return /\/(\.claude|docs|\.git|node_modules)\//.test(p) ||
    /^[^/]*\.(md|json|yaml|yml)$/i.test(p) ||
    /\.(test|spec)\.(ts|tsx|mjs|js|cjs)$/.test(p) ||
    /\/(README|PROGRESS|CLAUDE|AGENTS|CHANGELOG|LICENSE)\.md$/i.test(p);
}

function relativize(p, root) {
  const rootN = root.replace(/\\/g, "/");
  return p.startsWith(rootN) ? p.slice(rootN.length + 1) : p;
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

function extractYamlBlock(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !new RegExp(`^${key}:\\s*$`).test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  const block = {};
  let currentArrayKey = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) { i++; continue; }
    if (/^\S/.test(line)) break; // out of block
    const trimmed = line.replace(/#.*$/, "").trimEnd();
    if (!trimmed.trim()) { i++; continue; }

    const arrayMatch = trimmed.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentArrayKey) {
      const val = arrayMatch[1].trim();
      // Object item with `pattern: x` `test: y` style — peek next lines
      const patM = val.match(/^pattern:\s*["']?(.+?)["']?$/);
      if (patM) {
        const obj = { pattern: patM[1] };
        // Look ahead for `test:` (must be more deeply indented)
        if (i + 1 < lines.length) {
          const nm = lines[i + 1].match(/^\s+test:\s*["']?(.+?)["']?$/);
          if (nm) { obj.test = nm[1]; i++; }
        }
        block[currentArrayKey].push(obj);
      } else {
        block[currentArrayKey].push(stripQuotes(val));
      }
      i++;
      continue;
    }

    const kvMatch = trimmed.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (kvMatch) {
      const k = kvMatch[1];
      const v = kvMatch[2].trim();
      if (v === "") {
        block[k] = [];
        currentArrayKey = k;
      } else if (v === "true" || v === "false") {
        block[k] = v === "true";
        currentArrayKey = null;
      } else if (v.startsWith("[") && v.endsWith("]")) {
        // Inline array: [a, b, "c"]
        block[k] = v.slice(1, -1).split(",")
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean);
        currentArrayKey = null;
      } else {
        block[k] = stripQuotes(v);
        currentArrayKey = null;
      }
    }
    i++;
  }
  return block;
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
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

async function readStdinJson() {
  // Timeout guard: if stdin does not close within 1500ms, abort read.
  // Prevents infinite hang when harness does not signal EOF (Windows/IDE edge case).
  const readPromise = (async () => {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    try { return JSON.parse(raw); } catch { return null; }
  })();
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
  return Promise.race([readPromise, timeoutPromise]);
}

main().catch((e) => {
  console.error(`[mega:enforce-tdd] hook crash: ${e.message}`);
  process.exit(0);
});
