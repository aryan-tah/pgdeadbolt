---

title: require-lock-timeout
description: Set lock_timeout before taking strong locks.
sidebar:
order: 16
badge:
text: warning
variant: caution
---

**Set lock_timeout before taking strong locks.** Takes `ACCESS EXCLUSIVE`.

Even an instant `ALTER TABLE` has to wait for its lock. While it waits behind a long-running query, every new query on the table queues behind the `ALTER`, and the table looks down for as long as the slowest query runs.

## Instead of

```sql
ALTER TABLE users ADD COLUMN nickname text;
```

## Do

```sql
SET lock_timeout = '2s';
ALTER TABLE users ADD COLUMN nickname text;
```

If the lock isn't free within the timeout, the migration fails fast and can be retried. pgdeadbolt reports this once per file, at the first statement that needs a strong lock.

To skip this rule for one statement, put `-- pgdeadbolt-ignore require-lock-timeout` on the line above it.
