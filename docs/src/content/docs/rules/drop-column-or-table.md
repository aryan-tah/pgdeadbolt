---

title: drop-column-or-table
description: Drop columns and tables in a later deploy.
sidebar:
order: 11
badge:
text: warning
variant: caution
---

**Drop columns and tables in a later deploy.** Takes `ACCESS EXCLUSIVE`.

Code that's still running may select or write the column or table. ORMs that select every column can break too. And a drop can't be undone without a backup.

## Instead of

```sql
ALTER TABLE users DROP COLUMN legacy_flags;
```

## Do

```sql
-- Deploy 1: stop reading and writing legacy_flags (many ORMs have an ignored-columns setting).
-- Deploy 2:
ALTER TABLE users DROP COLUMN legacy_flags;
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore drop-column-or-table` on the line above it.
