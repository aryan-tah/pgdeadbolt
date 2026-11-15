---

title: GitHub Action
description: Fail pull requests with migrations that would lock tables.
---

The action checks your migrations on every pull request. Findings show up as annotations on the diff, with the safe rewrite.

```yaml
name: Migrations
on: pull_request

permissions:
  contents: read

jobs:
  pgdeadbolt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aryan-tah/pgdeadbolt@v0
        with:
          paths: db/migrations
          pg-version: "16"
```

## Inputs

| Input             | Default | Meaning                                    |
| ----------------- | ------- | ------------------------------------------ |
| `paths`           | `.`     | Space-separated files or directories       |
| `pg-version`      | `16`    | Postgres major version                     |
| `in-transaction`  | `false` | Your tool wraps each file in a transaction |
| `fail-on-warning` | `false` | Fail on warnings too                       |
| `sarif-file`      | (none)  | Also write SARIF here, for code scanning   |

## Code scanning

To see findings in the Security tab, write SARIF and upload it:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - uses: aryan-tah/pgdeadbolt@v0
    with:
      paths: db/migrations
      sarif-file: pgdeadbolt.sarif
  - uses: github/codeql-action/upload-sarif@v4
    if: always()
    with:
      sarif_file: pgdeadbolt.sarif
```
