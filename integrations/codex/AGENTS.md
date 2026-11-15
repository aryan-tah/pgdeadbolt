<!-- Paste this section into your repository's AGENTS.md (read by Codex and other agents). -->

## Postgres migrations

Migrations run against production tables that already hold data, so no step may hold a write-blocking lock for more than a moment.

- Start every migration with `SET lock_timeout = '2s';`.
- Create and drop indexes `CONCURRENTLY`, each in its own migration that runs outside a transaction.
- Add foreign keys and CHECK constraints `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate step.
- Never `SET NOT NULL` directly on a big table: add a `CHECK (col IS NOT NULL) NOT VALID`, validate it, then set NOT NULL.
- Don't add columns with volatile defaults (`gen_random_uuid()`, `clock_timestamp()`), serial or identity columns to existing tables: add the column plain, backfill in batches, then set the default.
- Don't change column types, rename or drop columns in place: expand and contract across deploys.

After writing or changing a migration, run `npx pgdeadbolt check <file>` and fix every error before finishing. Full patterns: https://pgdeadbolt.aryantah.com
