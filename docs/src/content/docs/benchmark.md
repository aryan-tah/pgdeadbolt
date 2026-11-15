---
title: Benchmark
description: How long common migrations block writes, before and after pgdeadbolt's fix.
---

Each common migration, run as written and then with pgdeadbolt's fix, on a freshly seeded table. Measured with [`rehearse`](/guides/rehearse/): probe connections keep trying to write to and read from the table every 5 ms while the migration runs.

Postgres 16.16, 1,000,000 rows in `users`, measured with `pgdeadbolt rehearse` on 2026-11-15.

| Migration | Writes blocked, unsafe | Writes blocked, with pgdeadbolt's fix | Reads blocked, unsafe → fixed |
| --- | --- | --- | --- |
| Add an index | **1.03 s** | **4 ms** | 6 ms → 4 ms |
| Add a foreign key | **309 ms** | **3 ms** | 3 ms → 3 ms |
| Add a CHECK constraint | **47 ms** | **3 ms** | 47 ms → 3 ms |
| Make a column NOT NULL | **48 ms** | **5 ms** | 48 ms → 5 ms |
| Add a UNIQUE constraint | **655 ms** | **3 ms** | 655 ms → 3 ms |
| Add a column with a volatile default | **1.22 s** | **3 ms** | 1.22 s → 2 ms |
| Add a bigserial column | **4.58 s** | **2 ms** | 4.58 s → 2 ms |
| Change a column type | **540 ms** | **2 ms** | 540 ms → 2 ms |


## Reading the numbers

- **Lock time grows with table size.** These are 1 million rows on a laptop. Production tables are often 100 times bigger, and the blocking grows with them.
- **"Fixed" is the migration step only.** Some fixes move work out of the migration, such as backfilling a new column in batches. That work still happens, but in small transactions that never block the table for long.
- **The fix doesn't make the operation faster.** A concurrent index build takes about as long as a blocking one. The difference is that writes keep flowing while it runs.

## Reproduce it

```bash
git clone https://github.com/aryan-tah/pgdeadbolt
cd pgdeadbolt
npm install
npm run bench -- --rows 1000000 --pg 16
```

It needs Docker. Raw results, including each statement's lock and duration, are in [`bench/results`](https://github.com/aryan-tah/pgdeadbolt/tree/main/bench/results).
