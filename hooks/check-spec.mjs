#!/usr/bin/env node
/**
 * PreToolUse hook: block Write/Edit on packages/*\/src/** without matching spec.
 *
 * Rule IDs enforced: V5-R004 (spec-first), V5-R006 (no ad-hoc code)
 *
 * Logic:
 *   1. Check file path is under packages/<name>/src/**
 *   2. Search for spec file: docs/<name>*.md OR docs/*<name>*.md OR docs/plans/<name>*.md
 *   3. Exit 2 (deny) if missing, 0 (allow) otherwise
 *
 * Exceptions: docs/**, .claude/**, *.md at root, tests, configs.
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1
 */

import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isExempt(p)) process.exit(0);

  const m = p.match(/\/packages\/([^/]+)\/src\//);
  if (!m) process.exit(0);

  const pkgName = m[1];
  const repoRoot = findRepoRoot(dirname(filePath)) || process.cwd();
  const docsDir = join(repoRoot, "docs");
  const plansDir = join(docsDir, "plans");
  const specsDir = join(docsDir, "specs");

  const hasSpec =
    hasMatchingFile(docsDir, pkgName) ||
    hasMatchingFile(plansDir, pkgName) ||
    hasMatchingFile(specsDir, pkgName);

  if (!hasSpec) {
    console.error(
      `[mega:check-spec] BLOCKED: no spec for package "${pkgName}" (rule V5-R004).\n` +
      `  Looked in: ${docsDir}\n` +
      `  Expected: docs/${pkgName}*.md OR docs/plans/${pkgName}*.md OR docs/specs/${pkgName}*.md\n` +
      `  Fix: invoke superpowers:brainstorming to generate spec first.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit message).`
    );
    process.exit(2);
  }

  process.exit(0);
}

function isExempt(p) {
  const rules = [
    /\/docs\//,
    /\/\.claude\//,
    /^[^/]*\.md$/i,
    /\/(tests?|__tests__)\//,
    /\.(test|spec)\.(ts|js|mjs|cjs)$/,
    /\/package(-lock)?\.json$/,
    /\/tsconfig[^/]*\.json$/,
    /\/\.gitignore$/,
    /\/(README|PROGRESS|CLAUDE|AGENTS|CHANGELOG|LICENSE)\.md$/i,
  ];
  return rules.some((r) => r.test(p));
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

function hasMatchingFile(dir, pkgName) {
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const lowerPkg = pkgName.toLowerCase();
    return entries.some(
      (e) => e.isFile() && e.name.toLowerCase().endsWith(".md") &&
             e.name.toLowerCase().includes(lowerPkg)
    );
  } catch {
    return false;
  }
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:check-spec] hook crash: ${e.message}`);
  process.exit(0); // R-PLUGIN-001 fail-open
});
