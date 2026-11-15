// Source for the rule pages in src/content/docs/rules. Run `node scripts/rules.mjs`
// after changing a rule; a test fails if any rule ships without a page.
import { mkdirSync, writeFileSync } from "node:fs";

const rules = [
  {
    id: "require-concurrent-index",
    title: "Create indexes concurrently",
    severity: "error",
    lock: "SHARE",
    why: "A plain `CREATE INDEX` takes a `SHARE` lock on the table. Reads keep working, but every `INSERT`, `UPDATE` and `DELETE` waits until the index is built, and building an index on a big table takes seconds to minutes.",
    bad: "CREATE INDEX idx_users_email ON users (email);",
    good: "CREATE INDEX CONCURRENTLY idx_users_email ON users (email);",
    notes:
      "`CONCURRENTLY` can't run inside a transaction, so put it in its own migration that your tool runs without one. If a concurrent build fails, it leaves an `INVALID` index behind: drop it and try again.",
  },
  {
    id: "require-concurrent-index-drop",
    title: "Drop indexes concurrently",
    severity: "warning",
    lock: "ACCESS EXCLUSIVE",
    why: "Dropping an index is quick, but a plain `DROP INDEX` needs an `ACCESS EXCLUSIVE` lock on the table. If a long query holds the table, the drop waits, and every query after it queues behind the drop.",
    bad: "DROP INDEX idx_users_email;",
    good: "DROP INDEX CONCURRENTLY idx_users_email;",
  },
  {
    id: "concurrently-in-transaction",
    title: "Don't run CONCURRENTLY in a transaction",
    severity: "error",
    why: "`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY` and `REFRESH MATERIALIZED VIEW CONCURRENTLY` can't run inside a transaction block. Postgres refuses them and the migration fails.",
    bad: "BEGIN;\nCREATE INDEX CONCURRENTLY idx_users_email ON users (email);\nCOMMIT;",
    good: "-- In its own migration, outside a transaction:\nCREATE INDEX CONCURRENTLY idx_users_email ON users (email);",
    notes:
      "If your tool wraps every file in a transaction, run pgdeadbolt with `--in-transaction` and see [Frameworks](/guides/frameworks/) for how to opt out.",
  },
  {
    id: "add-column-rewrite",
    title: "Add columns without rewriting the table",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "Some column additions need a value computed for every existing row, so Postgres rewrites the whole table under `ACCESS EXCLUSIVE`, blocking reads and writes. That covers volatile defaults (`gen_random_uuid()`, `clock_timestamp()`, `random()`), `serial` columns, identity columns and stored generated columns. Before Postgres 11, any default did.",
    bad: "ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();",
    good: "ALTER TABLE users ADD COLUMN token uuid;\n-- Backfill in batches, outside the migration:\n--   UPDATE users SET token = gen_random_uuid() WHERE id BETWEEN $1 AND $2;\nALTER TABLE users ALTER COLUMN token SET DEFAULT gen_random_uuid();",
    notes:
      "Constant defaults and stable functions like `now()` are free on Postgres 11 and later: Postgres stores the value once instead of writing it to every row. When the default calls a function pgdeadbolt doesn't know, it warns instead of erroring.",
  },
  {
    id: "set-not-null",
    title: "Set NOT NULL without a full scan",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "To add `NOT NULL`, Postgres must prove no row is null. Unless a valid `CHECK` constraint already proves it, it scans the whole table while holding `ACCESS EXCLUSIVE`.",
    bad: "ALTER TABLE users ALTER COLUMN email SET NOT NULL;",
    good: "ALTER TABLE users ADD CONSTRAINT users_email_not_null CHECK (email IS NOT NULL) NOT VALID;\nALTER TABLE users VALIDATE CONSTRAINT users_email_not_null;\nALTER TABLE users ALTER COLUMN email SET NOT NULL;\nALTER TABLE users DROP CONSTRAINT users_email_not_null;",
    notes:
      "`VALIDATE CONSTRAINT` scans the table but only takes `SHARE UPDATE EXCLUSIVE`, which doesn't block reads or writes. On Postgres 12 and later, `SET NOT NULL` then uses the validated check and skips the scan.",
  },
  {
    id: "change-column-type",
    title: "Change column types with expand and contract",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "Most type changes rewrite the table and rebuild its indexes under `ACCESS EXCLUSIVE`. A few are metadata-only, such as `varchar` to `text` or making a `varchar` longer; if yours is one of them, ignore the finding.",
    bad: "ALTER TABLE events ALTER COLUMN id TYPE bigint;",
    good: "ALTER TABLE events ADD COLUMN id_new bigint;\n-- Write to both columns from the app, backfill old rows in batches,\n-- switch reads to id_new, then drop id in a later deploy.",
  },
  {
    id: "add-foreign-key-validated",
    title: "Add foreign keys as NOT VALID first",
    severity: "error",
    lock: "SHARE ROW EXCLUSIVE",
    why: "Adding a foreign key checks every existing row against the referenced table, and locks both tables against writes while it does.",
    bad: "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id);",
    good: "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;\nALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk;",
    notes:
      "`NOT VALID` makes the constraint apply to new rows immediately, with only a brief lock. `VALIDATE CONSTRAINT` then checks old rows without blocking writes.",
  },
  {
    id: "add-check-validated",
    title: "Add CHECK constraints as NOT VALID first",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "Adding a `CHECK` constraint scans the whole table to validate it while holding `ACCESS EXCLUSIVE`.",
    bad: "ALTER TABLE orders ADD CONSTRAINT orders_total_positive CHECK (total >= 0);",
    good: "ALTER TABLE orders ADD CONSTRAINT orders_total_positive CHECK (total >= 0) NOT VALID;\nALTER TABLE orders VALIDATE CONSTRAINT orders_total_positive;",
  },
  {
    id: "add-unique-or-primary-key",
    title: "Add UNIQUE and PRIMARY KEY from a concurrent index",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "`ADD CONSTRAINT ... UNIQUE` and `ADD PRIMARY KEY` build their index under `ACCESS EXCLUSIVE`, so the table is unusable for the whole build.",
    bad: "ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);",
    good: "CREATE UNIQUE INDEX CONCURRENTLY users_email_idx ON users (email);\nALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE USING INDEX users_email_idx;",
    notes:
      "For a primary key, the columns must already be `NOT NULL`; otherwise Postgres scans the table to check. See [set-not-null](/rules/set-not-null/).",
  },
  {
    id: "rename",
    title: "Rename with expand and contract",
    severity: "warning",
    lock: "ACCESS EXCLUSIVE",
    why: "The rename itself is instant, but app servers still running the old code keep using the old name during the deploy, and their queries fail.",
    bad: "ALTER TABLE users RENAME COLUMN email TO email_address;",
    good: "ALTER TABLE users ADD COLUMN email_address text;\n-- Write both, backfill, move reads to email_address,\n-- then drop email in a later deploy.",
  },
  {
    id: "drop-column-or-table",
    title: "Drop columns and tables in a later deploy",
    severity: "warning",
    lock: "ACCESS EXCLUSIVE",
    why: "Code that's still running may select or write the column or table. ORMs that select every column can break too. And a drop can't be undone without a backup.",
    bad: "ALTER TABLE users DROP COLUMN legacy_flags;",
    good: "-- Deploy 1: stop reading and writing legacy_flags (many ORMs have an ignored-columns setting).\n-- Deploy 2:\nALTER TABLE users DROP COLUMN legacy_flags;",
  },
  {
    id: "table-rewrite-command",
    title: "Don't VACUUM FULL or CLUSTER in a migration",
    severity: "error",
    lock: "ACCESS EXCLUSIVE",
    why: "Both copy the entire table into new storage while holding `ACCESS EXCLUSIVE`.",
    bad: "VACUUM FULL users;",
    good: "-- Rebuild online with pg_repack or pg_squeeze, outside migrations.",
  },
  {
    id: "refresh-matview-blocking",
    title: "Refresh materialized views concurrently",
    severity: "warning",
    lock: "ACCESS EXCLUSIVE",
    why: "A plain refresh locks the view for the whole recompute, so every read of it waits.",
    bad: "REFRESH MATERIALIZED VIEW daily_stats;",
    good: "REFRESH MATERIALIZED VIEW CONCURRENTLY daily_stats;",
    notes: "Concurrent refresh needs a unique index on the view.",
  },
  {
    id: "reindex-blocking",
    title: "Reindex concurrently",
    severity: "error",
    lock: "SHARE",
    why: "A plain `REINDEX` locks the table against writes and blocks queries that use the index while it rebuilds.",
    bad: "REINDEX INDEX idx_users_email;",
    good: "REINDEX INDEX CONCURRENTLY idx_users_email;",
    notes:
      "`REINDEX CONCURRENTLY` exists from Postgres 12. On older versions, build a new index concurrently and drop the old one.",
  },
  {
    id: "explicit-lock-table",
    title: "Avoid LOCK TABLE in migrations",
    severity: "warning",
    why: "An explicit lock lasts until the transaction ends, so every later step in the migration runs while the table is locked.",
    bad: "BEGIN;\nLOCK TABLE users IN ACCESS EXCLUSIVE MODE;\nUPDATE users SET plan = 'free' WHERE plan IS NULL;\nCOMMIT;",
    good: "-- Remove the lock, or keep the transaction tiny and set lock_timeout first.",
  },
  {
    id: "require-lock-timeout",
    title: "Set lock_timeout before taking strong locks",
    severity: "warning",
    lock: "ACCESS EXCLUSIVE",
    why: "Even an instant `ALTER TABLE` has to wait for its lock. While it waits behind a long-running query, every new query on the table queues behind the `ALTER`, and the table looks down for as long as the slowest query runs.",
    bad: "ALTER TABLE users ADD COLUMN nickname text;",
    good: "SET lock_timeout = '2s';\nALTER TABLE users ADD COLUMN nickname text;",
    notes:
      "If the lock isn't free within the timeout, the migration fails fast and can be retried. pgdeadbolt reports this once per file, at the first statement that needs a strong lock.",
  },
];

const dir = new URL("../src/content/docs/rules/", import.meta.url);
mkdirSync(dir, { recursive: true });
rules.forEach((r, i) => {
  const page = `---
title: ${r.id}
description: ${r.title}.
sidebar:
  order: ${i + 1}
---

Severity: **${r.severity}**${r.lock ? ` · Lock: \`${r.lock}\`` : ""}

${r.why}

## Instead of

\`\`\`sql
${r.bad}
\`\`\`

## Do

\`\`\`sql
${r.good}
\`\`\`
${r.notes ? `\n${r.notes}\n` : ""}
To skip this rule for one statement, put \`-- pgdeadbolt-ignore ${r.id}\` on the line above it.
`;
  writeFileSync(new URL(`${r.id}.md`, dir), page);
});
console.log(`wrote ${rules.length} rule pages`);
