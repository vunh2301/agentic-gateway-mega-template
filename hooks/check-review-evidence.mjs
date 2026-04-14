#!/usr/bin/env node
/**
 * PreToolUse hook (Bash `git commit`): block phase-promote commits without
 * independent review artifacts.
 *
 * Rule IDs: V5-R055 (independent review pass), V5-R056 (promote-gate)
 *
 * Intercepts commit messages matching /^phase-promote:/ or tags like
 * phase-*-verified. Requires `.omc/reviews/<phase>-{reviewer,verifier,critic}.md`
 * to exist, each with non-empty `verdict:` frontmatter line.
 *
 * Config in spec-index.yaml:
 *   review:
 *     enabled: true
 *     required: [reviewer, verifier, critic]
 *     artifact_dir: .omc/reviews
 *     accept_verdicts: [approved, approved-with-notes]
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1 (document in commit body).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULTS = {
  enabled: true,
  required: ["reviewer", "verifier", "critic"],
  artifact_dir: ".omc/reviews",
  accept_verdicts: ["approved", "approved-with-notes"],
};

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";
  if (!/\bgit\s+(commit|tag)\b/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const cfg = readReviewConfig(repoRoot);
  if (!cfg.enabled) process.exit(0);

  // Detect phase-promote intent
  const msg = extractCommitMessage(cmd);
  const tag = extractTag(cmd);
  const isPromoteCommit = msg && /^phase-promote:/.test(msg);
  const isPromoteTag = tag && /^phase-.*-verified$/.test(tag);
  if (!isPromoteCommit && !isPromoteTag) process.exit(0);

  // Identify active phase
  const phase = readActivePhase(repoRoot);
  if (!phase) {
    console.error(
      `[mega:check-review-evidence] BLOCKED: cannot detect active_phase from spec-index.yaml`,
    );
    process.exit(2);
  }

  const missing = [];
  const rejected = [];
  for (const reviewer of cfg.required) {
    const file = join(repoRoot, cfg.artifact_dir, `${phase}-${reviewer}.md`);
    if (!existsSync(file)) {
      missing.push(`${cfg.artifact_dir}/${phase}-${reviewer}.md`);
      continue;
    }
    const verdict = extractVerdict(file);
    if (!verdict) {
      rejected.push(`${cfg.artifact_dir}/${phase}-${reviewer}.md (no verdict: field)`);
      continue;
    }
    if (!cfg.accept_verdicts.includes(verdict)) {
      rejected.push(`${cfg.artifact_dir}/${phase}-${reviewer}.md (verdict=${verdict})`);
    }
  }

  if (missing.length === 0 && rejected.length === 0) {
    console.error(
      `[mega:check-review-evidence] OK: ${cfg.required.length} reviews present for ${phase}`,
    );
    process.exit(0);
  }

  console.error(
    `[mega:check-review-evidence] BLOCKED: phase-promote requires independent reviews (V5-R055, V5-R056).\n` +
    `  Active phase: ${phase}\n` +
    (missing.length
      ? `  Missing:\n${missing.map((f) => `    - ${f}`).join("\n")}\n`
      : "") +
    (rejected.length
      ? `  Rejected verdicts (accepted: ${cfg.accept_verdicts.join(", ")}):\n${rejected.map((f) => `    - ${f}`).join("\n")}\n`
      : "") +
    `  Fix: run /phase-review to generate artifacts, or address reviewer findings.\n` +
    `  Bypass: CLAUDE_SKIP_HOOKS=1 (document reason in commit body).`,
  );
  process.exit(2);
}

function readReviewConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) return DEFAULTS;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const m = yaml.match(/^review:\s*\n((?:\s+.*\n?)+?)(?=^\S|\Z)/m);
    if (!m) return DEFAULTS;
    const block = m[1];
    const enabled = !/^\s+enabled:\s*false/m.test(block);
    const dirM = block.match(/artifact_dir:\s*"?([^"\n]+?)"?\s*$/m);
    const reqM = block.match(/required:\s*\[([^\]]+)\]/);
    const verdM = block.match(/accept_verdicts:\s*\[([^\]]+)\]/);
    return {
      enabled,
      artifact_dir: dirM ? dirM[1].trim() : DEFAULTS.artifact_dir,
      required: reqM
        ? reqM[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : DEFAULTS.required,
      accept_verdicts: verdM
        ? verdM[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : DEFAULTS.accept_verdicts,
    };
  } catch {
    return DEFAULTS;
  }
}

function readActivePhase(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) return null;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const m = yaml.match(/^active_phase:\s*"?([^"\n]+?)"?\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function extractVerdict(file) {
  try {
    const content = readFileSync(file, "utf8");
    // Expect frontmatter: verdict: approved | approved-with-notes | changes-requested | rejected
    const m = content.match(/^verdict:\s*"?([a-z][a-z0-9-]*)"?\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function extractCommitMessage(cmd) {
  const m = cmd.match(/-m\s+(["'])([^"']+)\1/);
  if (m) return m[2].trim();
  const heredoc = cmd.match(/-m\s+"\$\(cat\s*<<['"]?EOF['"]?\s*\n([\s\S]*?)\nEOF/);
  if (heredoc) return heredoc[1].trim().split("\n")[0];
  return null;
}

function extractTag(cmd) {
  const m = cmd.match(/\bgit\s+tag\s+(?:-a\s+)?([A-Za-z0-9._\-\/]+)/);
  return m ? m[1] : null;
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
  console.error(`[mega:check-review-evidence] hook crash: ${e.message}`);
  process.exit(0);
});
