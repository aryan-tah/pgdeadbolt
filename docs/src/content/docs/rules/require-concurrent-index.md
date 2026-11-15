---
title: require-concurrent-index
description: Create indexes concurrently.
sidebar:
  order: 1
---

Severity: **error** · Lock: `SHARE`

A plain `CREATE INDEX` takes a `SHARE` lock on the table. Reads keep working, but every `INSERT`, `UPDATE` and `DELETE` waits until the index is built, and building an index on a big table takes seconds to minutes.

## Instead of

```sql
CREATE INDEX idx_users_email ON users (email);
```

## Do

```sql
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

`CONCURRENTLY` can't run inside a transaction, so put it in its own migration that your tool runs without one. If a concurrent build fails, it leaves an `INVALID` index behind: drop it and try again.

To skip this rule for one statement, put `-- pgdeadbolt-ignore require-concurrent-index` on the line above it.
