<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="pgdeadbolt">
</p>

<h1 align="center">pgdeadbolt</h1>

<p align="center">
  <b>Stop AI coding agents from shipping Postgres migrations that lock your tables.</b>
</p>

<p align="center">
  <a href="https://github.com/aryan-tah/pgdeadbolt/actions/workflows/ci.yml"><img src="https://github.com/aryan-tah/pgdeadbolt/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/pgdeadbolt"><img src="https://img.shields.io/npm/v/pgdeadbolt?color=1e3a8a" alt="npm"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/aryan-tah/pgdeadbolt"><img src="https://api.scorecard.dev/projects/github.com/aryan-tah/pgdeadbolt/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1e3a8a" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://pgdeadbolt.aryantah.com">Docs</a> ·
  <a href="https://pgdeadbolt.aryantah.com/guides/claude-code/">Claude Code</a> ·
  <a href="https://pgdeadbolt.aryantah.com/guides/github-action/">GitHub Action</a> ·
  <a href="https://pgdeadbolt.aryantah.com/rules/require-concurrent-index/">Rules</a>
</p>

---

Ask a coding agent to "add an index on `users.email`" and you'll get `CREATE INDEX idx ON users (email);`. It's correct SQL. On a busy table in production it also blocks every write until the index is built.

Agents write these all the time: indexes without `CONCURRENTLY`, foreign keys without `NOT VALID`, columns with `DEFAULT gen_random_uuid()` that rewrite the whole table. They pass review because they look fine.

pgdeadbolt catches them where agents write them, in CI, and on the command line, and hands back the safe version.

```bash
npx pgdeadbolt check migrations/
```

```
migrations/0042_add_index.sql
  1:1  error  CREATE INDEX on users blocks every INSERT, UPDATE and DELETE until the index is built.  require-concurrent-index
         lock: SHARE
         fix:
           CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

## How much it matters

Each common migration, unsafe and with pgdeadbolt's fix, on a table of **1 million rows** (Postgres 16), measured by running it while probe connections keep trying to write:

| Migration | Writes blocked, as written | With pgdeadbolt's fix |
| --- | --- | --- |
| Add a `bigserial` column | **4.58 s** | 2 ms |
| Add a column with `DEFAULT gen_random_uuid()` | **1.22 s** | 3 ms |
| Add an index | **1.03 s** | 4 ms |
| Add a `UNIQUE` constraint | **655 ms** | 3 ms |
| Change a column type | **540 ms** | 2 ms |
| Add a foreign key | **309 ms** | 3 ms |
| Make a column `NOT NULL` | **48 ms** | 5 ms |
| Add a `CHECK` constraint | **47 ms** | 3 ms |

That's a laptop and a small table. Lock time grows with table size: at 100 million rows, those seconds are minutes of downtime. Reproduce it with `npm run bench`; full results in [`bench/results`](bench/results).

## Use it with your coding agent

**Claude Code.** Install the plugin. Whenever Claude writes a migration, pgdeadbolt checks it. If it would lock a table, Claude is blocked and handed the safe rewrite, and fixes it before moving on.

```
/plugin install pgdeadbolt --marketplace aryan-tah/pgdeadbolt
```

**Codex, Cursor and other agents.** Paste [`integrations/codex/AGENTS.md`](integrations/codex/AGENTS.md) into your `AGENTS.md`, copy [`integrations/cursor/pgdeadbolt.mdc`](integrations/cursor/pgdeadbolt.mdc) to `.cursor/rules/`, or drop the [`skills/pgdeadbolt`](skills/pgdeadbolt) folder into any agent that loads Agent Skills.

**GitHub Actions.** Fail pull requests with dangerous migrations, with the fix inline on the diff:

```yaml
- uses: aryan-tah/pgdeadbolt@v0
  with:
    paths: db/migrations
```

## What it checks

16 rules, built on Postgres's own parser ([libpg_query](https://github.com/pganalyze/libpg_query)), so it reads SQL the way your database does.

| Rule | Catches |
| --- | --- |
| [`require-concurrent-index`](https://pgdeadbolt.aryantah.com/rules/require-concurrent-index/) | `CREATE INDEX` without `CONCURRENTLY` |
| [`add-column-rewrite`](https://pgdeadbolt.aryantah.com/rules/add-column-rewrite/) | Volatile defaults, `serial`, identity and stored generated columns that rewrite the table |
| [`set-not-null`](https://pgdeadbolt.aryantah.com/rules/set-not-null/) | `SET NOT NULL` scanning the table under `ACCESS EXCLUSIVE` |
| [`add-foreign-key-validated`](https://pgdeadbolt.aryantah.com/rules/add-foreign-key-validated/) | Foreign keys added without `NOT VALID` |
| [`add-unique-or-primary-key`](https://pgdeadbolt.aryantah.com/rules/add-unique-or-primary-key/) | `UNIQUE` / `PRIMARY KEY` built under `ACCESS EXCLUSIVE` |
| [`change-column-type`](https://pgdeadbolt.aryantah.com/rules/change-column-type/) | Type changes that rewrite the table |
| [`require-lock-timeout`](https://pgdeadbolt.aryantah.com/rules/require-lock-timeout/) | Strong locks taken without `lock_timeout` |
| [`concurrently-in-transaction`](https://pgdeadbolt.aryantah.com/rules/concurrently-in-transaction/) | `CONCURRENTLY` inside a transaction, which fails |

…plus checks, index drops, renames, drops, `VACUUM FULL`, `CLUSTER`, blocking refresh and reindex, and `LOCK TABLE`. [All rules →](https://pgdeadbolt.aryantah.com/rules/require-concurrent-index/)

It understands context: tables created earlier in the same migration are exempt, `--pg-version` changes verdicts where Postgres behaviour changed, and `--in-transaction` covers tools that wrap each file in a transaction.

## Measure it for real

Rules say what a statement *should* lock. `rehearse` measures what it *does*, on a throwaway Postgres:

```bash
npx pgdeadbolt rehearse migrations/0042_add_index.sql --docker --setup schema.sql --seed users=2000000
```

```
✖ line 1  CREATE INDEX idx_users_email ON users (email)
    ran 2.48s · writes blocked 2.48s · reads blocked 6ms · SHARE on users
```

## Fits your stack

Plain SQL, Prisma, Drizzle and Supabase migrations work as they are. Django can pipe `sqlmigrate` output in. Output comes as text, JSON, GitHub annotations or SARIF, with [ignore comments](https://pgdeadbolt.aryantah.com/guides/configuration/) for deliberate exceptions. See [frameworks](https://pgdeadbolt.aryantah.com/guides/frameworks/) for running `CONCURRENTLY` in Rails, Django, Knex, Prisma, Drizzle and Flyway.

## Contributing

Found a migration pgdeadbolt got wrong? [Report it](https://github.com/aryan-tah/pgdeadbolt/issues/new?template=rule-report.yml): that's the most useful contribution there is. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## License

[MIT](LICENSE) © Aryan Tah
