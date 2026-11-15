import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { type AnalyzeResult, analyze } from "./analyze.js";
import { loadConfig } from "./config.js";
import { type Format, format } from "./format.js";
import { VERSION } from "./index.js";
import { ParseError } from "./parse.js";
import { rehearseCommand } from "./rehearse/cli.js";
import { REQUIRE_LOCK_TIMEOUT, rules } from "./rules/index.js";

const HELP = `pgdeadbolt ${VERSION}
Stop Postgres migrations that lock your tables.

Usage
  pgdeadbolt check [paths...]   Check .sql files or directories (default: current directory)
  pgdeadbolt check -            Read SQL from stdin
  pgdeadbolt rules              List every rule
  pgdeadbolt rehearse <file>    Run a migration on a disposable Postgres and measure blocking
                                (see pgdeadbolt rehearse --help)

Options
  --pg-version <n>        Postgres major version the migration runs on (default 16)
  --in-transaction        Your migration tool wraps each file in a transaction
  --ignore <rule,...>     Turn rules off
  --format <f>            pretty | json | github | sarif (default pretty; github inside GitHub Actions)
  --fail-on-warning       Exit 1 on warnings, not just errors
  -h, --help              Show this help
  -v, --version           Show the version

Config: pgdeadbolt.config.json, or a "pgdeadbolt" key in package.json.
Ignore one statement:  -- pgdeadbolt-ignore rule-id   (on the line above)
Docs: https://pgdeadbolt.aryantah.com`;

function collect(path: string, out: string[]) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      collect(join(path, entry), out);
    }
  } else if (path.endsWith(".sql")) out.push(path);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "rehearse") return rehearseCommand(argv.slice(1));
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "pg-version": { type: "string" },
        "in-transaction": { type: "boolean" },
        ignore: { type: "string" },
        format: { type: "string" },
        "fail-on-warning": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [command = "check", ...rest] = positionals;
  if (values.help || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === "rules") {
    for (const r of [...rules, REQUIRE_LOCK_TIMEOUT])
      console.log(`${r.id.padEnd(30)} ${r.severity.padEnd(8)} ${r.summary}`);
    return 0;
  }
  if (command !== "check") {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }

  const config = loadConfig(process.cwd());
  const pgVersion = Number(values["pg-version"] ?? config.pgVersion ?? 16);
  if (!Number.isInteger(pgVersion) || pgVersion < 9) {
    console.error(`--pg-version must be a Postgres major version like 16, got "${values["pg-version"]}".`);
    return 2;
  }
  const options = {
    pgVersion,
    inTransaction: Boolean(values["in-transaction"] ?? config.inTransaction ?? false),
    ignore: [
      ...(config.ignore ?? []),
      ...String(values.ignore ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  };
  const fmt = (values.format ?? (process.env.GITHUB_ACTIONS === "true" ? "github" : "pretty")) as Format;
  if (!["pretty", "json", "github", "sarif"].includes(fmt)) {
    console.error(`--format must be pretty, json, github or sarif.`);
    return 2;
  }

  const results: AnalyzeResult[] = [];
  let failed = false;
  if (rest[0] === "-") {
    results.push(await analyze(await readStdin(), { ...options, file: "<stdin>" }));
  } else {
    const files: string[] = [];
    for (const p of rest.length ? rest : ["."]) {
      try {
        collect(p, files);
      } catch {
        console.error(`No such file or directory: ${p}`);
        return 2;
      }
    }
    if (!files.length) {
      console.error("No .sql files found.");
      return 2;
    }
    for (const file of files.sort()) {
      const name = relative(process.cwd(), file) || file;
      try {
        results.push(await analyze(readFileSync(file, "utf8"), { ...options, file: name }));
      } catch (err) {
        if (err instanceof ParseError) {
          console.error(`${name}:${err.line}:${err.column}  could not parse: ${err.message}`);
          failed = true;
        } else throw err;
      }
    }
  }

  const output = format(results, fmt, VERSION);
  if (output) console.log(output);
  const all = results.flatMap((r) => r.findings);
  const failOnWarning = Boolean(values["fail-on-warning"] ?? config.failOnWarning);
  if (failed) return 2;
  return all.some((f) => f.severity === "error" || (failOnWarning && f.severity === "warning")) ? 1 : 0;
}
