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

It parses migrations with Postgres's own parser, knows which lock each statement takes, and prints the safe way to make the same change. Run `pgdeadbolt rules` for the full list.

## License

[MIT](LICENSE)
