// Lock benchmark: each common dangerous migration, unsafe vs the pgdeadbolt fix,
// on a fresh table of ROWS rows, measured with `rehearse`. Run after `npm run build`:
//   node bench/locks.mjs [--rows 1000000] [--pg 16]
// Writes bench/results/locks-pg<version>.json and .md.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { rehearse } from "../dist/index.js";
import { startPostgres } from "../dist/rehearse-docker.js";
import { seedTable } from "../dist/rehearse-seed.js";

const { values } = parseArgs({ options: { rows: { type: "string" }, pg: { type: "string" } } });
const ROWS = Number(values.rows ?? 1_000_000);
const PG = Number(values.pg ?? 16);

const SCHEMA = `
DROP TABLE IF EXISTS users, orgs CASCADE;
CREATE TABLE orgs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL,
  email text NOT NULL,
  name text,
  age integer NOT NULL,
  counter integer NOT NULL,
  created_at timestamptz NOT NULL
);`;

const cases = [
  {
    name: "Add an index",
    unsafe: "CREATE INDEX users_email_idx ON users (email);",
    safe: "CREATE INDEX CONCURRENTLY users_email_idx ON users (email);",
  },
  {
    name: "Add a foreign key",
    unsafe: "ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES orgs (id);",
    safe: "ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES orgs (id) NOT VALID;\nALTER TABLE users VALIDATE CONSTRAINT users_org_fk;",
  },
  {
    name: "Add a CHECK constraint",
    unsafe: "ALTER TABLE users ADD CONSTRAINT users_age_check CHECK (age >= 0);",
    safe: "ALTER TABLE users ADD CONSTRAINT users_age_check CHECK (age >= 0) NOT VALID;\nALTER TABLE users VALIDATE CONSTRAINT users_age_check;",
  },
  {
    name: "Make a column NOT NULL",
    unsafe: "ALTER TABLE users ALTER COLUMN name SET NOT NULL;",
    safe: "ALTER TABLE users ADD CONSTRAINT users_name_nn CHECK (name IS NOT NULL) NOT VALID;\nALTER TABLE users VALIDATE CONSTRAINT users_name_nn;\nALTER TABLE users ALTER COLUMN name SET NOT NULL;\nALTER TABLE users DROP CONSTRAINT users_name_nn;",
    setup: "UPDATE users SET name = 'n' WHERE name IS NULL;",
  },
  {
    name: "Add a UNIQUE constraint",
    unsafe: "ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);",
    safe: "CREATE UNIQUE INDEX CONCURRENTLY users_email_key_idx ON users (email);\nALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE USING INDEX users_email_key_idx;",
  },
  {
    name: "Add a column with a volatile default",
    unsafe: "ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();",
    safe: "ALTER TABLE users ADD COLUMN token uuid;\nALTER TABLE users ALTER COLUMN token SET DEFAULT gen_random_uuid();",
    note: "Existing rows are backfilled afterwards, in batches outside the migration.",
  },
  {
    name: "Add a bigserial column",
    unsafe: "ALTER TABLE users ADD COLUMN seq bigserial;",
    safe: "ALTER TABLE users ADD COLUMN seq bigint;",
    note: "The sequence default is attached after a batched backfill.",
  },
  {
    name: "Change a column type",
    unsafe: "ALTER TABLE users ALTER COLUMN counter TYPE bigint;",
    safe: "ALTER TABLE users ADD COLUMN counter_new bigint;",
    note: "The first step of expand and contract; the backfill and switch happen across later deploys.",
  },
];

async function fresh(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(SCHEMA);
  // As many orgs as users: the seeder sets org_id = row number, so every reference is valid.
  await seedTable(c, "orgs", ROWS);
  await seedTable(c, "users", ROWS);
  await c.end();
}

const ms = (n) => (n < 1 ? "<1 ms" : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const worst = (results, key) => Math.max(0, ...results.map((r) => r[key]));

console.log(`Postgres ${PG}, ${ROWS.toLocaleString("en-US")} rows`);
const db = await startPostgres(PG);
const out = [];
try {
  const c = new pg.Client({ connectionString: db.url });
  await c.connect();
  const version = (await c.query("SHOW server_version")).rows[0].server_version;
  await c.end();
  for (const k of cases) {
    const row = { name: k.name, note: k.note };
    for (const variant of ["unsafe", "safe"]) {
      await fresh(db.url);
      if (k.setup) {
        const s = new pg.Client({ connectionString: db.url });
        await s.connect();
        await s.query(k.setup);
        await s.end();
      }
      const results = await rehearse(k[variant], { url: db.url });
      const failed = results.find((r) => r.error);
      if (failed) throw new Error(`${k.name} (${variant}) failed: ${failed.error}`);
      row[variant] = {
        sql: k[variant],
        durationMs: results.reduce((n, r) => n + r.durationMs, 0),
        writeBlockedMs: worst(results, "writeBlockedMs"),
        readBlockedMs: worst(results, "readBlockedMs"),
        strongestLock: results.flatMap((r) => r.locks)[0]?.mode ?? "none",
      };
    }
    console.log(
      `${k.name}: writes blocked ${ms(row.unsafe.writeBlockedMs)} → ${ms(row.safe.writeBlockedMs)}`,
    );
    out.push(row);
  }
  mkdirSync("bench/results", { recursive: true });
  const meta = {
    postgres: version,
    rows: ROWS,
    date: new Date().toISOString().slice(0, 10),
    probeIntervalMs: 5,
  };
  writeFileSync(`bench/results/locks-pg${PG}.json`, `${JSON.stringify({ meta, cases: out }, null, 2)}\n`);
  const md = [
    `Postgres ${version}, ${ROWS.toLocaleString("en-US")} rows in \`users\`, measured with \`pgdeadbolt rehearse\` on ${meta.date}.`,
    "",
    "| Migration | Writes blocked, unsafe | Writes blocked, with pgdeadbolt's fix | Reads blocked, unsafe → fixed |",
    "| --- | --- | --- | --- |",
    ...out.map(
      (r) =>
        `| ${r.name} | **${ms(r.unsafe.writeBlockedMs)}** | **${ms(r.safe.writeBlockedMs)}** | ${ms(r.unsafe.readBlockedMs)} → ${ms(r.safe.readBlockedMs)} |`,
    ),
  ].join("\n");
  writeFileSync(`bench/results/locks-pg${PG}.md`, `${md}\n`);
  console.log(`\n${md}`);
} finally {
  await db.stop();
}
