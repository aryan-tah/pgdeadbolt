---

title: Claude Code
description: Make Claude Code check every migration it writes.
---

The pgdeadbolt plugin puts the checker inside Claude Code's loop. Every time Claude writes or edits a migration, the plugin checks it. If the migration would lock a table, Claude is blocked and handed the safe rewrite, so it fixes the migration before moving on.

## Install

```
/plugin install pgdeadbolt --marketplace aryan-tah/pgdeadbolt
```

Or add the marketplace first and pick the plugin from the list:

```
/plugin marketplace add aryan-tah/pgdeadbolt
/plugin install pgdeadbolt@pgdeadbolt
```

## What it adds

- **A skill** with the zero-downtime patterns (concurrent indexes, `NOT VALID` constraints, backfilling instead of volatile defaults, expand and contract) and framework notes. Claude reads it when it's working on a migration.
- **A hook** that runs after Claude's `Write`, `Edit` and `MultiEdit` calls on `.sql` files in migration folders:
  - **errors** block, and Claude gets the lock, the reason and the safe SQL;
  - **warnings** (renames, drops) are added to Claude's context without blocking;
  - if pgdeadbolt itself can't run, the hook never blocks.

## Settings

Set these environment variables where you run Claude Code:

| Variable                    | Default                 | Meaning                                              |
| --------------------------- | ----------------------- | ---------------------------------------------------- |
| `PGDEADBOLT_PATHS`          | `(migrat\|/db/\|/sql/)` | Regex for which `.sql` paths count as migrations     |
| `PGDEADBOLT_PG_VERSION`     | `16`                    | Postgres major version                               |
| `PGDEADBOLT_IN_TRANSACTION` | unset                   | Set to `1` if your tool wraps files in a transaction |

## ORM migrations

The hook checks SQL. Prisma, Drizzle and Supabase generate SQL files, so they're covered. For Rails, Django or Knex migrations written in Ruby, Python or JavaScript, the skill still teaches Claude the safe patterns. To check a Django migration, print its SQL and pipe it in: `python manage.py sqlmigrate app 0042 | npx pgdeadbolt check - --in-transaction`.
