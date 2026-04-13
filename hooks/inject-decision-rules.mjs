#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject auto-decision guidance based on rule registry.
 *
 * Rule IDs: V5-R057 (decision mode), V5-R058 (auto-decision audit)
 *
 * Purpose: reduce ceremonial questions from skills (deep-interview rounds,
 * ralplan revision prompts, autopilot pause points) by telling the agent
 * which rule-based decisions to apply WITHOUT asking the user.
 *
 * Injects a <decision-guidance> block listing:
 *   - auto_apply rules (fix root cause, TDD-first, etc) → agent decides silently
 *   - user_choice topics (scope priority, oversight level) → agent still asks
 *
 * Config in spec-index.yaml:
 *   decisions:
 *     enabled: true
 *     auto_apply:
 *       - V5-R011   # fix root cause, not symptoms
 *       - V5-R030   # TDD-first ordering
 *       - V5-R053   # commit-prefix exclusions
 *       - V5-R054   # session-mode verification
 *     constraint_defaults:
 *       - hot_path_purity
 *       - session_ended_trigger
 *       - model_reuse
 *       - bounded_backoff
 *     user_choice:
 *       - scope_prioritization
 *       - oversight_level
 *       - external_api_design
 *
 * Bypass: env CLAUDE_SKIP_HOOKS=1 or `decisions.enabled: false`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULTS = {
  enabled: true,
  auto_apply: ["V5-R011", "V5-R030", "V5-R053", "V5-R054"],
  constraint_defaults: [
    "hot_path_purity",
    "session_ended_trigger",
    "model_reuse",
    "bounded_backoff",
  ],
  user_choice: [
    "scope_prioritization",
    "oversight_level",
    "external_api_design",
  ],
};

const CONSTRAINT_DESCRIPTIONS = {
  hot_path_purity: "hot-path reads (cache.get/inject) stay pure — no breakers/retries in hot path",
  session_ended_trigger: "LLM-heavy work (consolidation, summarization) fires on session.ended, not periodic timers",
  model_reuse: "reuse existing models (gemma4:e2b, BGE-M3) before adding a new model dependency",
  bounded_backoff: "reconnect backoff = exponential 1s→30s cap; replay window bounded (~60s) with defined loss",
  structured_logging: "all decisions/errors logged with rule-id context (e.g., 'auto-decided by V5-R011')",
};

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) process.exit(0);

  const cfg = readDecisionConfig(repoRoot);
  if (!cfg.enabled) process.exit(0);

  const ruleDescriptions = loadRuleDescriptions(repoRoot, cfg.auto_apply);
  const guidance = buildGuidance(cfg, ruleDescriptions);

  // Emit to stderr so Claude Code picks it up as additional context
  const out = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: guidance,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function buildGuidance(cfg, ruleDescriptions) {
  const lines = [];
  lines.push("<decision-guidance>");
  lines.push("");
  lines.push("Auto-apply these rules WITHOUT asking the user. Log 'auto-decided by <rule-id>' in commit body or response.");
  lines.push("");
  if (cfg.auto_apply.length) {
    lines.push("Rule-based auto-decisions:");
    for (const id of cfg.auto_apply) {
      const desc = ruleDescriptions[id] || "(see rules/" + id + ".yaml)";
      lines.push(`  - ${id}: ${desc}`);
    }
    lines.push("");
  }
  if (cfg.constraint_defaults.length) {
    lines.push("Technical defaults (auto-pick, no need to multi-select):");
    for (const d of cfg.constraint_defaults) {
      const desc = CONSTRAINT_DESCRIPTIONS[d] || d;
      lines.push(`  - ${d}: ${desc}`);
    }
    lines.push("");
  }
  if (cfg.user_choice.length) {
    lines.push("TRUE user-preference topics — STILL ask, do NOT auto-decide:");
    for (const t of cfg.user_choice) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }
  lines.push("Guidance for skills (deep-interview, ralplan, autopilot):");
  lines.push("  - If a pause/question maps to a rule in auto_apply → decide per rule, skip the prompt.");
  lines.push("  - If multi-select defaults all fall under constraint_defaults → pick all, show summary not menu.");
  lines.push("  - If topic is in user_choice → ask user (legitimate preference).");
  lines.push("  - Contrarian/drift-check rounds after a decision is already made → skip unless user explicitly asks.");
  lines.push("");
  lines.push("Audit (V5-R058): every auto-decision must be traceable. Include rule-id in commit body or response text.");
  lines.push("Bypass: set decisions.enabled=false in spec-index.yaml if user wants fully interactive mode.");
  lines.push("</decision-guidance>");
  return lines.join("\n");
}

function readDecisionConfig(repoRoot) {
  const yamlPath = join(repoRoot, "spec-index.yaml");
  if (!existsSync(yamlPath)) return DEFAULTS;
  try {
    const yaml = readFileSync(yamlPath, "utf8");
    const block = extractTopLevelBlock(yaml, "decisions");
    if (!block) return DEFAULTS;
    const enabled = !/^\s+enabled:\s*false/m.test(block);
    return {
      enabled,
      auto_apply: parseListField(block, "auto_apply") ?? DEFAULTS.auto_apply,
      constraint_defaults: parseListField(block, "constraint_defaults") ?? DEFAULTS.constraint_defaults,
      user_choice: parseListField(block, "user_choice") ?? DEFAULTS.user_choice,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Extract a top-level YAML block (e.g. "decisions:") — returns the indented
 * body lines concatenated. Stops at the next top-level key or EOF.
 */
function extractTopLevelBlock(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  const startRe = new RegExp(`^${key}:\\s*$`);
  let i = 0;
  while (i < lines.length && !startRe.test(lines[i])) i++;
  if (i >= lines.length) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    const ln = lines[j];
    if (ln === "" || /^\s/.test(ln)) {
      body.push(ln);
    } else {
      break;
    }
  }
  return body.join("\n");
}

function parseListField(block, key) {
  // Inline: key: [a, b, c]
  const inline = block.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
  if (inline) {
    return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  // Block: key:\n  - a\n  - b
  const re = new RegExp(`${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`);
  const m = block.match(re);
  if (!m) return null;
  return m[1].split("\n").filter(Boolean).map((l) =>
    l.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, "")
  ).filter(Boolean);
}

function loadRuleDescriptions(repoRoot, ids) {
  const out = {};
  for (const id of ids) {
    // Look first in <repo>/rules/, then node_modules
    const candidates = [
      join(repoRoot, "rules", `${id}.yaml`),
      join(repoRoot, "node_modules", "@agentic-gateway", "mega-template", "rules", `${id}.yaml`),
    ];
    for (const c of candidates) {
      if (!existsSync(c)) continue;
      try {
        const content = readFileSync(c, "utf8");
        const title = content.match(/^title:\s*(.+)$/m);
        if (title) {
          out[id] = title[1].trim();
          break;
        }
      } catch {}
    }
  }
  return out;
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
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:inject-decision-rules] hook crash: ${e.message}`);
  process.exit(0);
});
