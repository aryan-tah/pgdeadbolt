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
