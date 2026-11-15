---
type: regex
pattern: 'FOREIGN\s+KEY[^;]*NOT\s+VALID'
flags: i
target:
  source: file
  path: db/migrations/0002_orders_user_fk.sql
---
