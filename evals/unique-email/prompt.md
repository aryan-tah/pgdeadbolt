---
max_turns: 15
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
---
Emails must be unique. Add a migration with a unique constraint on users.email. Write it as `db/migrations/0002_users_email_unique.sql`.
