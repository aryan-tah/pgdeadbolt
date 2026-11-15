---
title: require-concurrent-index-drop
description: Drop indexes concurrently.
sidebar:
  order: 2
  badge:
    text: warning
    variant: caution
---

**Drop indexes concurrently.** Takes `ACCESS EXCLUSIVE`.

Dropping an index is quick, but a plain `DROP INDEX` needs an `ACCESS EXCLUSIVE` lock on the table. If a long query holds the table, the drop waits, and every query after it queues behind the drop.

## Instead of

```sql
DROP INDEX idx_users_email;
```

## Do

```sql
DROP INDEX CONCURRENTLY idx_users_email;
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore require-concurrent-index-drop` on the line above it.
