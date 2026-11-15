---

title: refresh-matview-blocking
description: Refresh materialized views concurrently.
sidebar:
order: 13
badge:
text: warning
variant: caution
---

**Refresh materialized views concurrently.** Takes `ACCESS EXCLUSIVE`.

A plain refresh locks the view for the whole recompute, so every read of it waits.

## Instead of

```sql
REFRESH MATERIALIZED VIEW daily_stats;
```

## Do

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_stats;
```

Concurrent refresh needs a unique index on the view.

To skip this rule for one statement, put `-- pgdeadbolt-ignore refresh-matview-blocking` on the line above it.
