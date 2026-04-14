#!/usr/bin/env node
/**
 * PreToolUse hook (Bash `git commit`): enforce slice ordering from workflow.json.
 *
 * Rule IDs: V5-R059 (workflow continuity), V5-R060 (no mid-phase pivot without
 * explicit user approval).
 *
 * When `.omc/state/workflow.json` exists (written by /ralplan or /autopilot),
 * every non-exempt commit must carry a slice-id that matches the next
 * pending slice in the plan, OR explicitly mark the commit as hotfix/docs.
 *
 * Commit-message conventions accepted:
 *   v5-<phase>.slice-<NN>: <desc>     ← matches slices[current].id
 *   v5-<phase>.step-<NN>: <desc>      ← alias for slice
 *   v5-<phase>.hotfix: <desc>         ← exempt, goes through
 *   docs: / chore: / infra: / ci:     ← exempt (V5-R053)
 *
 * Bypass: CLAUDE_SKIP_HOOKS=1 (document reason in commit body).
 *
 * Why: prior phases had agent silently pivoting mid-phase (e.g. "let me fix
 * search-hybrid while I'm here") which blew scope and produced phantom
 * commits. Enforcing slice-id keeps the plan and the commit stream aligned.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const EXEMPT_PREFIXES = [
  "docs:", "chore:", "infra:", "ci:", "build:", "test:", "refactor:",
  "revert:", "merge:",
];

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const cmd = payload?.tool_input?.command || "";
  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
  if (/--amend/.test(cmd)) process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const workflowPath = join(repoRoot, ".omc", "state", "workflow.json");
  if (!existsSync(workflowPath)) process.exit(0); // no plan → no enforcement

  let workflow;
  try {
    workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  } catch {
    process.exit(0); // unreadable → don't block
  }

  const msg = extractCommitMessage(cmd);
  if (!msg) process.exit(0); // can't parse → don't block

  // Exempt prefixes pass through
  for (const pre of EXEMPT_PREFIXES) {
    if (msg.startsWith(pre)) process.exit(0);
  }
  // Hotfix path
  if (/\bhotfix\b/i.test(msg)) process.exit(0);
  // phase-promote also exempt (handled by check-review-evidence)
  if (/^phase-promote:/.test(msg)) process.exit(0);

  // Detect the slice-id claimed by this commit
  const sliceRe = /^v5-[\w\-]+\.(?:slice|step)-(\d+):/;
  const sliceMatch = msg.match(sliceRe);

  const nextSlice = (workflow.slices || []).find(
    (s) => s.status === "pending" || s.status === "in-progress",
  );

  if (!nextSlice) {
    // Plan complete but commit still carrying a slice-id — probably fine
    process.exit(0);
  }

  if (!sliceMatch) {
    console.error(
      `[mega:enforce-slice-order] BLOCKED: commit missing slice-id while workflow.json has open slices (V5-R059).\n` +
      `  Active phase: ${workflow.phase || "(unknown)"}\n` +
      `  Next slice: ${nextSlice.id} — ${nextSlice.title || "(untitled)"}\n` +
      `  Expected message prefix: v5-${workflow.phase}.slice-${nextSlice.id}: <desc>\n` +
      `  Got: ${msg.slice(0, 80)}\n` +
      `  Fix: rewrite the commit message OR mark the commit as hotfix/docs/chore.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document reason in commit body).`,
    );
    process.exit(2);
  }

  const claimed = sliceMatch[1].replace(/^0+/, "") || "0";
  const expected = String(nextSlice.id).replace(/^0+/, "") || "0";
  if (claimed !== expected) {
    console.error(
      `[mega:enforce-slice-order] BLOCKED: slice-id mismatch (V5-R060 — no mid-phase pivot).\n` +
      `  Commit claims slice-${claimed}, workflow expects slice-${expected}.\n` +
      `  Active phase: ${workflow.phase}\n` +
      `  Expected next: ${nextSlice.id} — ${nextSlice.title || "(untitled)"}\n` +
      `  Complete the pending slice first, or revise the plan via /ralplan.\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document reason in commit body).`,
    );
    process.exit(2);
  }

  process.exit(0);
}

function extractCommitMessage(cmd) {
  const m = cmd.match(/-m\s+(["'])([^"']+)\1/);
  if (m) return m[2].trim();
  const heredoc = cmd.match(/-m\s+"\$\(cat\s*<<['"]?EOF['"]?\s*\n([\s\S]*?)\nEOF/);
  if (heredoc) return heredoc[1].trim().split("\n")[0];
  return null;
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
  console.error(`[mega:enforce-slice-order] hook crash: ${e.message}`);
  process.exit(0);
});
