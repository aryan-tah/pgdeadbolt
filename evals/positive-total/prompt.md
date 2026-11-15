---
max_turns: 15
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
---
Order totals can never be negative. Add a migration with a CHECK constraint for that. Write it as `db/migrations/0002_orders_total_check.sql`.
