#!/usr/bin/env bash
# Shared starting project for every case: a small app with plain SQL migrations.
set -euo pipefail
mkdir -p db/migrations
cat > db/migrations/0001_init.sql <<'SQL'
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  total numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
SQL
cat > README.md <<'MD'
# shop

Postgres 16. Migrations are plain SQL files in db/migrations, applied in order by our deploy script, one file at a time, without wrapping them in a transaction.
MD
