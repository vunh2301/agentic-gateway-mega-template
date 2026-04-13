#!/usr/bin/env node
/**
 * PreToolUse hook: require @spec() annotation in new src files.
 *
 * Rule IDs: V5-R012 (traceability)
 *
 * When creating a NEW file (Write, not Edit on existing) under
 * packages/*\/src/, check the content contains an @spec() annotation:
 *   // @spec(phase=1,section=3.2)
 *   /** @spec(phase=1,req=V5-R001) *\/
 *
 * Edits to EXISTING files are exempt (annotation may exist elsewhere in file).
 *
 * R-PLUGIN-001: fail-open on crash. Exit 2 = deny, 0 = allow.
 */

async function main() {
  if (process.env.CLAUDE_SKIP_HOOKS === "1") process.exit(0);

  const payload = await readStdinJson();
  if (!payload) process.exit(0);

  const toolName = payload.tool_name;
  const filePath = payload?.tool_input?.file_path;
  const content = payload?.tool_input?.content || payload?.tool_input?.new_string || "";

  if (!filePath) process.exit(0);

  // Only enforce on Write (new files). Edit = exempt (existing file, annotation may be elsewhere).
  if (toolName !== "Write") process.exit(0);

  const p = filePath.replace(/\\/g, "/");
  if (isExempt(p)) process.exit(0);

  // Only target TS/JS source under packages/*/src/
  if (!/\/packages\/[^/]+\/src\/.+\.(ts|tsx|mjs|js|cjs)$/.test(p)) {
    process.exit(0);
  }

  // Skip test files (already exempted above by isExempt, but double-check)
  if (/\.(test|spec)\./.test(p)) process.exit(0);

  // Check for @spec annotation in content
  const specPattern = /@spec\s*\(\s*(phase|section|req)\s*=/;
  if (!specPattern.test(content)) {
    console.error(
      `[mega:spec-coverage] BLOCKED: new src file without @spec annotation (V5-R012).\n` +
      `  File: ${p}\n` +
      `  Required: add a comment with @spec(phase=X,section=Y.Z) or @spec(phase=X,req=V5-R001)\n` +
      `  Example:\n` +
      `    /** @spec(phase=1,section=3.2,req=V5-R012) */\n` +
      `    export class Extractor { ... }\n` +
      `  Bypass: CLAUDE_SKIP_HOOKS=1 (document in commit).`
    );
    process.exit(2);
  }

  process.exit(0);
}

function isExempt(p) {
  return /\/(\.claude|docs|\.git)\//.test(p) ||
         /\/(tests?|__tests__)\//.test(p) ||
         /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(p) ||
         /^[^/]*\.(md|json|yaml|yml)$/i.test(p);
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

main().catch((e) => {
  console.error(`[mega:spec-coverage] hook crash: ${e.message}`);
  process.exit(0);
});
