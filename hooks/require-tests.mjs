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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";

  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
  if (/--amend/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const layout = readLayout(repoRoot);
  const srcRegex = layout === "flat"
    ? /^src\/.+\.(ts|tsx|mjs|js|cjs)$/
    : /packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js|cjs)$/;

  const changed = getChangedFiles(repoRoot);
  const srcFiles = changed.filter(
    (f) =>
      srcRegex.test(f) &&
      !/\.(test|spec|d)\.(ts|mjs|js|cjs)$/.test(f)
  );

  const missing = srcFiles.filter((f) => !hasMatchingTest(repoRoot, f, layout));

  if (missing.length > 0) {
    const expectedHint = layout === "flat"
      ? "tests/**/foo.test.ts OR __tests__/foo.test.ts OR src/foo.test.ts alongside"
      : "packages/<pkg>/tests/** OR __tests__/** OR foo.test.ts alongside";
    console.error(
      `[mega:require-tests] WARNING: commit created without matching tests for (V5-R006):\n` +
      missing.map((f) => `  - ${f}`).join("\n") +
      `\n  Expected test: ${expectedHint}.\n` +
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

function hasMatchingTest(repoRoot, srcPath, layout) {
  let candidates = [];

  if (layout === "flat") {
    const m = srcPath.match(/^src\/(.+)\.(ts|tsx|mjs|js|cjs)$/);
    if (!m) return false;
    const [, relNoExt, ext] = m;
    const base = basename(relNoExt);
    candidates = [
      `tests/${relNoExt}.test.${ext}`,
      `tests/${relNoExt}.spec.${ext}`,
      `tests/${base}.test.${ext}`,
      `tests/${base}.spec.${ext}`,
      `__tests__/${relNoExt}.test.${ext}`,
      `__tests__/${base}.test.${ext}`,
      `src/${relNoExt}.test.${ext}`,
      `src/${relNoExt}.spec.${ext}`,
    ];
  } else {
    const m = srcPath.match(/^packages\/([^/]+)\/src\/(.+)\.(ts|tsx|mjs|js|cjs)$/);
    if (!m) return false;
    const [, pkg, relNoExt, ext] = m;
    const base = basename(relNoExt);
    candidates = [
      `packages/${pkg}/tests/${relNoExt}.test.${ext}`,
      `packages/${pkg}/tests/${relNoExt}.spec.${ext}`,
      `packages/${pkg}/tests/${base}.test.${ext}`,
      `packages/${pkg}/tests/${base}.spec.${ext}`,
      `packages/${pkg}/__tests__/${relNoExt}.test.${ext}`,
      `packages/${pkg}/__tests__/${base}.test.${ext}`,
      `packages/${pkg}/src/${relNoExt}.test.${ext}`,
      `packages/${pkg}/src/${relNoExt}.spec.${ext}`,
    ];
  }
  return candidates.some((c) => existsSync(join(repoRoot, c)));
}

function readLayout(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) return "monorepo";
  try {
    const m = readFileSync(yamlPath, "utf8").match(/^layout:\s*(flat|monorepo)/m);
    return m ? m[1] : "monorepo";
  } catch {
    return "monorepo";
  }
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
  console.error(`[mega:require-tests] hook crash: ${e.message}`);
  process.exit(0);
});
