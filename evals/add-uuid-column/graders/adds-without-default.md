---
type: regex
pattern: 'ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?"?public_id"?\s+uuid\s*[;,]'
flags: i
target:
  source: file
  path: db/migrations/0002_users_public_id.sql
---
