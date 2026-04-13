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
 *   - key: value
 *   - key:
 *       nested: value
 *   - array: [item1, item2]
 *   - array:
 *       - item
 * Does NOT support: anchors, multi-line strings, complex types.
 * R-PLUGIN-002: no npm deps allowed in hooks.
 */
function parseMiniYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/#.*$/, "").trimEnd();
    if (!trimmed.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const content = trimmed.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (content.startsWith("- ")) {
      const val = parseValue(content.slice(2).trim());
      if (!Array.isArray(parent._last)) parent._last = [];
      parent._last.push(val);
      continue;
    }

    // key: value
    const kvMatch = content.match(/^([^:]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim();
    const val = kvMatch[2].trim();

    if (val === "") {
      // Nested — reserve _last for array accumulation, real value decided on next line
      const child = {};
      parent[key] = child;
      // Track _last for arrays
      Object.defineProperty(parent, "_last", { value: child, writable: true, configurable: true, enumerable: false });
      // If next non-empty line is `- item`, child becomes array
      stack.push({ obj: child, indent });
    } else {
      parent[key] = parseValue(val);
    }
  }

  // Collapse _last arrays
  collapseLast(root);
  return root;
}

function collapseLast(obj) {
  if (obj === null || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (Array.isArray(v._last)) {
        obj[k] = v._last;
        continue;
      }
      collapseLast(v);
    }
  }
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
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:phase-gate] hook crash: ${e.message}`);
  process.exit(0); // R-PLUGIN-001
});
