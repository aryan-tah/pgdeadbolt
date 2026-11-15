---
type: regex
pattern: 'SET\s+DEFAULT\s+(gen_random_uuid|uuid_generate_v4)'
flags: i
target:
  source: file
  path: db/migrations/0002_users_public_id.sql
---
