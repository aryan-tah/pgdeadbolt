---
name: pgdeadbolt
description: Use when writing, editing or reviewing a PostgreSQL migration (SQL files, or Prisma, Drizzle, Rails, Django, Knex, TypeORM, Sequelize, Supabase or Flyway migrations) on a table that already holds data. Applies the zero-downtime patterns that keep a migration from locking production tables, and checks the result with pgdeadbolt.
---

# Postgres migrations that don't lock production

A migration that's instant on your laptop can freeze a busy table in production. Most DDL needs a lock. While the statement holds or even just waits for it, every query on the table queues behind it. Write migrations so that **no step holds a write-blocking lock for longer than a moment**.

These rules matter for tables that already have rows and traffic. A table created in the same migration is empty, so none of this applies to it.

## Always

- Start the migration with `SET lock_timeout = '2s';`. If the lock isn't free in 2 seconds, the migration fails and can be retried, instead of stalling the whole table.
- Keep each migration to one risky step. Split anything that runs `CONCURRENTLY` into its own migration, outside a transaction.

## Safe patterns

| Change                                            | Don't                                                                               | Do                                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an index                                      | `CREATE INDEX i ON t (c);`                                                          | `CREATE INDEX CONCURRENTLY i ON t (c);` in its own non-transactional migration                                                                       |
| Drop an index                                     | `DROP INDEX i;`                                                                     | `DROP INDEX CONCURRENTLY i;`                                                                                                                         |
| Add a column with a default                       | `ADD COLUMN c uuid DEFAULT gen_random_uuid()` (volatile default rewrites the table) | Add the column with no default, backfill in batches, then `ALTER COLUMN c SET DEFAULT …`. Constant defaults and `now()` are fine on Postgres 11+.    |
| Add a serial / identity / stored generated column | `ADD COLUMN n bigserial`                                                            | Add a plain `bigint` column, backfill in batches, then attach a sequence or default                                                                  |
| Make a column NOT NULL                            | `ALTER COLUMN c SET NOT NULL;`                                                      | `ADD CONSTRAINT c_nn CHECK (c IS NOT NULL) NOT VALID;` then `VALIDATE CONSTRAINT c_nn;` then `SET NOT NULL;` (no scan on PG 12+) then drop the check |
| Add a foreign key                                 | `ADD CONSTRAINT fk FOREIGN KEY … REFERENCES …;`                                     | Same statement with `NOT VALID`, then `ALTER TABLE t VALIDATE CONSTRAINT fk;` as a separate step                                                     |
| Add a CHECK                                       | `ADD CONSTRAINT ck CHECK (…);`                                                      | `… NOT VALID`, then `VALIDATE CONSTRAINT ck;`                                                                                                        |
| Add UNIQUE / PRIMARY KEY                          | `ADD CONSTRAINT u UNIQUE (c);`                                                      | `CREATE UNIQUE INDEX CONCURRENTLY u_idx ON t (c);` then `ADD CONSTRAINT u UNIQUE USING INDEX u_idx;`                                                 |
| Change a column type                              | `ALTER COLUMN c TYPE bigint;`                                                       | Expand and contract: add `c_new`, dual-write, backfill, switch reads, drop `c` later. (`varchar` to `text` or a longer `varchar` is safe in place.)  |
| Rename a column or table                          | `RENAME COLUMN a TO b;`                                                             | Expand and contract, so old app servers keep working during the deploy                                                                               |
| Drop a column                                     | `DROP COLUMN c;` in the same deploy that stops using it                             | Stop reading and writing it first; drop it in a later deploy                                                                                         |
| Rebuild a table                                   | `VACUUM FULL`, `CLUSTER`                                                            | `pg_repack` or `pg_squeeze`, outside migrations                                                                                                      |
| Refresh a materialized view                       | `REFRESH MATERIALIZED VIEW v;`                                                      | `REFRESH MATERIALIZED VIEW CONCURRENTLY v;` (needs a unique index)                                                                                   |

Backfill in batches of a few thousand rows per statement, committing between batches, never in one `UPDATE` over the whole table.

## Framework notes

These tools wrap each migration in a transaction by default, so `CONCURRENTLY` needs an opt-out:

- **Rails:** `disable_ddl_transaction!` in the migration class.
- **Django:** `atomic = False` on the migration.
- **Knex:** `exports.config = { transaction: false };`
- **Prisma, Drizzle, Supabase, raw SQL:** put `CONCURRENTLY` statements in their own migration file. Edit the generated SQL rather than accepting it as is; generators emit plain `CREATE INDEX`.

When the tool wraps files in a transaction, check with `--in-transaction` so pgdeadbolt catches `CONCURRENTLY` that would fail.

## Check your work

After writing a SQL migration, run:

```bash
npx pgdeadbolt check path/to/migration.sql
```

Fix every error before finishing. To measure real blocking on realistic data:

```bash
npx pgdeadbolt rehearse path/to/migration.sql --docker --setup schema.sql --seed table=1000000
```

If a finding is a deliberate exception (for example, a table known to stay tiny), put `-- pgdeadbolt-ignore <rule-id>` on the line above the statement, with a comment saying why.
