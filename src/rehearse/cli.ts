import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { startPostgres } from "./docker.js";
import { rehearse, type StatementResult } from "./index.js";
import { seedTable } from "./seed.js";

export const REHEARSE_HELP = `pgdeadbolt rehearse <migration.sql> [options]
Run a migration against a real, disposable Postgres and measure how long
writes and reads on the same tables would have been blocked.

Options
  --docker                 Start a throwaway Postgres in Docker (uses --pg-version)
  --database-url <url>     Use this database instead (or set DATABASE_URL)
  --pg-version <n>         Postgres version for --docker (default 16)
  --setup <file.sql>       SQL to run first, e.g. your schema
  --seed <table=rows,...>  Fill tables with synthetic rows first, e.g. users=1000000
  --max-block-ms <n>       Exit 1 if any write was blocked longer than this (default 1000)
  --format <f>             pretty | json (default pretty)
  --yes                    Allow a database that isn't on localhost

Never point rehearse at production: it runs the migration for real.`;

const isLocal = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"].includes(host);
  } catch {
    return false;
  }
};

const ms = (n: number) => (n < 1 ? "<1ms" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`);

function prettyRow(r: StatementResult, maxBlock: number): string {
  const first = r.statement.replace(/\s+/g, " ").slice(0, 70);
  const lock = r.locks[0] ? `${r.locks[0].mode} on ${r.locks[0].relation}` : "no table lock";
  const flag = r.writeBlockedMs > maxBlock ? "✖" : r.writeBlockedMs > 50 ? "!" : "✓";
  const lines = [
    `${flag} line ${r.line}  ${first}${r.statement.length > 70 ? "…" : ""}`,
    `    ran ${ms(r.durationMs)} · writes blocked ${ms(r.writeBlockedMs)} · reads blocked ${ms(r.readBlockedMs)} · ${lock}`,
  ];
  if (r.error) lines.push(`    failed: ${r.error}`);
  return lines.join("\n");
}

export async function rehearseCommand(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        docker: { type: "boolean" },
        "database-url": { type: "string" },
        "pg-version": { type: "string" },
        setup: { type: "string" },
        seed: { type: "string" },
        "max-block-ms": { type: "string" },
        format: { type: "string" },
        yes: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${REHEARSE_HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(REHEARSE_HELP);
    return 0;
  }
  const file = positionals[0];
  if (!file) {
    console.error(`Give a migration file to rehearse.\n\n${REHEARSE_HELP}`);
    return 2;
  }
  const sql = readFileSync(file, "utf8");
  const pgVersion = Number(values["pg-version"] ?? 16);
  const maxBlock = Number(values["max-block-ms"] ?? 1000);
  const json = values.format === "json";
  const log = (s: string) => {
    if (!json) console.log(s);
  };

  let url = (values["database-url"] as string | undefined) ?? process.env.DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;
  if (values.docker) {
    log(`Starting Postgres ${pgVersion} in Docker…`);
    const db = await startPostgres(pgVersion);
    url = db.url;
    stop = db.stop;
  } else if (!url) {
    console.error("Use --docker, or give --database-url (or DATABASE_URL) for a disposable database.");
    return 2;
  } else if (!isLocal(url) && !values.yes) {
    console.error(
      "That database isn't on localhost. Rehearse runs the migration for real; pass --yes if it's disposable.",
    );
    return 2;
  }

  try {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      if (values.setup) {
        log(`Running setup ${values.setup}…`);
        await admin.query(readFileSync(values.setup as string, "utf8"));
      }
      for (const pair of String(values.seed ?? "")
        .split(",")
        .filter(Boolean)) {
        const [table, n] = pair.split("=");
        const rows = Number(n);
        if (!table || !Number.isFinite(rows) || rows <= 0) {
          console.error(`--seed expects table=rows, got "${pair}".`);
          return 2;
        }
        log(`Seeding ${rows.toLocaleString("en-US")} rows into ${table}…`);
        await seedTable(admin, table, rows);
      }
    } finally {
      await admin.end();
    }

    log(`Rehearsing ${file}…\n`);
    const results = await rehearse(sql, {
      url: url as string,
      onStatement: (r) => log(prettyRow(r, maxBlock)),
    });
    const worst = Math.max(0, ...results.map((r) => r.writeBlockedMs));
    const failed = results.some((r) => r.error);
    if (json)
      console.log(
        JSON.stringify({ file, maxBlockMs: maxBlock, worstWriteBlockedMs: worst, results }, null, 2),
      );
    else {
      log("");
      log(
        worst > maxBlock
          ? `✖ Writes were blocked for up to ${ms(worst)} (limit ${ms(maxBlock)}).`
          : `✓ Writes were blocked for at most ${ms(worst)} (limit ${ms(maxBlock)}).`,
      );
    }
    if (failed) return 2;
    return worst > maxBlock ? 1 : 0;
  } finally {
    await stop?.();
  }
}
