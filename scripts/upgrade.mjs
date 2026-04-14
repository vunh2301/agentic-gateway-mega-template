#!/usr/bin/env node
/**
 * mega-template-upgrade — idempotent upgrade for existing consumer repos.
 *
 * Detects what the current version of mega-template declares as the required
 * hook wiring + spec-index.yaml config blocks, and patches the consumer's
 * files to match, WITHOUT overwriting existing content.
 *
 * Usage:
 *   cd <consumer-repo>
 *   npm install @agentic-gateway/mega-template@latest
 *   npx mega-template-upgrade [--dry-run]
 *
 * What it does (idempotent — safe to re-run):
 *   1. Read consumer's .claude/settings.json and spec-index.yaml
 *   2. Compare against the current manifest (hooks + config blocks)
 *   3. Add missing hook entries (match by command-path basename, not full path)
 *   4. Append missing top-level YAML config blocks (review:, decisions:, …)
 *   5. Backup originals to *.bak-<timestamp> before writing
 *   6. Report what changed
 *
 * Idempotency: re-runs on already-upgraded repos produce "No changes needed."
 * User-added custom hooks or config are preserved — only adds what's missing.
 *
 * Rule V5-R049: setup must self-heal repeatable state bugs.
 * Rule V5-R057: auto-apply rule-based decisions, skip ceremonial prompts.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(__dirname);

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run" || a === "-n") out.dryRun = true;
    if (a === "--help" || a === "-h") {
      console.log("Usage: mega-template-upgrade [--dry-run]");
      process.exit(0);
    }
  }
  return out;
}

/**
 * Same path detection as init.mjs so generated hook commands match the
 * install layout (npm vs Claude Code plugin marketplace vs dev).
 */
function detectHookPathPrefix(cwd) {
  const root = pluginRoot.replace(/\\/g, "/");
  const cwdN = cwd.replace(/\\/g, "/");
  if (root.includes("/node_modules/")) {
    return "node_modules/@agentic-gateway/mega-template/hooks";
  }
  if (root.includes("/plugins/cache/") || root.includes("/plugins/marketplaces/")) {
    return root + "/hooks";
  }
  if (root.startsWith(cwdN)) {
    return root.slice(cwdN.length + 1) + "/hooks";
  }
  return root + "/hooks";
}

/**
 * Authoritative hook manifest. Keep in sync with init.mjs generateSettings().
 * Each entry lists the hook by BASENAME so we can match across install layouts
 * (old prefix → new prefix) without rewriting matching user-customised timeouts.
 */
