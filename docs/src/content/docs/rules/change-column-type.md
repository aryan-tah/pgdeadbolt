---

title: change-column-type
description: Change column types with expand and contract.
sidebar:
order: 6
badge:
text: error
variant: danger
---

**Change column types with expand and contract.** Takes `ACCESS EXCLUSIVE`.

Most type changes rewrite the table and rebuild its indexes under `ACCESS EXCLUSIVE`. A few are metadata-only, such as `varchar` to `text` or making a `varchar` longer; if yours is one of them, ignore the finding.

## Instead of

```sql
ALTER TABLE events ALTER COLUMN id TYPE bigint;
```

## Do

```sql
ALTER TABLE events ADD COLUMN id_new bigint;
-- Write to both columns from the app, backfill old rows in batches,
-- switch reads to id_new, then drop id in a later deploy.
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore change-column-type` on the line above it.
