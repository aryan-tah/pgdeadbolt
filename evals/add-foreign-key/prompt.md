---
max_turns: 15
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
---
orders.user_id should reference users.id. Add a migration with the foreign key. Write it as `db/migrations/0002_orders_user_fk.sql`.
