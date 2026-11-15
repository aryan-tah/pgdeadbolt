---
type: regex
pattern: 'ADD\s+COLUMN[^;]*bio'
flags: i
target:
  source: file
  path: db/migrations/0002_users_bio.sql
---
