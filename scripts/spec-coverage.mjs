#!/usr/bin/env node
/**
 * mega-template-coverage — generate coverage matrix from @spec annotations.
 *
 * Scans packages/*\/src/**.ts for @spec(phase=X,section=Y) annotations,
 * groups by phase+section, outputs:
 *   - Coverage summary (declared sections vs implemented)
 *   - Orphan sections (declared but no impl)
 *   - Extra sections (impl but not declared in spec-index.yaml)
 *   - File-level matrix
 *
 * Output: docs/coverage.md (auto-generated) + stdout summary
 *
 * Usage: npx mega-template-coverage
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  const cwd = process.cwd();

  // 1. Read spec-index.yaml
  const yamlPath = join(cwd, "spec-index.yaml");
  if (!existsSync(yamlPath)) {
    console.error("[coverage] spec-index.yaml not found. Run /spec-init first.");
    process.exit(1);
  }

  const yaml = readFileSync(yamlPath, "utf8");
  const activePhaseMatch = yaml.match(/^active_phase:\s*(.+)$/m);
  const activePhase = activePhaseMatch ? activePhaseMatch[1].trim() : null;

  // 2. Extract all phases + declared sections from yaml (simple regex)
  const phases = {};
  const phaseBlocks = yaml.split(/\n(?=  \w[\w-]*:)/).slice(1);
  for (const block of phaseBlocks) {
    const nameMatch = block.match(/^\s+([\w-]+):/);
    if (!nameMatch) continue;
    const sectionsMatch = block.match(/sections:\s*\[([^\]]*)\]/);
    const sections = sectionsMatch
      ? sectionsMatch[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : [];
    phases[nameMatch[1]] = { sections };
  }

  // 3. Scan src files for @spec annotations
  const annotations = []; // { file, phase, section, req }
  const srcFiles = findFiles(cwd, /packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js)$/);
  for (const f of srcFiles) {
    try {
      const content = readFileSync(f, "utf8");
      const matches = content.matchAll(/@spec\s*\(([^)]+)\)/g);
      for (const m of matches) {
        const ann = { file: f.replace(cwd, "").replace(/\\/g, "/").replace(/^\//, "") };
        const params = m[1].split(",").map((p) => p.trim());
        for (const p of params) {
          const [k, v] = p.split("=").map((s) => s.trim().replace(/^["']|["']$/g, ""));
          if (k && v) ann[k] = v;
        }
        annotations.push(ann);
      }
    } catch {}
  }

  // 4. Build coverage matrix per phase
  const lines = [];
  lines.push("# Spec Coverage Matrix");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Active phase: ${activePhase || "(none)"}`);
  lines.push("");

  for (const [phaseName, phase] of Object.entries(phases)) {
    const declaredSections = new Set(phase.sections.map(String));
    const annsForPhase = annotations.filter((a) => a.phase === phaseName);
    const implSections = new Set(annsForPhase.map((a) => a.section).filter(Boolean));

    const orphans = [...declaredSections].filter((s) => !implSections.has(s));
    const extras = [...implSections].filter((s) => !declaredSections.has(s));
    const coverage = declaredSections.size === 0
      ? 1.0
      : (declaredSections.size - orphans.length) / declaredSections.size;

    lines.push(`## ${phaseName}${phaseName === activePhase ? " (active)" : ""}`);
    lines.push("");
    lines.push(`- Declared sections: ${declaredSections.size}`);
    lines.push(`- Implemented: ${declaredSections.size - orphans.length}`);
    lines.push(`- Coverage: **${(coverage * 100).toFixed(1)}%**`);
    if (orphans.length) {
      lines.push(`- Orphans (declared but not implemented): ${orphans.join(", ")}`);
    }
    if (extras.length) {
      lines.push(`- Extras (implemented but not declared): ${extras.join(", ")}`);
    }
    lines.push("");

    if (annsForPhase.length) {
      lines.push(`### Annotations in ${phaseName}`);
      lines.push("");
      lines.push("| File | Section | Req |");
      lines.push("|------|---------|-----|");
      for (const a of annsForPhase.sort((x, y) => x.file.localeCompare(y.file))) {
        lines.push(`| ${a.file} | ${a.section || "-"} | ${a.req || "-"} |`);
      }
      lines.push("");
    }
  }

  const out = lines.join("\n");

  // 5. Write docs/coverage.md
  const outPath = join(cwd, "docs", "coverage.md");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);

  console.log(`[coverage] wrote ${outPath}`);
  console.log("");
  console.log(lines.slice(0, 15).join("\n"));
}

function findFiles(root, pattern, max = 500) {
  const out = [];
  const skip = /(node_modules|\.git|dist|build|coverage|\.cache)$/;
  function walk(dir, depth = 0) {
    if (depth > 10 || out.length >= max) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
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
  console.error(`[coverage] ERROR: ${e.message}`);
  process.exit(1);
});
