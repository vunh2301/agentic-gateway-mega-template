#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject CLAUDE.md digest + active phase from
 * spec-index.yaml. Makes rules impossible to forget mid-session.
 *
 * Output: print context to stdout. Claude Code appends to agent's view.
 * Non-blocking — always exit 0.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

async function main() {
  // HARD SAFETY: process exits within 2.5s no matter what — prevents 
  // any async hang from blocking the harness (V5-R049).
  setTimeout(() => { try { process.exit(0); } catch {} }, 2500);
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  // Read user prompt from stdin payload so we can classify intent
  const payload = await readStdinJson();
  const userPrompt = payload?.prompt || "";

  const lines = [];

  // === Mandatory workflow protocol (always injected) ===
  // Keeps Gate-1 behaviour enforceable at prompt time, not just at Write time.
  // Rule V5-R001 (read state first), V5-R002 (plan before code).
  lines.push("<workflow-protocol mandatory=\"true\">");
  lines.push("This repo is mega-template-enforced. Before ANY Write/Edit in a");
  lines.push("new conversation, you MUST:");
  lines.push("  1. Read CLAUDE.md + PROGRESS.md + spec-index.yaml + active spec doc.");
  lines.push("  2. Produce a state table: Active phase / Sections / Status / Next.");
  lines.push("  3. Wait for user approval of proposed next task before code.");
  lines.push("  4. For non-trivial work (>1 file, new feature), invoke");
  lines.push("     /oh-my-claudecode:ralplan before Write/Edit.");
  lines.push("Harness hooks (check-spec, check-phase-gate, check-spec-coverage,");
  lines.push("enforce-tdd, check-review-evidence) will block violations at tool time,");
  lines.push("but treat this protocol as primary — fewer failed tool calls.");
  lines.push("Trivial exceptions (V5-R007): typo/rename/comment-only changes skip");
  lines.push("steps 2-4 — but still read state first.");
  lines.push("</workflow-protocol>");
  lines.push("");

  // Intent classifier — strengthen protocol when user signals coding work
  const intent = classifyIntent(userPrompt);
  if (intent !== "none") {
    lines.push(`<prompt-classifier intent="${intent}">`);
    if (intent === "coding") {
      lines.push("Prompt signals code change (add/build/implement/fix/refactor).");
      lines.push("If this is a fresh conversation OR you have not confirmed state");
      lines.push("in this thread, DO NOT call Write/Edit. Start with the protocol");
      lines.push("above and wait for user approval.");
    } else if (intent === "promote") {
      lines.push("Prompt signals phase-promote. check-review-evidence hook will");
      lines.push("block the commit unless .omc/reviews/<phase>-{reviewer,verifier,");
      lines.push("critic}.md exist with accepted verdicts. Run /phase-review first.");
    } else if (intent === "trivial") {
      lines.push("Prompt looks trivial (typo/rename/comment). V5-R007 allows");
      lines.push("direct edit after state read. Skip ralplan.");
    }
    lines.push("</prompt-classifier>");
    lines.push("");
  }

  // === Active workflow + resume suggestion (V5-R059) ===
  const workflow = loadWorkflowState(repoRoot);
  if (workflow) {
    lines.push("<active-flow>");
    lines.push(`Phase: ${workflow.phase} — slice ${workflow.progressLabel}`);
    if (workflow.currentSlice) {
      lines.push(`Current: slice-${workflow.currentSlice.id} ${workflow.currentSlice.title || ""}`);
    }
    if (workflow.lastCompleted) {
      lines.push(`Last done: slice-${workflow.lastCompleted.id} (commit ${workflow.lastCompleted.commit || "?"})`);
    }
    if (workflow.nextSlice && workflow.nextSlice !== workflow.currentSlice) {
      lines.push(`Next: slice-${workflow.nextSlice.id} — ${workflow.nextSlice.title || ""}`);
    }
    lines.push(`Resume hint: reply "continue" or "/autopilot resume" to proceed.`);
    lines.push(`Abandon hint: user must explicitly say "pause phase" or "switch to X".`);
    lines.push("</active-flow>");
    lines.push("");
  }

  // === Off-topic / drift detection (V5-R060) ===
  const drift = detectDrift(userPrompt, workflow, repoRoot);
  if (drift) {
    lines.push("<off-topic-warning>");
    lines.push(drift);
    lines.push("Action: acknowledge user's request, note it may drift from the active flow,");
    lines.push("and ask: pause current phase, add to phase-N+1 backlog, or explicitly pivot");
    lines.push("(requires /ralplan to revise workflow.json).");
    lines.push("</off-topic-warning>");
    lines.push("");
  }

  lines.push("[MEGA-TEMPLATE CONTEXT]");

  // Session-start detection (3 entry flows)
  const state = detectRepoState(repoRoot);
  if (state.suggestion) lines.push(`➤ ${state.suggestion}`);

  // Active phase from spec-index.yaml
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (existsSync(yamlPath)) {
    try {
      const y = readFileSync(yamlPath, "utf8");
      const m = y.match(/^active_phase:\s*(.+)$/m);
      if (m) lines.push(`Active phase: ${m[1].trim()}`);
    } catch {}
  }

  // Active package from PROGRESS.md
  const progressPath = join(repoRoot, "PROGRESS.md");
  const progress = safeRead(progressPath);
  const pkgMatch = progress.match(/##\s*Active package\s*\n+\s*\*\*([^*]+)\*\*/i);
  if (pkgMatch) lines.push(`Active package: ${pkgMatch[1].trim()}`);

  if (existsSync(progressPath) && isStale(progressPath, 7)) {
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

/**
 * Detect repo state to suggest next action (3 entry flows + beyond).
 * Runs on every session start via UserPromptSubmit. Read-only.
 */
function detectRepoState(repoRoot) {
  const hasClaude = existsSync(join(repoRoot, ".claude"));
  const hasClaudeMd = existsSync(join(repoRoot, "CLAUDE.md"));
  const hasSpecIndex = existsSync(join(repoRoot, "spec-index.yaml"));
  const hasPackages = existsSync(join(repoRoot, "packages"));
  const specsDir = join(repoRoot, "docs", "specs");
  const plansDir = join(repoRoot, "docs", "plans");
  const hasAnySpec = existsSync(specsDir) && readdirSafe(specsDir).some((f) => f.endsWith(".md"));
  const hasAnyPlan = existsSync(plansDir) && readdirSafe(plansDir).some((f) => f.endsWith(".md"));

  if (!hasClaude || !hasClaudeMd) {
    return { suggestion: "New repo detected. Run: npx mega-template-init to bootstrap enforcement." };
  }
  if (!hasSpecIndex) {
    return { suggestion: "Enforcement installed but no spec-index.yaml. Run /spec-init to declare phases." };
  }
  if (!hasAnySpec && hasPackages) {
    return { suggestion: "spec-index.yaml exists but docs/specs/ empty. Run /oh-my-claudecode:deep-interview <feature>." };
  }
  if (hasAnySpec && !hasAnyPlan) {
    return { suggestion: "Spec drafted but no plan. Run /oh-my-claudecode:ralplan." };
  }
  if (hasAnyPlan) {
    const openTasks = countOpenTasks(plansDir);
    if (openTasks > 0) {
      return { suggestion: `Plan has ${openTasks} open task(s). Resume with /oh-my-claudecode:autopilot or /oh-my-claudecode:ralph.` };
    }
    return { suggestion: "All plan tasks done. Run /phase-promote to advance." };
  }
  return { suggestion: null };
}

function readdirSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}

function countOpenTasks(plansDir) {
  let count = 0;
  for (const f of readdirSafe(plansDir)) {
    if (!f.endsWith(".md")) continue;
    const content = safeRead(join(plansDir, f));
    count += (content.match(/^\s*-\s*\[\s*\]/gm) || []).length;
  }
  return count;
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

/**
 * Load workflow.json + derive current/next/last slice info for display.
 * Returns null when no workflow file — hook caller treats that as "no active flow".
 */
function loadWorkflowState(repoRoot) {
  const p = join(repoRoot, ".omc", "state", "workflow.json");
  if (!existsSync(p)) return null;
  try {
    const w = JSON.parse(readFileSync(p, "utf8"));
    const slices = w.slices || [];
    const total = slices.length;
    const done = slices.filter((s) => s.status === "done").length;
    const inprog = slices.find((s) => s.status === "in-progress");
    const nextPending = slices.find((s) => s.status === "pending");
    const currentSlice = inprog || nextPending || null;
    const lastCompleted = [...slices].reverse().find((s) => s.status === "done");
    const nextSlice = currentSlice === inprog ? nextPending : currentSlice;
    return {
      phase: w.phase || "(unknown)",
      progressLabel: `${done}/${total}`,
      currentSlice,
      nextSlice,
      lastCompleted,
    };
  } catch {
    return null;
  }
}

/**
 * Detect off-topic prompts relative to the active phase's spec section
 * keywords. Returns a warning string or null.
 * Heuristic: if there's an active workflow AND the prompt has >6 words AND
 * shares zero keywords with the phase's spec sections, flag drift.
 * Stays conservative — false positives worse than false negatives here.
 */
function detectDrift(userPrompt, workflow, repoRoot) {
  if (!workflow || !userPrompt) return null;
  const words = userPrompt.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
  if (words.length < 6) return null;
  const sections = extractSectionKeywords(repoRoot, workflow.phase);
  if (!sections.length) return null;
  const overlap = words.some((w) => sections.some((s) => s.includes(w) || w.includes(s)));
  if (overlap) return null;
  return (
    `Prompt shares no keywords with active phase "${workflow.phase}" spec sections ` +
    `(${sections.slice(0, 5).join(", ")}${sections.length > 5 ? ", …" : ""}). ` +
    `Looks off-topic from the current slice plan.`
  );
}

/**
 * Crude section-keyword extractor for drift detection. Reads phase sections
 * list from spec-index.yaml, looks them up in the spec doc headings.
 *
 * Line-based parse so we avoid \Z bugs that plague JS regex multiline mode.
 */
function extractSectionKeywords(repoRoot, phase) {
  try {
    const y = safeRead(join(repoRoot, "spec-index.yaml"));
    if (!y) return [];
    // Find the "<phase>:" child line under "phases:" and capture its block body
    const yLines = y.split(/\r?\n/);
    let i = 0;
    while (i < yLines.length && !/^phases\s*:\s*$/.test(yLines[i])) i++;
    if (i >= yLines.length) return [];
    i++;
    const phaseHeader = new RegExp(`^(\\s+)${phase}:\\s*$`);
    let phaseIndent = null;
    while (i < yLines.length) {
      const m = yLines[i].match(phaseHeader);
      if (m) { phaseIndent = m[1].length; break; }
      i++;
    }
    if (phaseIndent === null) return [];
    const body = [];
    for (let j = i + 1; j < yLines.length; j++) {
      const ln = yLines[j];
      if (ln === "") { body.push(ln); continue; }
      const leading = ln.match(/^(\s*)/)[1].length;
      if (leading > phaseIndent) { body.push(ln); continue; }
      break;
    }
    const phaseBlock = body.join("\n");
    const sectionsRaw = phaseBlock.match(/sections:\s*\[([^\]]+)\]/);
    if (!sectionsRaw) return [];
    const ids = sectionsRaw[1].split(",").map((s) => s.trim()).filter(Boolean);
    const specM = y.match(/^spec:\s*(.+)$/m);
    if (!specM) return ids.map((s) => `§${s}`);
    const specPath = join(repoRoot, specM[1].trim());
    const spec = safeRead(specPath);
    if (!spec) return ids.map((s) => `§${s}`);
    const keywords = new Set();
    for (const id of ids) {
      const re = new RegExp(`^#+\\s*(?:§\\s*)?${id.replace(/\./g, "\\.")}[\\s.:-]+(.+)$`, "m");
      const hm = spec.match(re);
      if (hm) {
        hm[1].toLowerCase().split(/\W+/).filter((w) => w.length >= 4).forEach((w) => keywords.add(w));
      }
    }
    return Array.from(keywords);
  } catch {
    return [];
  }
}

/**
 * Classify user prompt intent so the protocol can be strengthened.
 *   "coding"  — user wants to add/build/implement/fix/refactor code
 *   "promote" — user wants to promote or verify a phase
 *   "trivial" — typo/rename/comment-only change (V5-R007 exempt)
 *   "none"    — read/search/ask questions, no strengthening needed
 */
function classifyIntent(prompt) {
  if (!prompt) return "none";
  const p = prompt.toLowerCase();
  if (/\b(phase-promote|\/phase-promote|promote phase|verified)\b/.test(p)) return "promote";
  if (/\b(typo|rename|comment[- ]only|reword|reformat)\b/.test(p)) return "trivial";
  if (/\b(add|build|implement|create|fix|feature|phase|slice|step|task|write code|refactor|module|component|endpoint|service|handler|function)\b/.test(p)) {
    return "coding";
  }
  return "none";
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  setTimeout(() => process.exit(0), 3000).unref();
  const t = setTimeout(() => { try { process.stdin.destroy(); } catch {} }, 1500);
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    clearTimeout(t);
    return raw ? JSON.parse(raw) : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

main().catch(() => process.exit(0));
