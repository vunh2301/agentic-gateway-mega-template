#!/usr/bin/env node
/**
 * mega-template-status — npm-friendly equivalent of the `/spec-status`
 * slash command. Shows active phase, declared sections, @spec coverage,
 * orphan sections, and slice-workflow progress for the current repo.
 *
 * Usage: npx mega-template-status
 *
 * Rationale: slash commands (commands/*.md) only register when the plugin
 * is installed via Claude Code's plugin marketplace. Consumers that
 * pinned mega-template via `npm install` do not get slash commands, so
 * we expose the same info as a CLI.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

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

function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

function readSpecIndex(repoRoot) {
  const p = join(repoRoot, "spec-index.yaml");
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  const active = raw.match(/^active_phase:\s*(.+)$/m);
  const spec = raw.match(/^spec:\s*(.+)$/m);
  const layout = raw.match(/^layout:\s*(.+)$/m);
  // Parse phase block
  const phaseName = active ? active[1].trim() : null;
  let phase = null;
  if (phaseName) {
    const lines = raw.split(/\r?\n/);
    let i = 0;
    while (i < lines.length && !/^phases\s*:/.test(lines[i])) i++;
    i++;
    const header = new RegExp(`^(\\s+)${phaseName}:\\s*$`);
    let indent = null;
    while (i < lines.length) {
      const m = lines[i].match(header);
      if (m) { indent = m[1].length; break; }
      i++;
    }
    if (indent !== null) {
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (ln === "") { body.push(ln); continue; }
        const leading = ln.match(/^(\s*)/)[1].length;
        if (leading > indent) body.push(ln); else break;
      }
      const blk = body.join("\n");
      const sectionsM = blk.match(/sections:\s*\[([^\]]+)\]/);
      const statusM = blk.match(/status:\s*(\S+)/);
      const pathsM = blk.match(/paths:\s*\n((?:\s+-\s+.+\n?)+)/);
      phase = {
        status: statusM ? statusM[1] : null,
        sections: sectionsM ? sectionsM[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
        paths: pathsM ? pathsM[1].split("\n").filter(Boolean).map((l) => l.replace(/^\s+-\s+/, "").trim()) : [],
      };
    }
  }
  return {
    active_phase: phaseName,
    spec: spec ? spec[1].trim() : null,
    layout: layout ? layout[1].trim().replace(/\s+#.*$/, "") : null,
    phase,
  };
}

function readWorkflow(repoRoot) {
  const p = join(repoRoot, ".omc", "state", "workflow.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function findSrcFiles(repoRoot, paths) {
  const hits = [];
  const seen = new Set();
  for (const pat of paths || []) {
    const base = pat.replace(/\/\*\*.*$/, "").replace(/\*.*$/, "");
    const dir = join(repoRoot, base);
    if (!existsSync(dir)) continue;
    walk(dir, hits, seen);
  }
  return hits;
}

function walk(dir, hits, seen, depth = 0) {
  if (depth > 10) return;
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (seen.has(p)) continue;
      seen.add(p);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist" || ent.name.startsWith(".")) continue;
        walk(p, hits, seen, depth + 1);
      } else if (ent.isFile() && /\.(ts|tsx|mjs|js|cjs)$/.test(ent.name) && !/\.(test|spec|d)\./.test(ent.name)) {
        hits.push(p);
      }
    }
  } catch {}
}

function extractSpecAnnotation(content) {
  // Match @spec(phase=N,section=X) or @spec(section=X)
  const matches = [];
  const re = /@spec\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const sectionM = m[1].match(/section\s*=\s*["']?([^"',)]+)["']?/);
    if (sectionM) matches.push(sectionM[1].trim());
  }
  return matches;
}

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) { console.error("[status] ERROR: not in a git repo"); process.exit(1); }

  const idx = readSpecIndex(repoRoot);
  if (!idx) { console.error("[status] ERROR: spec-index.yaml not found. Run `npx mega-template-init` first."); process.exit(1); }

  console.log("");
  console.log(`═══ mega-template status — ${repoRoot} ═══`);
  console.log("");
  console.log(`Active phase: ${idx.active_phase} (${idx.phase?.status || "unknown"})`);
  console.log(`Spec doc:     ${idx.spec || "(none)"}${idx.spec && existsSync(join(repoRoot, idx.spec)) ? "" : "  ⚠ MISSING"}`);
  console.log(`Layout:       ${idx.layout || "monorepo"}`);
  console.log("");

  if (idx.phase) {
    console.log(`Declared sections (${idx.phase.sections.length}): ${idx.phase.sections.join(", ") || "(none)"}`);
    console.log(`Allowed paths:`);
    for (const pt of idx.phase.paths) console.log(`  • ${pt}`);
    console.log("");
  }

  // Coverage — @spec annotation scan
  const srcFiles = findSrcFiles(repoRoot, idx.phase?.paths);
  const annotatedBySection = new Map();
  const orphans = new Set(idx.phase?.sections || []);
  for (const f of srcFiles) {
    const secs = extractSpecAnnotation(safeRead(f));
    for (const s of secs) {
      annotatedBySection.set(s, (annotatedBySection.get(s) || 0) + 1);
      orphans.delete(s);
    }
  }
  console.log(`Source files in scope: ${srcFiles.length}`);
  console.log(`@spec annotations by section:`);
  for (const s of idx.phase?.sections || []) {
    const count = annotatedBySection.get(s) || 0;
    const mark = count > 0 ? "✓" : "✗";
    console.log(`  ${mark} §${s}: ${count} file${count === 1 ? "" : "s"}`);
  }
  if (orphans.size > 0) {
    console.log("");
    console.log(`⚠ Orphan sections (declared but no @spec annotation in code):`);
    for (const s of orphans) console.log(`    §${s}`);
  }
  console.log("");

  // Workflow state
  const wf = readWorkflow(repoRoot);
  if (wf) {
    const done = (wf.slices || []).filter((s) => s.status === "done").length;
    const total = (wf.slices || []).length;
    console.log(`Workflow: ${wf.phase || idx.active_phase} — ${done}/${total} slices done`);
    for (const s of wf.slices || []) {
      const mark =
        s.status === "done" ? "✓" :
        s.status === "in-progress" ? "▶" :
        "·";
      const commit = s.commit ? ` (${s.commit.slice(0, 7)})` : "";
      console.log(`  ${mark} slice-${s.id}: ${s.title || ""}${commit}`);
    }
    console.log("");
  } else {
    console.log("Workflow: .omc/state/workflow.json not found (slice-order gate inactive)");
    console.log("");
  }

  // PROGRESS.md freshness
  const progressPath = join(repoRoot, "PROGRESS.md");
  if (existsSync(progressPath)) {
    const ageH = (Date.now() - statSync(progressPath).mtimeMs) / 3600000;
    console.log(`PROGRESS.md age: ${ageH.toFixed(1)}h${ageH > 24 ? " ⚠ stale (>24h)" : ""}`);
  } else {
    console.log("PROGRESS.md: missing ⚠");
  }
  console.log("");
}

main();
