---
max_turns: 15
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
---
Add a public_id uuid column to users that's filled in automatically with a random UUID, including for existing users. Write it as `db/migrations/0002_users_public_id.sql`.
