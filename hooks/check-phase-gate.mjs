#!/usr/bin/env node
/**
 * PreToolUse hook: enforce phase scope per spec-index.yaml.
 *
 * Rule IDs: V5-R011 (phase gating, Rust RFC pattern)
 *
 * Reads spec-index.yaml at repo root. Determines active phase (status:
 * in-progress). If file path does not match any pattern in the active
 * phase's `paths` list, block.
 *
 * spec-index.yaml format:
 *   active_phase: phase-1
 *   phases:
 *     phase-1:
 *       status: in-progress
 *       paths: ["packages/memory-consumer/src/**", "tests/unit/**"]
 *       sections: [2, 3.1, 3.2, 4, 5]
 *     phase-6-8:
 *       status: future
 *       gate: "phase-1.status == verified"
 *       paths: ["packages/memory-consumer/src/future/**"]
 *
 * R-PLUGIN-009: if yaml missing → warn only. If yaml malformed → block.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isExempt(p)) process.exit(0);

  const repoRoot = findRepoRoot(dirname(filePath)) || process.cwd();
  const yamlPath = join(repoRoot, "spec-index.yaml");

  if (!existsSync(yamlPath)) {
    // R-PLUGIN-009: fail-open on missing (backward compat)
    console.error(
      `[mega:phase-gate] NOTE: spec-index.yaml not found. Phase gating disabled.\n` +
      `  Run /spec-init or npx mega-template-init to create one.`
    );
    process.exit(0);
  }

  let index;
  try {
    index = parseMiniYaml(readFileSync(yamlPath, "utf8"));
  } catch (e) {
    console.error(`[mega:phase-gate] BLOCKED: spec-index.yaml malformed: ${e.message}`);
    process.exit(2);
  }

  const activePhase = index.active_phase;
  if (!activePhase) {
    console.error(`[mega:phase-gate] NOTE: no active_phase set. Allowing.`);
    process.exit(0);
  }

  const phases = index.phases || {};
  const phaseCfg = phases[activePhase];
  if (!phaseCfg) {
    console.error(`[mega:phase-gate] BLOCKED: active_phase "${activePhase}" not defined.`);
    process.exit(2);
  }

  // Normalize file path relative to repo root
  const repoRootNorm = repoRoot.replace(/\\/g, "/");
  const relPath = p.startsWith(repoRootNorm)
    ? p.slice(repoRootNorm.length + 1)
    : p;

  // Find MOST SPECIFIC matching phase (longest pattern wins).
  // Prevents `src/**` in phase-1 from swallowing `src/future/**` of phase-6.
  let best = null;
  for (const [name, cfg] of Object.entries(phases)) {
    for (const pattern of cfg.paths || []) {
      if (matchGlob(relPath, pattern)) {
        if (!best || pattern.length > best.pattern.length) {
          best = { phase: name, pattern, cfg };
        }
      }
    }
  }

  if (!best) {
    // File matches no declared phase. Allow (undeclared = scratch/test/doc).
    process.exit(0);
  }

  if (best.phase !== activePhase) {
    const status = best.cfg.status || "undefined";
    const reason = status === "verified"
      ? `belongs to phase "${best.phase}" (already verified — frozen)`
      : status === "in-progress"
      ? `belongs to phase "${best.phase}" (different active phase)`
      : `belongs to phase "${best.phase}" (status: ${status}, locked behind active)`;

    console.error(
      `[mega:phase-gate] BLOCKED: write outside active phase "${activePhase}" (V5-R016).\n` +
      `  File: ${relPath}\n` +
      `  Matched pattern: ${best.pattern} (phase ${best.phase})\n` +
      `  Reason: ${reason}.\n` +
      `  Fix: finish "${activePhase}", run /phase-promote to advance.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit).`
    );
    process.exit(2);
  }

  process.exit(0);
}

function isExempt(p) {
  return /\/(\.claude|docs|\.git)\//.test(p) ||
         /^[^/]*\.md$/i.test(p) ||
         /\/(PROGRESS|CLAUDE|AGENTS|README|LICENSE)\.md$/i.test(p) ||
         /spec-index\.yaml$/.test(p);
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

function findOwningPhase(relPath, phases, excludePhase) {
  for (const [name, cfg] of Object.entries(phases)) {
    if (name === excludePhase) continue;
    if ((cfg.paths || []).some((p) => matchGlob(relPath, p))) return name;
  }
  return null;
}

/**
 * Minimal glob matcher: supports ** (any depth), * (single segment).
 * Normalized for path separators.
 */
function matchGlob(path, pattern) {
  const p = path.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  const regex = new RegExp(
    "^" +
    pat.replace(/[.+^${}()|[\]\\]/g, "\\$&")
       .replace(/\*\*/g, "§DOUBLESTAR§")
       .replace(/\*/g, "[^/]*")
       .replace(/§DOUBLESTAR§/g, ".*") +
    "$"
  );
  return regex.test(p);
}

/**
 * Minimal YAML parser for spec-index.yaml only. Supports:
 *   key: value
 *   key:
 *     nested: value
 *   inline_array: [item1, item2]
 *   block_array:
 *     - item1
 *     - item2
 *   mixed (object + block_array siblings at same indent level)
 *
 * Does NOT support: anchors, multi-line strings, complex types, flow sequences
 * with nested objects. R-PLUGIN-002: no npm deps allowed in hooks.
 *
 * Stack tracks (container, parent, keyInParent, indent). When we see `- item`
 * at a new indent, we convert the parent's key slot to an array if it wasn't
 * already one (auto-detection — no `_last` hack).
 */
function parseMiniYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  // Stack frame: { container, parent, keyInParent, indent }
  const stack = [{ container: root, parent: null, keyInParent: null, indent: -1 }];

  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, "").trimEnd();
    if (!trimmed.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const content = trimmed.trim();

    // Pop frames until current indent is strictly greater than top frame's indent
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    let ctx = stack[stack.length - 1];

    // Array item
    if (content.startsWith("- ")) {
      // If current container is not an array, convert. Replace in parent.
      if (!Array.isArray(ctx.container)) {
        const arr = [];
        if (ctx.parent && ctx.keyInParent != null) {
          ctx.parent[ctx.keyInParent] = arr;
        }
        // Mutate frame in place so subsequent items push to same array
        ctx.container = arr;
      }
      const val = parseValue(content.slice(2).trim());
      ctx.container.push(val);
      continue;
    }

    // key: value (parent must be object, not array)
    if (Array.isArray(ctx.container)) continue; // skip malformed

    const kvMatch = content.match(/^([^:]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim();
    const val = kvMatch[2].trim();

    if (val === "") {
      // Nested: create empty object. If next line is `- item`, we'll convert to array.
      const child = {};
      ctx.container[key] = child;
      stack.push({ container: child, parent: ctx.container, keyInParent: key, indent });
    } else {
      ctx.container[key] = parseValue(val);
    }
  }

  return root;
}

function parseValue(v) {
  const t = v.trim();
  if (t === "") return null;
  if (t === "null" || t === "~") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  if (t.startsWith("[") && t.endsWith("]")) {
    return t.slice(1, -1).split(",").map((s) => parseValue(s.trim())).filter((x) => x !== null);
  }
  // Strip quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
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
  console.error(`[mega:phase-gate] hook crash: ${e.message}`);
  process.exit(0); // R-PLUGIN-001
});
