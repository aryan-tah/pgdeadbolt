---
type: regex
pattern: 'CHECK\s*\(\s*"?email"?\s+IS\s+NOT\s+NULL\s*\)\s*NOT\s+VALID'
flags: i
target:
  source: file
  path: db/migrations/0002_users_email_required.sql
---
