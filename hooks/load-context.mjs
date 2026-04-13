#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject CLAUDE.md digest + active phase from
 * spec-index.yaml. Makes rules impossible to forget mid-session.
 *
 * Output: print context to stdout. Claude Code appends to agent's view.
 * Non-blocking — always exit 0.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const lines = [];
  lines.push("[MEGA-TEMPLATE CONTEXT]");

  // Active phase from spec-index.yaml
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (existsSync(yamlPath)) {
    try {
      const y = readFileSync(yamlPath, "utf8");
      const m = y.match(/^active_phase:\s*(.+)$/m);
      if (m) lines.push(`Active phase: ${m[1].trim()}`);
    } catch {}
  } else {
    lines.push("Active phase: (no spec-index.yaml yet — run /spec-init)");
  }

  // Active package from PROGRESS.md
  const progressPath = join(repoRoot, "PROGRESS.md");
  const progress = safeRead(progressPath);
  const pkgMatch = progress.match(/##\s*Active package\s*\n+\s*\*\*([^*]+)\*\*/i);
  if (pkgMatch) lines.push(`Active package: ${pkgMatch[1].trim()}`);

  if (isStale(progressPath, 7)) {
    lines.push("⚠ PROGRESS.md >7 days stale — verify current state.");
  }

  // Core rules (loaded from rules/ if exists, else CLAUDE.md scan)
  const rulesDir = join(repoRoot, "rules");
  const digest = existsSync(rulesDir)
    ? loadRulesDigest(rulesDir)
    : loadClaudeMdDigest(safeRead(join(repoRoot, "CLAUDE.md")));

  lines.push("");
  lines.push("Core rules (invoke /spec-status for full list):");
  lines.push(digest);
  lines.push("");
  lines.push("Enforcement: check-spec, check-phase-gate, check-spec-coverage,");
  lines.push("require-tests, orphan-sweep. Bypass: CLAUDE_SKIP_HOOKS=1.");

  process.stdout.write(lines.join("\n") + "\n");
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

function safeRead(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function isStale(path, days) {
  try {
    const s = statSync(path);
    return Date.now() - s.mtimeMs > days * 86400000;
  } catch {
    return false;
  }
}

function loadRulesDigest(rulesDir) {
  try {
    const { readdirSync } = require("node:fs");
    const files = readdirSync(rulesDir).filter((f) => f.endsWith(".yaml")).sort();
    const picks = files.slice(0, 8).map((f) => {
      const content = safeRead(join(rulesDir, f));
      const idM = content.match(/^id:\s*(.+)$/m);
      const titleM = content.match(/^title:\s*(.+)$/m);
      const id = idM ? idM[1].trim() : f.replace(".yaml", "");
      const title = titleM ? titleM[1].trim().replace(/^["']|["']$/g, "") : "";
      return `  • ${id}: ${title}`;
    });
    return picks.join("\n");
  } catch {
    return "  (rules/ unreadable)";
  }
}

function loadClaudeMdDigest(md) {
  if (!md) return "  (CLAUDE.md missing)";
  return [
    "  • Read CLAUDE.md + PROGRESS.md + spec before coding",
    "  • Zero imports from Gateway source — public API only",
    "  • No mock Gateway in E2E tests",
    "  • @spec() annotation required on new src files",
    "  • Fix root cause, not symptoms",
    "  • After 3 failed fixes → question architecture",
    "  • REDACT secrets before output",
  ].join("\n");
}

main().catch(() => process.exit(0));
