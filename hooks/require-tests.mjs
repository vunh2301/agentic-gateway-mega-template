#!/usr/bin/env node
/**
 * PostToolUse hook for Bash `git commit`: warn if new src files lack tests
 * and run npm test.
 *
 * Rule IDs: V5-R006 (test per src), V5-R007 (honest test classification)
 *
 * Non-blocking (post-commit). Agent sees warnings and should fix up.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";

  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
  if (/--amend/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const changed = getChangedFiles(repoRoot);
  const srcFiles = changed.filter(
    (f) =>
      /packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js|cjs)$/.test(f) &&
      !/\.(test|spec|d)\.(ts|mjs|js|cjs)$/.test(f)
  );

  const missing = srcFiles.filter((f) => !hasMatchingTest(repoRoot, f));

  if (missing.length > 0) {
    console.error(
      `[mega:require-tests] WARNING: commit created without matching tests for (V5-R006):\n` +
      missing.map((f) => `  - ${f}`).join("\n") +
      `\n  Expected test: packages/<pkg>/tests/** OR __tests__/** OR foo.test.ts alongside.\n` +
      `  Action: add tests + amend commit, or document skip reason in commit body.`
    );
  }

  // Run tests (non-blocking)
  try {
    execSync(`npm test --workspaces --if-present --silent 2>&1`, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 45000,
    });
    console.error(`[mega:require-tests] tests PASS after commit.`);
  } catch (e) {
    const out = (e.stdout || e.message || "").toString().slice(0, 2000);
    console.error(
      `[mega:require-tests] WARNING: tests FAIL after commit. Do not push.\n${out}`
    );
  }

  process.exit(0);
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

function getChangedFiles(repoRoot) {
  try {
    // `-r HEAD` fails on initial commit (no parent). `--root` makes it list
    // all files of the root commit instead.
    return execSync("git diff-tree --no-commit-id --name-only -r --root HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasMatchingTest(repoRoot, srcPath) {
  const m = srcPath.match(/^packages\/([^/]+)\/src\/(.+)\.(ts|tsx|mjs|js|cjs)$/);
  if (!m) return false;
  const [, pkg, relNoExt, ext] = m;
  const base = basename(relNoExt);

  const candidates = [
    `packages/${pkg}/tests/${relNoExt}.test.${ext}`,
    `packages/${pkg}/tests/${relNoExt}.spec.${ext}`,
    `packages/${pkg}/tests/${base}.test.${ext}`,
    `packages/${pkg}/tests/${base}.spec.${ext}`,
    `packages/${pkg}/__tests__/${relNoExt}.test.${ext}`,
    `packages/${pkg}/__tests__/${base}.test.${ext}`,
    `packages/${pkg}/src/${relNoExt}.test.${ext}`,
    `packages/${pkg}/src/${relNoExt}.spec.${ext}`,
  ];
  return candidates.some((c) => existsSync(join(repoRoot, c)));
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:require-tests] hook crash: ${e.message}`);
  process.exit(0);
});
