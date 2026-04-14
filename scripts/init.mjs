#!/usr/bin/env node
/**
 * mega-template-init — bootstrap a consumer repo with the enforcement layer.
 *
 * Usage:
 *   # Interactive (default):
 *   npx -p @agentic-gateway/mega-template mega-template-init
 *
 *   # Non-interactive (CI-safe, uses defaults or --flags):
 *   npx -p @agentic-gateway/mega-template mega-template-init \
 *       --non-interactive \
 *       --project my-consumer \
 *       --package memory-consumer \
 *       --phase phase-1 \
 *       --sections 2,3,4,5 \
 *       --spec docs/memory-consumer-spec.md
 *
 * What it does:
 *   1. Verify cwd is a git repo (fail if not)
 *   2. Auto-detect plugin location (npm vs Claude Code marketplace)
 *   3. Generate .claude/settings.json (hooks wired to detected path)
 *   4. Generate CLAUDE.md, AGENTS.md, PROGRESS.md, spec-index.yaml
 *   5. Append to .gitignore if needed
 *   6. Print next-steps guide
 *
 * Idempotent: skips existing files (does NOT overwrite; delete first to regen).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(__dirname);
const templatesDir = join(pluginRoot, "templates");

function parseArgs(argv) {
  const out = { nonInteractive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--non-interactive" || a === "-n") out.nonInteractive = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--package") out.package = argv[++i];
    else if (a === "--phase") out.phase = argv[++i];
    else if (a === "--sections") out.sections = argv[++i];
    else if (a === "--spec") out.spec = argv[++i];
    else if (a === "--layout") out.layout = argv[++i];  // flat | monorepo
    else if (a === "--no-git-init") out.noGitInit = true;
    else if (a === "--help" || a === "-h") {
      console.log("See top of init.mjs for usage");
      process.exit(0);
    }
  }
  return out;
}

/**
 * Detect how the plugin is installed so settings.json references correct
 * hook paths. Returns a path prefix like "node_modules/@agentic-gateway/..."
 * or ".claude/plugins/marketplaces/..." depending on install layout.
 *
 * Detection order:
 *   1. `pluginRoot` contains "node_modules" → npm install path
 *   2. `pluginRoot` contains "plugins/cache" or "marketplaces" → CC plugin
 *   3. Else: absolute path (fallback, less portable)
 */
