---
title: add-column-rewrite
description: Add columns without rewriting the table.
sidebar:
  order: 4
---

Severity: **error** · Lock: `ACCESS EXCLUSIVE`

Some column additions need a value computed for every existing row, so Postgres rewrites the whole table under `ACCESS EXCLUSIVE`, blocking reads and writes. That covers volatile defaults (`gen_random_uuid()`, `clock_timestamp()`, `random()`), `serial` columns, identity columns and stored generated columns. Before Postgres 11, any default did.

## Instead of

```sql
ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();
```

## Do

```sql
ALTER TABLE users ADD COLUMN token uuid;
-- Backfill in batches, outside the migration:
--   UPDATE users SET token = gen_random_uuid() WHERE id BETWEEN $1 AND $2;
ALTER TABLE users ALTER COLUMN token SET DEFAULT gen_random_uuid();
```

Constant defaults and stable functions like `now()` are free on Postgres 11 and later: Postgres stores the value once instead of writing it to every row. When the default calls a function pgdeadbolt doesn't know, it warns instead of erroring.

To skip this rule for one statement, put `-- pgdeadbolt-ignore add-column-rewrite` on the line above it.
