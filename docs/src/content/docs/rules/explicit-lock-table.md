---
title: explicit-lock-table
description: Avoid LOCK TABLE in migrations.
sidebar:
  order: 15
---

Severity: **warning**

An explicit lock lasts until the transaction ends, so every later step in the migration runs while the table is locked.

## Instead of

```sql
BEGIN;
LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
UPDATE users SET plan = 'free' WHERE plan IS NULL;
COMMIT;
```

## Do

```sql
-- Remove the lock, or keep the transaction tiny and set lock_timeout first.
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore explicit-lock-table` on the line above it.
