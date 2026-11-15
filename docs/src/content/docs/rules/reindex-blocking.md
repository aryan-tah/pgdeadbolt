---
title: reindex-blocking
description: Reindex concurrently.
sidebar:
  order: 14
  badge:
    text: error
    variant: danger
---

**Reindex concurrently.** Takes `SHARE`.

A plain `REINDEX` locks the table against writes and blocks queries that use the index while it rebuilds.

## Instead of

```sql
REINDEX INDEX idx_users_email;
```

## Do

```sql
REINDEX INDEX CONCURRENTLY idx_users_email;
```

`REINDEX CONCURRENTLY` exists from Postgres 12. On older versions, build a new index concurrently and drop the old one.

To skip this rule for one statement, put `-- pgdeadbolt-ignore reindex-blocking` on the line above it.
