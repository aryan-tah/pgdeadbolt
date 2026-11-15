// Claude Code PostToolUse hook: after Claude writes or edits a .sql migration,
// run pgdeadbolt on it. Errors block and hand Claude the safe rewrite; warnings
// are added as context without blocking. No dependencies: it shells out to the
// pgdeadbolt CLI (npx, or PGDEADBOLT_BIN for a local build).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Which paths count as migrations. Override with PGDEADBOLT_PATHS (a regex). */
const MIGRATION_PATH = new RegExp(process.env.PGDEADBOLT_PATHS ?? "(migrat|/db/|/sql/)", "i");

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function check(file) {
  const args = ["check", file, "--format", "json"];
  if (process.env.PGDEADBOLT_PG_VERSION) args.push("--pg-version", process.env.PGDEADBOLT_PG_VERSION);
  if (process.env.PGDEADBOLT_IN_TRANSACTION === "1") args.push("--in-transaction");
  const [cmd, cmdArgs] = process.env.PGDEADBOLT_BIN
    ? [process.execPath, [process.env.PGDEADBOLT_BIN, ...args]]
    : ["npx", ["--yes", "pgdeadbolt@^0.1.0", ...args]];
  try {
    const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    // Exit code 1 means "found errors", and stdout still holds the report.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {}
    }
    return { error: (err.stderr || err.message || "").toString().trim() };
  }
}

function describe(f) {
  return [
    `- ${f.file}:${f.line}  [${f.rule}${f.lock ? `, takes ${f.lock}` : ""}] ${f.message}`,
    `  Why: ${f.why}`,
    `  Safe version:\n${f.fix
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n")}`,
  ].join("\n");
}

const input = JSON.parse((await readStdin()) || "{}");
const file = input.tool_input?.file_path ?? input.tool_input?.path;
if (!file?.endsWith(".sql") || !MIGRATION_PATH.test(file)) process.exit(0);

const report = await check(file);
if (report.error) {
  // Never block Claude because the checker itself couldn't run.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `pgdeadbolt couldn't check ${file}: ${report.error}`,
      },
    }),
  );
  process.exit(0);
}

const findings = (report.results ?? []).flatMap((r) => r.findings ?? []);
const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");

if (errors.length) {
  console.log(
    JSON.stringify({
      decision: "block",
      reason: [
        `pgdeadbolt: this migration would lock production tables. Rewrite it using the safe versions below, then save it again.`,
        "",
        ...errors.map(describe),
        ...(warnings.length ? ["", "Also worth fixing:", ...warnings.map(describe)] : []),
        "",
        "If a finding is a false positive (for example, the table is known to be tiny), add `-- pgdeadbolt-ignore <rule>` on the line above that statement and say why in a comment.",
      ].join("\n"),
    }),
  );
} else if (warnings.length) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: ["pgdeadbolt warnings for this migration:", ...warnings.map(describe)].join("\n"),
      },
    }),
  );
}
