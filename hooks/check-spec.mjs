#!/usr/bin/env node
/**
 * PreToolUse hook: block Write/Edit on src files without matching spec.
 *
 * Rule IDs enforced: V5-R004 (spec-first), V5-R006 (no ad-hoc code)
 *
 * Supports two layouts (via spec-index.yaml `layout:` field):
 *   monorepo (default): packages/<pkg>/src/** — spec per package
 *   flat:               src/** — single repo-wide spec declared in
 *                       spec-index.yaml `spec:` field
 *
 * Exceptions: docs/**, .claude/**, *.md at root, tests, configs.
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isExempt(p)) process.exit(0);

  const repoRoot = findRepoRoot(dirname(filePath)) || process.cwd();
  const { layout, specPath } = readLayoutConfig(repoRoot);

  if (layout === "flat") {
    // Match src/**.ts at repo root
    if (!/(?:^|\/)src\/.+\.(ts|tsx|mjs|js|cjs)$/.test(p)) process.exit(0);

    // Require spec-index.yaml `spec:` field points to an existing doc
    if (!specPath) {
      console.error(
        `[mega:check-spec] BLOCKED: flat layout requires spec-index.yaml with 'spec:' field (V5-R004).\n` +
        `  Fix: add 'spec: docs/<name>-spec.md' to spec-index.yaml.\n` +
        `  Bypass: CLAUDE_SKIP_HOOKS=1.`
      );
      process.exit(2);
    }
    const fullSpec = join(repoRoot, specPath);
    if (!existsSync(fullSpec)) {
      console.error(
        `[mega:check-spec] BLOCKED: spec file not found at ${specPath} (V5-R004).\n` +
        `  File being written: ${p}\n` +
        `  Fix: create ${specPath} or update spec-index.yaml 'spec:' field.\n` +
        `  Bypass: CLAUDE_SKIP_HOOKS=1.`
      );
      process.exit(2);
    }
    process.exit(0);
  }

  // Default: monorepo layout
  const m = p.match(/\/packages\/([^/]+)\/src\//);
  if (!m) process.exit(0);

  const pkgName = m[1];
  const docsDir = join(repoRoot, "docs");
  const plansDir = join(docsDir, "plans");
  const specsDir = join(docsDir, "specs");

  const hasSpec =
    hasMatchingFile(docsDir, pkgName) ||
    hasMatchingFile(plansDir, pkgName) ||
    hasMatchingFile(specsDir, pkgName);

  if (!hasSpec) {
    console.error(
      `[mega:check-spec] BLOCKED: no spec for package "${pkgName}" (V5-R004).\n` +
      `  Looked in: ${docsDir}\n` +
      `  Expected: docs/${pkgName}*.md OR docs/plans/${pkgName}*.md OR docs/specs/${pkgName}*.md\n` +
      `  Fix: invoke /oh-my-claudecode:deep-interview to generate spec first.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit message).`
    );
    process.exit(2);
  }

  process.exit(0);
}

/**
 * Read layout + spec path from spec-index.yaml. Defaults to monorepo for
 * backward compat when file missing or field absent. No deps (R-PLUGIN-002).
 */
function readLayoutConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) return { layout: "monorepo", specPath: null };
  try {
    const content = readFileSync(yamlPath, "utf8");
    const layoutM = content.match(/^layout:\s*(flat|monorepo)/m);
    const specM = content.match(/^spec:\s*(.+)$/m);
    return {
      layout: layoutM ? layoutM[1] : "monorepo",
      specPath: specM ? specM[1].trim().replace(/^["']|["']$/g, "") : null,
    };
  } catch {
    return { layout: "monorepo", specPath: null };
  }
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
    // Boundary-aware match: pkgName must be followed by `-`, `.`, `_`, or end.
    // Prevents false positives: "mem" should NOT match "memory-consumer-spec.md".
    const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(lowerPkg)}([-_.]|$)`);
    return entries.some(
      (e) => e.isFile() && e.name.toLowerCase().endsWith(".md") &&
             boundary.test(e.name.toLowerCase())
    );
  } catch {
    return false;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  console.error(`[mega:check-spec] hook crash: ${e.message}`);
  process.exit(0); // R-PLUGIN-001 fail-open
});
