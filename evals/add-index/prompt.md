---
max_turns: 15
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
---
Our users table is getting slow to search by email. Add a migration that indexes users.email. Write it as `db/migrations/0002_users_email_index.sql`.
