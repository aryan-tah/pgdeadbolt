---
type: regex
pattern: 'CHECK[^;]*NOT\s+VALID'
flags: i
target:
  source: file
  path: db/migrations/0002_orders_total_check.sql
---
