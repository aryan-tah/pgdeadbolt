# pgdeadbolt

Stop AI coding agents from shipping Postgres migrations that lock your tables.

> Early, built in the open. Agent integrations, a rehearsal mode and benchmarks are landing in the next pull requests.

```bash
npx pgdeadbolt check migrations/
```

```
migrations/0042_add_index.sql
  1:1  error  CREATE INDEX on users blocks every INSERT, UPDATE and DELETE until the index is built.  require-concurrent-index
         fix:
           CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

Or measure it for real. `rehearse` runs the migration on a throwaway Postgres while probe connections try to write to the same tables:

```bash
npx pgdeadbolt rehearse migrations/0042_add_index.sql --docker --setup schema.sql --seed users=2000000
```

| Migration on 2M rows        | Build time | Writes blocked |
| --------------------------- | ---------- | -------------- |
| `CREATE INDEX`              | 2.48s      | **2.48s**      |
| `CREATE INDEX CONCURRENTLY` | 2.59s      | **33ms**       |

It parses migrations with Postgres's own parser, knows which lock each statement takes, and prints the safe way to make the same change. Run `pgdeadbolt rules` for the full list.

## Use it with your coding agent

**Claude Code.** Install the plugin. Every time Claude writes a migration, pgdeadbolt checks it; if it would lock a table, Claude gets the safe rewrite and has to fix it before moving on.

```
/plugin install pgdeadbolt --marketplace aryan-tah/pgdeadbolt
```

**Codex and other agents.** Paste [`integrations/codex/AGENTS.md`](integrations/codex/AGENTS.md) into your repo's `AGENTS.md`, or copy [`skills/pgdeadbolt`](skills/pgdeadbolt) into an agent that reads Agent Skills.

**Cursor.** Copy [`integrations/cursor/pgdeadbolt.mdc`](integrations/cursor/pgdeadbolt.mdc) to `.cursor/rules/`.

**GitHub Actions.** Fail pull requests with dangerous migrations, with the fix inline on the diff:

```yaml
- uses: aryan-tah/pgdeadbolt@v0
  with:
    paths: db/migrations
```

## License

[MIT](LICENSE)
