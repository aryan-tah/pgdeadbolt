---
title: add-unique-or-primary-key
description: Add UNIQUE and PRIMARY KEY from a concurrent index.
sidebar:
  order: 9
---

Severity: **error** · Lock: `ACCESS EXCLUSIVE`

`ADD CONSTRAINT ... UNIQUE` and `ADD PRIMARY KEY` build their index under `ACCESS EXCLUSIVE`, so the table is unusable for the whole build.

## Instead of

```sql
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
```

## Do

```sql
CREATE UNIQUE INDEX CONCURRENTLY users_email_idx ON users (email);
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE USING INDEX users_email_idx;
```

For a primary key, the columns must already be `NOT NULL`; otherwise Postgres scans the table to check. See [set-not-null](/rules/set-not-null/).

To skip this rule for one statement, put `-- pgdeadbolt-ignore add-unique-or-primary-key` on the line above it.
