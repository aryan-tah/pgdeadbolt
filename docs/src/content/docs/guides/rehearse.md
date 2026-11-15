---

title: Rehearse a migration
description: Measure how long a migration really blocks writes, on a throwaway Postgres.
---

Rules say what a statement _should_ lock. `rehearse` measures what it _does_.

```bash
npx pgdeadbolt rehearse migrations/0042_add_index.sql --docker --setup schema.sql --seed users=2000000
```

```
✖ line 1  CREATE INDEX idx_users_email ON users (email)
    ran 2.48s · writes blocked 2.48s · reads blocked 6ms · SHARE on users
```

## How it measures

The migration runs statement by statement, exactly as written. For every table a statement touches, two probe connections keep trying, every 5 ms, to take the lock a write needs (`ROW EXCLUSIVE`) and the lock a read needs (`ACCESS SHARE`). The longest a probe waited is how long real traffic would have been blocked. The probes don't change any data. A sampler also reads `pg_locks` to record which locks the migration actually held.

## Options

| Option                                | Meaning                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `--docker`                            | Start a throwaway Postgres in Docker (`--pg-version` picks the image) |
| `--database-url`                      | Use this database instead, or set `DATABASE_URL`                      |
| `--setup file.sql`                    | Run this first, usually your schema                                   |
| `--seed users=1000000,orders=5000000` | Fill tables with synthetic rows first                                 |
| `--max-block-ms 1000`                 | Exit 1 if any write was blocked longer than this                      |
| `--format json`                       | Machine-readable results                                              |
| `--yes`                               | Allow a database that isn't on localhost                              |

Seeding generates values by column type and leaves columns with defaults, identity or generated values to Postgres. Integer foreign keys point at parent ids `1..n`, so seed parent tables first.

:::caution
Rehearse runs the migration for real. Point it at a disposable database, never production. It refuses anything that isn't on localhost unless you pass `--yes`.
:::
