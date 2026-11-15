---
title: concurrently-in-transaction
description: Don't run CONCURRENTLY in a transaction.
sidebar:
  order: 3
  badge:
    text: error
    variant: danger
---

**Don't run CONCURRENTLY in a transaction.**

`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY` and `REFRESH MATERIALIZED VIEW CONCURRENTLY` can't run inside a transaction block. Postgres refuses them and the migration fails.

## Instead of

```sql
BEGIN;
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
COMMIT;
```

## Do

```sql
-- In its own migration, outside a transaction:
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

If your tool wraps every file in a transaction, run pgdeadbolt with `--in-transaction` and see [Frameworks](/guides/frameworks/) for how to opt out.

To skip this rule for one statement, put `-- pgdeadbolt-ignore concurrently-in-transaction` on the line above it.
