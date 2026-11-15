---

title: set-not-null
description: Set NOT NULL without a full scan.
sidebar:
order: 5
badge:
text: error
variant: danger
---

**Set NOT NULL without a full scan.** Takes `ACCESS EXCLUSIVE`.

To add `NOT NULL`, Postgres must prove no row is null. Unless a valid `CHECK` constraint already proves it, it scans the whole table while holding `ACCESS EXCLUSIVE`.

## Instead of

```sql
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

## Do

```sql
ALTER TABLE users ADD CONSTRAINT users_email_not_null CHECK (email IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_email_not_null;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_email_not_null;
```

`VALIDATE CONSTRAINT` scans the table but only takes `SHARE UPDATE EXCLUSIVE`, which doesn't block reads or writes. On Postgres 12 and later, `SET NOT NULL` then uses the validated check and skips the scan.

To skip this rule for one statement, put `-- pgdeadbolt-ignore set-not-null` on the line above it.
