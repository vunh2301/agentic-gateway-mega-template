#!/usr/bin/env node
/**
 * SessionEnd or on-demand hook: report spec sections without code coverage.
 *
 * Rule IDs: V5-R013 (orphan detection, Doorstop pattern)
 *
 * Scans packages/*\/src/**.ts for @spec(section=X.Y) annotations, builds
 * coverage set, compares to sections listed in spec-index.yaml for the
 * active phase. Reports orphans to stderr.
 *
 * Non-blocking (always exit 0). Informational.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) process.exit(0);

  let yaml;
  try {
    yaml = readFileSync(yamlPath, "utf8");
  } catch {
    process.exit(0);
  }

  // Extract active phase sections (simple regex, no full parse)
  const activeMatch = yaml.match(/^active_phase:\s*(.+)$/m);
  if (!activeMatch) process.exit(0);
  const activePhase = activeMatch[1].trim();

  // Find the phase block and its sections array
  const phaseBlockRegex = new RegExp(
    `^\\s+${activePhase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:[\\s\\S]*?(?=^\\s*[\\w-]+:|$)`,
    "m"
  );
  const blockMatch = yaml.match(phaseBlockRegex);
  if (!blockMatch) process.exit(0);

  const sectionsMatch = blockMatch[0].match(/sections:\s*\[([^\]]+)\]/);
  if (!sectionsMatch) process.exit(0);

  const declaredSections = sectionsMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  // Scan src files for @spec(section=X) references
  const foundSections = new Set();
  const srcFiles = findFiles(repoRoot, /packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js)$/);
  for (const f of srcFiles) {
    try {
      const content = readFileSync(f, "utf8");
      const matches = content.matchAll(/@spec\s*\([^)]*section\s*=\s*([^,)\s]+)/g);
      for (const m of matches) {
        foundSections.add(m[1].trim().replace(/^["']|["']$/g, ""));
      }
    } catch {}
  }

  const orphans = declaredSections.filter((s) => !foundSections.has(s));
  const coverage = declaredSections.length === 0
    ? 1.0
    : (declaredSections.length - orphans.length) / declaredSections.length;

  console.error(
    `[mega:orphan-sweep] Phase "${activePhase}" coverage: ${(coverage * 100).toFixed(1)}% ` +
    `(${declaredSections.length - orphans.length}/${declaredSections.length} sections)`
  );

  if (orphans.length > 0) {
    console.error(
      `  Orphan sections (declared but no @spec annotation found):\n` +
      orphans.map((s) => `    - ${s}`).join("\n") +
      `\n  Action: add @spec(section=X) to files implementing these sections,\n` +
      `  or remove section from spec-index.yaml if no longer in scope.`
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

function findFiles(root, pattern, maxFiles = 500) {
  const out = [];
  const skip = /(node_modules|\.git|dist|build|coverage|\.cache)$/;

  function walk(dir, depth = 0) {
    if (depth > 10 || out.length >= maxFiles) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (skip.test(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        const rel = full.replace(root, "").replace(/\\/g, "/").replace(/^\//, "");
        if (pattern.test(rel)) out.push(full);
      }
    }
  }

  walk(root);
  return out;
}

main().catch((e) => {
  console.error(`[mega:orphan-sweep] hook crash: ${e.message}`);
  process.exit(0);
});
