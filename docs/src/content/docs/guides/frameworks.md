---

title: Frameworks and ORMs
description: Running CONCURRENTLY and other safe patterns with your migration tool.
---

Most tools wrap each migration in a transaction, and `CREATE INDEX CONCURRENTLY` can't run inside one. Here's how to opt out, per tool. Check those projects with `--in-transaction`, so pgdeadbolt catches any `CONCURRENTLY` you forgot to move.

| Tool         | Wraps in a transaction?   | Run outside a transaction                                           |
| ------------ | ------------------------- | ------------------------------------------------------------------- |
| Rails        | Yes                       | `disable_ddl_transaction!` in the migration class                   |
| Django       | Yes                       | `atomic = False` on the `Migration` class                           |
| Knex         | Yes                       | `exports.config = { transaction: false }`                           |
| Prisma       | Per file                  | Put the statement in its own migration file; edit the generated SQL |
| Drizzle      | Per file                  | Its own migration file; edit the generated SQL                      |
| Supabase CLI | Per file                  | Its own migration file                                              |
| Flyway       | Yes (most databases)      | `-- flyway:executeInTransaction=false` in the script                |
| Raw SQL      | Only if you write `BEGIN` | Keep `CONCURRENTLY` outside `BEGIN`/`COMMIT`                        |

## Generated migrations

Prisma, Drizzle and other generators emit plain `CREATE INDEX` and validated constraints. Treat generated SQL as a draft: run pgdeadbolt on it and apply the fixes before committing.

```bash
npx prisma migrate dev --create-only
npx pgdeadbolt check prisma/migrations
```
