---

title: add-foreign-key-validated
description: Add foreign keys as NOT VALID first.
sidebar:
order: 7
badge:
text: error
variant: danger
---

**Add foreign keys as NOT VALID first.** Takes `SHARE ROW EXCLUSIVE`.

Adding a foreign key checks every existing row against the referenced table, and locks both tables against writes while it does.

## Instead of

```sql
ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id);
```

## Do

```sql
ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk;
```

`NOT VALID` makes the constraint apply to new rows immediately, with only a brief lock. `VALIDATE CONSTRAINT` then checks old rows without blocking writes.

To skip this rule for one statement, put `-- pgdeadbolt-ignore add-foreign-key-validated` on the line above it.
