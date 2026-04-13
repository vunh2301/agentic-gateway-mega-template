#!/usr/bin/env node
/**
 * mega-template-init — bootstrap a consumer repo with the enforcement layer.
 *
 * Usage:
 *   cd <consumer-repo>
 *   npx -p @agentic-gateway/mega-template mega-template-init
 *
 * What it does:
 *   1. Verify cwd is a git repo (fail if not)
 *   2. Copy .claude/settings.json (with hooks wired to plugin path)
 *   3. Generate CLAUDE.md from templates/CLAUDE.md.tpl (interactive prompts)
 *   4. Generate AGENTS.md, PROGRESS.md, spec-index.yaml
 *   5. Append to .gitignore if needed
 *   6. Print next-steps guide
 *
 * Idempotent: if files exist, prompts before overwriting.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(__dirname);
const templatesDir = join(pluginRoot, "templates");

async function main() {
  const cwd = process.cwd();

  // 1. Verify git repo
  if (!existsSync(join(cwd, ".git"))) {
    console.error(`[init] ERROR: ${cwd} is not a git repo. Run 'git init' first.`);
    process.exit(1);
  }

  console.log(`\n[mega-template-init] bootstrapping consumer repo at ${cwd}\n`);

  const rl = readline.createInterface({ input, output });
  const ask = async (q, def = "") => {
    const a = (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim();
    return a || def;
  };

  // Interactive prompts
  const projectName = await ask("Project name", "my-consumer");
  const activePackage = await ask("Active package name", "memory-consumer");
  const activePhase = await ask("Active phase name", "phase-1");
  const activeSections = await ask("Sections in active phase (comma-separated)", "2,3,4,5,6,7");
  const specPath = await ask("Spec document path", `docs/${activePackage}-spec.md`);

  const ctx = {
    PROJECT_NAME: projectName,
    ACTIVE_PACKAGE: activePackage,
    ACTIVE_PHASE: activePhase,
    ACTIVE_SECTIONS: activeSections,
    SPEC_PATH: specPath,
    DATE: new Date().toISOString().slice(0, 10),
    PACKAGES_CSV: activePackage,
    PACKAGES_TABLE:
      `| ${activePackage} | in-progress | ${specPath} |`,
    PHASE1_DESC: `Core of ${activePackage}`,
    PHASE2_DESC: `(define in spec-index.yaml)`,
  };

  await rl.close();

  // 2. .claude/settings.json
  const claudeDir = join(cwd, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const settings = generateSettings(pluginRoot);
  writeIfAbsentOrConfirm(settingsPath, JSON.stringify(settings, null, 2) + "\n");

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
    writeIfAbsentOrConfirm(join(cwd, out), content);
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

function generateSettings(pluginRoot) {
  // Use relative paths via node resolution (plugin in node_modules)
  const h = "node_modules/@agentic-gateway/mega-template/hooks";
  return {
    permissions: { allow: ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)", "Glob(*)", "Grep(*)", "Skill(*)", "Agent(*)"] },
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: `node ${h}/load-context.mjs`, timeout: 5000 }] },
      ],
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            { type: "command", command: `node ${h}/check-spec.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/check-phase-gate.mjs`, timeout: 5000 },
            { type: "command", command: `node ${h}/check-spec-coverage.mjs`, timeout: 5000 },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `node ${h}/require-tests.mjs`, timeout: 60000 }],
        },
      ],
    },
  };
}

function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
}

function writeIfAbsentOrConfirm(path, content) {
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
