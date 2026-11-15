---
type: regex
pattern: 'CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY'
flags: i
target:
  source: file
  path: db/migrations/0002_users_email_unique.sql
---