function buildManifest(h) {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: null,
          entries: [
            { base: "load-context.mjs", command: `node ${h}/load-context.mjs`, timeout: 5000 },
            { base: "inject-decision-rules.mjs", command: `node ${h}/inject-decision-rules.mjs`, timeout: 5000 },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Write|Edit",
          entries: [
            { base: "check-spec.mjs", command: `node ${h}/check-spec.mjs`, timeout: 5000 },
            { base: "check-phase-gate.mjs", command: `node ${h}/check-phase-gate.mjs`, timeout: 5000 },
            { base: "check-spec-coverage.mjs", command: `node ${h}/check-spec-coverage.mjs`, timeout: 5000 },
            { base: "enforce-tdd.mjs", command: `node ${h}/enforce-tdd.mjs`, timeout: 5000 },
          ],
        },
        {
          matcher: "Bash",
          entries: [
            { base: "check-review-evidence.mjs", command: `node ${h}/check-review-evidence.mjs`, timeout: 5000 },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          entries: [
            { base: "require-tests.mjs", command: `node ${h}/require-tests.mjs`, timeout: 60000 },
            { base: "check-e2e-real.mjs", command: `node ${h}/check-e2e-real.mjs`, timeout: 5000 },
            { base: "enforce-verification.mjs", command: `node ${h}/enforce-verification.mjs`, timeout: 5000 },
          ],
        },
      ],
      SessionEnd: [
        {
          matcher: null,
          entries: [
            { base: "orphan-sweep.mjs", command: `node ${h}/orphan-sweep.mjs`, timeout: 10000 },
          ],
        },
      ],
    },
    configBlocks: [
      {
        key: "review",
        defaultContent: `# === Independent Review Gate (v0.4.0) ===
# Rules V5-R055, V5-R056. Blocks \`phase-promote:\` commits and
# \`phase-*-verified\` tags unless each required reviewer has produced
# an artifact with an accepted verdict.
review:
  enabled: true
  required: [reviewer, verifier, critic]
  artifact_dir: .omc/reviews
  accept_verdicts: [approved, approved-with-notes]`,
      },
      {
        key: "decisions",
        defaultContent: `# === Decision Mode (v0.5.0) ===
# Rules V5-R057, V5-R058. Agent auto-applies rule-based decisions and
# skips ceremonial questions. Disable by \`enabled: false\` for fully
# interactive mode.
decisions:
  enabled: true
  auto_apply:
    - V5-R011   # fix root cause over band-aid
    - V5-R030   # TDD-first ordering
    - V5-R053   # commit-prefix exclusions for docs/chore/etc
    - V5-R054   # session-mode verification
  constraint_defaults:
    - hot_path_purity
    - session_ended_trigger
    - model_reuse
    - bounded_backoff
  user_choice:
    - scope_prioritization
    - oversight_level
    - external_api_design`,
      },
    ],
  };
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const settingsPath = join(cwd, ".claude", "settings.json");
  const specPath = join(cwd, "spec-index.yaml");

  if (!existsSync(settingsPath) || !existsSync(specPath)) {
    console.error(
      `[upgrade] ERROR: not a mega-template consumer repo.\n` +
      `  Expected: .claude/settings.json + spec-index.yaml in ${cwd}.\n` +
      `  Run \`npx mega-template-init\` first, or cd to your consumer repo.`,
    );
    process.exit(1);
  }

  const hookPrefix = detectHookPathPrefix(cwd);
  console.log(`[upgrade] detected plugin path: ${hookPrefix}\n`);

  const manifest = buildManifest(hookPrefix);

  // Load current state
  const settingsRaw = readFileSync(settingsPath, "utf8");
  const settings = JSON.parse(settingsRaw);
  const specYaml = readFileSync(specPath, "utf8");

  const changes = [];

  // === 1. Patch settings.json hooks ===
  settings.hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    settings.hooks[event] = settings.hooks[event] || [];
    for (const group of groups) {
      const matcher = group.matcher;
      // Find an existing group with the same matcher (or no matcher)
      let existingGroup = settings.hooks[event].find((g) => {
        if (matcher === null) return !("matcher" in g) || g.matcher == null;
        return g.matcher === matcher;
      });
      if (!existingGroup) {
        existingGroup = matcher === null ? { hooks: [] } : { matcher, hooks: [] };
        settings.hooks[event].push(existingGroup);
        changes.push(
          `+ .claude/settings.json: added ${event}${matcher ? ` (matcher=${matcher})` : ""} group`,
        );
      }
      existingGroup.hooks = existingGroup.hooks || [];
      for (const entry of group.entries) {
        const already = existingGroup.hooks.some((h) => {
          const b = basename((h.command || "").replace(/\\/g, "/").split(/\s+/).pop() || "");
          return b === entry.base;
        });
        if (!already) {
          existingGroup.hooks.push({ type: "command", command: entry.command, timeout: entry.timeout });
          changes.push(
            `+ .claude/settings.json: added ${event}${matcher ? `/${matcher}` : ""} → ${entry.base}`,
          );
        }
      }
    }
  }

  // === 2. Patch spec-index.yaml config blocks ===
  let newYaml = specYaml;
  for (const block of manifest.configBlocks) {
    if (!hasTopLevelBlock(newYaml, block.key)) {
      const sep = newYaml.endsWith("\n\n") ? "" : newYaml.endsWith("\n") ? "\n" : "\n\n";
      newYaml += `${sep}${block.defaultContent}\n`;
      changes.push(`+ spec-index.yaml: appended top-level \`${block.key}:\` block`);
    }
  }

  // === 3. Report + write ===
  if (changes.length === 0) {
    console.log("[upgrade] No changes needed — consumer already up to date.\n");
    return;
  }

  console.log("[upgrade] Changes to apply:");
  for (const c of changes) console.log("  " + c);
  console.log("");

  if (args.dryRun) {
    console.log("[upgrade] --dry-run: no files modified.");
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupSettings = settingsPath + `.bak-${ts}`;
  const backupSpec = specPath + `.bak-${ts}`;
  copyFileSync(settingsPath, backupSettings);
  copyFileSync(specPath, backupSpec);

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  writeFileSync(specPath, newYaml);

  console.log(`[upgrade] Wrote ${settingsPath}`);
  console.log(`[upgrade] Wrote ${specPath}`);
  console.log(`[upgrade] Backups: ${basename(backupSettings)} + ${basename(backupSpec)}`);
  console.log(`\n[upgrade] DONE — review the diff and commit if the changes look correct.`);
}

/**
 * Top-level YAML key detector — finds "<key>:" at column 0. Same line-based
 * approach used in hooks/inject-decision-rules.mjs.
 */
function hasTopLevelBlock(yaml, key) {
  const re = new RegExp(`^${key}:\\s*$`, "m");
  return re.test(yaml);
}

main().catch((e) => {
  console.error(`[upgrade] FAILED: ${e.message}`);
  process.exit(1);
});
