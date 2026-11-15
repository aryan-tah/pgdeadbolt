---
title: table-rewrite-command
description: Don't VACUUM FULL or CLUSTER in a migration.
sidebar:
  order: 12
  badge:
    text: error
    variant: danger
---

**Don't VACUUM FULL or CLUSTER in a migration.** Takes `ACCESS EXCLUSIVE`.

Both copy the entire table into new storage while holding `ACCESS EXCLUSIVE`.

## Instead of

```sql
VACUUM FULL users;
```

## Do

```sql
-- Rebuild online with pg_repack or pg_squeeze, outside migrations.
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore table-rewrite-command` on the line above it.
