# Agent benchmark

These cases measure whether the pgdeadbolt Claude Code plugin changes what an agent writes. Each case starts from the same small project (`scaffold.sh`: a `users` and an `orders` table, plain SQL migrations, Postgres 16) and asks for one common migration in the words a developer would use. None of the prompts mention locks, downtime or pgdeadbolt.

| Case | Asked for | Passes when the migration uses |
| --- | --- | --- |
| `add-index` | an index on `users.email` | `CREATE INDEX CONCURRENTLY` |
| `add-foreign-key` | a foreign key from `orders.user_id` | `NOT VALID`, then `VALIDATE CONSTRAINT` |
| `add-uuid-column` | an auto-filled `uuid` column | no volatile default on `ADD COLUMN`, `SET DEFAULT` after |
| `require-email` | `users.email NOT NULL` | a `NOT VALID` check, then `VALIDATE CONSTRAINT` |
| `unique-email` | a unique constraint on `users.email` | a concurrent unique index, then `USING INDEX` |
| `positive-total` | a `CHECK` on `orders.total` | `NOT VALID`, then `VALIDATE CONSTRAINT` |
| `add-bio` | a nullable text column | the column (a control: safe already, the plugin must not get in the way) |

Every case except `add-bio` also gives half credit for setting `lock_timeout`.

Run it with and without the plugin (the eval runner adds the no-plugin baseline arm on its own):

```bash
claude plugin eval . --scaffold --allow-tools Bash Write Edit
```

`--scaffold` runs `scaffold.sh` in a throwaway directory for each run. The plugin's hook calls `npx pgdeadbolt`, so the package has to be published (or `PGDEADBOLT_BIN` set to a local build) for the with-plugin arm to mean anything.
