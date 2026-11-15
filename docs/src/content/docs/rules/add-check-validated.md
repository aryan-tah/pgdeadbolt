---
title: add-check-validated
description: Add CHECK constraints as NOT VALID first.
sidebar:
  order: 8
---

Severity: **error** · Lock: `ACCESS EXCLUSIVE`

Adding a `CHECK` constraint scans the whole table to validate it while holding `ACCESS EXCLUSIVE`.

## Instead of

```sql
ALTER TABLE orders ADD CONSTRAINT orders_total_positive CHECK (total >= 0);
```

## Do

```sql
ALTER TABLE orders ADD CONSTRAINT orders_total_positive CHECK (total >= 0) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_total_positive;
```

To skip this rule for one statement, put `-- pgdeadbolt-ignore add-check-validated` on the line above it.
