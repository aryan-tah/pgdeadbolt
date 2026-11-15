---

title: Getting started
description: Install pgdeadbolt and check your first migration.
---

pgdeadbolt reads Postgres migrations, works out which lock each statement takes, and tells you when one would block production traffic, with the safe way to make the same change.

## Check a migration

You need Node 20 or newer. No install is required:

```bash
npx pgdeadbolt check migrations/
```

Point it at files or directories; it finds every `.sql` file inside. Read from stdin with `-`:

```bash
cat migration.sql | npx pgdeadbolt check -
```

A finding looks like this:

```
migrations/0042_add_index.sql
  1:1  error  CREATE INDEX on users blocks every INSERT, UPDATE and DELETE until the index is built.  require-concurrent-index
         lock: SHARE
         A plain CREATE INDEX takes a SHARE lock. Reads continue, but writes queue for as long as the build takes.
         fix:
           CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

## Exit codes

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | No errors (warnings may be printed)                       |
| `1`  | At least one error, or a warning with `--fail-on-warning` |
| `2`  | Bad usage, a missing file, or SQL that couldn't be parsed |

## Tell it about your setup

Two settings change verdicts:

- **`--pg-version`**: lock behaviour changed across versions. On Postgres 10, any `ADD COLUMN ... DEFAULT` rewrites the table; on 11 and later, constant defaults are free. The default is 16.
- **`--in-transaction`**: Rails, Django, Knex and others wrap each migration file in a transaction. With this flag, pgdeadbolt flags `CONCURRENTLY` statements that would fail there.

See [Configuration](/guides/configuration/) to set these once.

## Next

- [Use it with Claude Code](/guides/claude-code/) so your agent can't ship a locking migration.
- [Add the GitHub Action](/guides/github-action/) to catch them in review.
- [Rehearse a migration](/guides/rehearse/) on a real Postgres to measure the blocking.
- [Browse the rules](/rules/require-concurrent-index/).
