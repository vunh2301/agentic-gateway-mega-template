#!/usr/bin/env node
/**
 * PreToolUse hook: require @spec() annotation in new src files.
 *
 * Rule IDs: V5-R012 (traceability)
 *
 * Supports two layouts (via spec-index.yaml `layout:` field):
 *   monorepo (default): packages/<pkg>/src/**
 *   flat:               src/** at repo root
 *
 * Edits to EXISTING files are exempt (annotation may exist elsewhere in file).
 *
 * R-PLUGIN-001: fail-open on crash. Exit 2 = deny, 0 = allow.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  if (!payload) process.exit(0);

  const toolName = payload.tool_name;
  const filePath = payload?.tool_input?.file_path;
  const content = payload?.tool_input?.content || payload?.tool_input?.new_string || "";

  if (!filePath) process.exit(0);

  // Only enforce on Write (new files). Edit = exempt (existing file, annotation may be elsewhere).
  if (toolName !== "Write") process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isExempt(p)) process.exit(0);

  const repoRoot = findRepoRoot(dirname(filePath)) || process.cwd();
  const layout = readLayout(repoRoot);

  // Target src files based on layout
  const isSrc = layout === "flat"
    ? /(?:^|\/)src\/.+\.(ts|tsx|mjs|js|cjs)$/.test(p)
    : /\/packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js|cjs)$/.test(p);

  if (!isSrc) process.exit(0);

  // Skip test files (already exempted above by isExempt, but double-check)
  if (/\.(test|spec)\./.test(p)) process.exit(0);

  // Check for @spec annotation in content
  const specPattern = /@spec\s*\(\s*(phase|section|req)\s*=/;
  if (!specPattern.test(content)) {
    console.error(
      `[mega:spec-coverage] BLOCKED: new src file without @spec annotation (V5-R012).\n` +
      `  File: ${p}\n` +
      `  Required: add a comment with @spec(phase=X,section=Y.Z) or @spec(phase=X,req=V5-R001)\n` +
      `  Example:\n` +
      `    /** @spec(phase=1,section=3.2,req=V5-R012) */\n` +
      `    export class Extractor { ... }\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit).`
    );
    process.exit(2);
  }

  process.exit(0);
}

function isExempt(p) {
  return /\/(\.claude|docs|\.git)\//.test(p) ||
         /\/(tests?|__tests__)\//.test(p) ||
         /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(p) ||
         /^[^/]*\.(md|json|yaml|yml)$/i.test(p);
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

main().catch((e) => {
  console.error(`[mega:spec-coverage] hook crash: ${e.message}`);
  process.exit(0);
});
