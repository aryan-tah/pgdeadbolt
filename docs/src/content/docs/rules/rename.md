---
title: rename
description: Rename with expand and contract.
sidebar:
  order: 10
  badge:
    text: warning
    variant: caution
---

**Rename with expand and contract.** Takes `ACCESS EXCLUSIVE`.

The rename itself is instant, but app servers still running the old code keep using the old name during the deploy, and their queries fail.

## Instead of

```sql
ALTER TABLE users RENAME COLUMN email TO email_address;
```

## Do

```sql
ALTER TABLE users ADD COLUMN email_address text;
-- Write both, backfill, move reads to email_address,
-- then drop email in a later deploy.
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore rename` on the line above it.
