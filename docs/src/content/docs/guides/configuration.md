---

title: Configuration
description: Set Postgres version, transaction mode and ignored rules once.
---

Put a `pgdeadbolt.config.json` in the directory you run pgdeadbolt from:

```json
{
  "pgVersion": 15,
  "inTransaction": true,
  "ignore": ["rename"],
  "failOnWarning": false
}
```

Or add a `"pgdeadbolt"` key with the same fields to `package.json`. Command-line flags win over the file.

| Field           | Flag                | Default | Meaning                                      |
| --------------- | ------------------- | ------- | -------------------------------------------- |
| `pgVersion`     | `--pg-version`      | `16`    | Postgres major version the migrations run on |
| `inTransaction` | `--in-transaction`  | `false` | Your tool wraps each file in a transaction   |
| `ignore`        | `--ignore a,b`      | `[]`    | Rule IDs to turn off everywhere              |
| `failOnWarning` | `--fail-on-warning` | `false` | Exit 1 on warnings too                       |

## Ignoring one statement

Some findings are deliberate. A table you know stays tiny can take a plain `CREATE INDEX`. Put an ignore comment on the line above the statement, and say why:

```sql
-- feature_flags never has more than a few hundred rows.
-- pgdeadbolt-ignore require-concurrent-index
CREATE INDEX feature_flags_key ON feature_flags (key);
```

List several rules with commas. To ignore a rule for a whole file:

```sql
-- pgdeadbolt-ignore-file rename
```

## Output formats

`--format` takes `pretty` (default in a terminal), `json`, `github` (default inside GitHub Actions; becomes inline annotations), or `sarif` (for GitHub code scanning and other SARIF tools).