function detectHookPathPrefix(cwd) {
  const root = pluginRoot.replace(/\\/g, "/");
  const cwdN = cwd.replace(/\\/g, "/");

  if (root.includes("/node_modules/")) {
    return "node_modules/@agentic-gateway/mega-template/hooks";
  }
  if (root.includes("/plugins/cache/") || root.includes("/plugins/marketplaces/")) {
    // Claude Code plugin — use absolute path (works regardless of consumer cwd)
    return root + "/hooks";
  }
  // Dev fallback: relative from consumer to plugin repo
  if (root.startsWith(cwdN)) {
    return root.slice(cwdN.length + 1) + "/hooks";
  }
  return root + "/hooks";
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  // 1. Verify git repo (auto-init if missing, unless opted out)
  if (!existsSync(join(cwd, ".git"))) {
    if (args.noGitInit) {
      console.error(`[init] ERROR: ${cwd} is not a git repo and --no-git-init was set.`);
      process.exit(1);
    }
    console.log(`[init] no .git/ found — running 'git init' (use --no-git-init to opt out)`);
    try {
      execSync("git init", { cwd, stdio: "inherit" });
    } catch (e) {
      console.error(`[init] ERROR: 'git init' failed: ${e.message}`);
      process.exit(1);
    }
  }

  console.log(`\n[mega-template-init] bootstrapping consumer repo at ${cwd}\n`);

  const hookPrefix = detectHookPathPrefix(cwd);
  console.log(`[init] detected plugin path: ${hookPrefix}`);

  let projectName, activePackage, activePhase, activeSections, specPath, layout;

  if (args.nonInteractive) {
    projectName = args.project || "my-consumer";
    activePackage = args.package || "memory-consumer";
    activePhase = args.phase || "phase-1";
    activeSections = args.sections || "2,3,4,5,6,7";
    specPath = args.spec || `docs/${activePackage}-spec.md`;
    layout = args.layout || "monorepo";
    if (!["flat", "monorepo"].includes(layout)) {
      console.error(`[init] ERROR: --layout must be 'flat' or 'monorepo' (got '${layout}')`);
      process.exit(1);
    }
    console.log(`[init] non-interactive: ${JSON.stringify({ projectName, activePackage, activePhase, activeSections, specPath, layout })}`);
  } else {
    const rl = readline.createInterface({ input, output });
    const ask = async (q, def = "") => {
      const a = (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim();
      return a || def;
    };

    projectName = await ask("Project name", args.project || "my-consumer");
    activePackage = await ask("Active package name", args.package || "memory-consumer");
    activePhase = await ask("Active phase name", args.phase || "phase-1");
    activeSections = await ask("Sections in active phase (comma-separated)", args.sections || "2,3,4,5,6,7");
    specPath = await ask("Spec document path", args.spec || `docs/${activePackage}-spec.md`);
    layout = await ask("Layout (flat | monorepo)", args.layout || "monorepo");
    if (!["flat", "monorepo"].includes(layout)) {
      console.error(`[init] ERROR: layout must be 'flat' or 'monorepo'`);
      await rl.close();
      process.exit(1);
    }
    await rl.close();
  }

  // Path patterns based on layout
  const activePaths = layout === "flat"
    ? ["src/**", "tests/**"]
    : [`packages/${activePackage}/src/**`, `packages/${activePackage}/tests/**`];

  // TDD config based on layout
  const tddSrcPatterns = layout === "flat"
    ? ["src/**"]
    : [`packages/${activePackage}/src/**`];
  const tddConventions = layout === "flat"
    ? [
        { pattern: "^src/(.*)\\.ts$", test: "tests/$1.test.ts" },
        { pattern: "^src/(.*)\\.ts$", test: "test/$1.test.ts" },
        { pattern: "^src/(.*)\\.ts$", test: "src/$1.test.ts" },
      ]
    : [
        { pattern: `^packages/${activePackage}/src/(.*)\\.ts$`, test: `packages/${activePackage}/tests/$1.test.ts` },
        { pattern: `^packages/${activePackage}/src/(.*)\\.ts$`, test: `packages/${activePackage}/test/$1.test.ts` },
      ];

  const ctx = {
    PROJECT_NAME: projectName,
    ACTIVE_PACKAGE: activePackage,
    ACTIVE_PHASE: activePhase,
    ACTIVE_SECTIONS: activeSections,
    SPEC_PATH: specPath,
    LAYOUT: layout,
    ACTIVE_PATHS: activePaths.map((p) => `      - ${p}`).join("\n"),
    TDD_SRC_PATTERNS: tddSrcPatterns.map((p) => `"${p}"`).join(", "),
    TDD_CONVENTIONS: tddConventions
      .map((c) => `    - pattern: "${c.pattern.replace(/\\/g, "\\\\")}"\n      test: "${c.test}"`)
      .join("\n"),
    DATE: new Date().toISOString().slice(0, 10),
    PACKAGES_CSV: activePackage,
    PACKAGES_TABLE:
      `| ${activePackage} | in-progress | ${specPath} |`,
    PHASE1_DESC: `Core of ${activePackage}`,
    PHASE2_DESC: `(define in spec-index.yaml)`,
  };

  // 2. .claude/settings.json
  const claudeDir = join(cwd, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const settings = generateSettings(hookPrefix);
  writeIfAbsent(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  // 3-5. Generate files from templates
  const filesToGen = [
    { tpl: "CLAUDE.md.tpl", out: "CLAUDE.md" },
    { tpl: "AGENTS.md.tpl", out: "AGENTS.md" },
    { tpl: "PROGRESS.md.tpl", out: "PROGRESS.md" },
    { tpl: "spec-index.yaml.tpl", out: "spec-index.yaml" },
  ];

  for (const { tpl, out } of filesToGen) {
    const tplPath = join(templatesDir, tpl);
    if (!existsSync(tplPath)) {
      console.warn(`[init] WARN: template ${tpl} missing, skipping`);
      continue;
    }
    const content = renderTemplate(readFileSync(tplPath, "utf8"), ctx);
    writeIfAbsent(join(cwd, out), content);
  }

  // 6. .gitignore additions
  const gitignorePath = join(cwd, ".gitignore");
  const ignoreAdds = [
    "",
    "# mega-template additions",
    ".claude/settings.local.json",
    "docs/specs/",
    "docs/plans/",
    ".omc/",
    ".superpowers/",
  ].join("\n") + "\n";

  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf8");
    if (!existing.includes("mega-template additions")) {
      appendFileSync(gitignorePath, ignoreAdds);
      console.log(`[init] updated .gitignore`);
    }
  } else {
    writeFileSync(gitignorePath, "node_modules/\ndist/\n*.log\n" + ignoreAdds);
    console.log(`[init] created .gitignore`);
  }

  // Done
  console.log("\n[mega-template-init] DONE.\n");
  console.log("Next steps:");
  console.log("  1. Review generated CLAUDE.md, PROGRESS.md, spec-index.yaml");
  console.log("  2. Write your real spec at", specPath);
  console.log("  3. Commit: git add . && git commit -m 'infra: bootstrap mega-template'");
  console.log("  4. Start work: tell Claude 'Start " + activePackage + " " + activePhase + "'");
  console.log("");
}

function generateSettings(hookPrefix) {
  const h = hookPrefix;
  return {
    permissions: { allow: ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)", "Glob(*)", "Grep(*)", "Skill(*)", "Agent(*)"] },
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            { type: "command", command: `node ${h}/load-context.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/inject-decision-rules.mjs`, timeout: 5000 },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            { type: "command", command: `node ${h}/check-spec.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/check-phase-gate.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/check-spec-coverage.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/enforce-tdd.mjs`, timeout: 5000 },
          ],
        },
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: `node ${h}/check-review-evidence.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/enforce-slice-order.mjs`, timeout: 5000 },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: `node ${h}/require-tests.mjs`, timeout: 60000 },
            { type: "command", command: `node ${h}/check-e2e-real.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/enforce-verification.mjs`, timeout: 5000 },
          ],
        },
      ],
      SessionEnd: [
        { hooks: [{ type: "command", command: `node ${h}/orphan-sweep.mjs`, timeout: 10000 }] },
      ],
    },
  };
}

function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
}

/**
 * Write file only if absent. Existing files are NEVER overwritten — user
 * must delete manually to regenerate. This is idempotent by design: repeat
 * runs of init.mjs are safe and never clobber edits.
 */
function writeIfAbsent(path, content) {
  if (existsSync(path)) {
    console.log(`[init] ${path} already exists — skipping (delete first to regenerate)`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`[init] wrote ${path}`);
}

main().catch((e) => {
  console.error(`[init] FAILED: ${e.message}`);
  process.exit(1);
});
