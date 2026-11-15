import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";

/** Rule IDs found in a migration, ignoring the lock_timeout reminder unless asked for. */
async function ruleIds(sql: string, opts: Parameters<typeof analyze>[1] = {}, withTimeout = false) {
  const { findings } = await analyze(sql, opts);
  return findings.map((f) => f.rule).filter((r) => withTimeout || r !== "require-lock-timeout");
}

// [rule, dangerous SQL, its safe equivalent]
const cases: [string, string, string][] = [
  [
    "require-concurrent-index",
    "CREATE INDEX idx ON users (email);",
    "CREATE INDEX CONCURRENTLY idx ON users (email);",
  ],
  [
    "require-concurrent-index",
    "CREATE UNIQUE INDEX idx ON users (email);",
    "CREATE UNIQUE INDEX CONCURRENTLY idx ON users (email);",
  ],
  ["require-concurrent-index-drop", "DROP INDEX idx;", "DROP INDEX CONCURRENTLY idx;"],
  [
    "add-column-rewrite",
    "ALTER TABLE users ADD COLUMN token uuid DEFAULT gen_random_uuid();",
    "ALTER TABLE users ADD COLUMN token uuid;",
  ],
  [
    "add-column-rewrite",
    "ALTER TABLE users ADD COLUMN seen timestamptz DEFAULT clock_timestamp();",
    "ALTER TABLE users ADD COLUMN seen timestamptz DEFAULT now();",
  ],
  [
    "add-column-rewrite",
    "ALTER TABLE users ADD COLUMN n bigserial;",
    "ALTER TABLE users ADD COLUMN n bigint;",
  ],
  [
    "add-column-rewrite",
    "ALTER TABLE users ADD COLUMN n int GENERATED ALWAYS AS IDENTITY;",
    "ALTER TABLE users ADD COLUMN n int;",
  ],
  [
    "add-column-rewrite",
    "ALTER TABLE users ADD COLUMN d int GENERATED ALWAYS AS (a * 2) STORED;",
    "ALTER TABLE users ADD COLUMN d int DEFAULT 0;",
  ],
  [
    "set-not-null",
    "ALTER TABLE users ALTER COLUMN email SET NOT NULL;",
    "ALTER TABLE users ADD CONSTRAINT c CHECK (email IS NOT NULL) NOT VALID;",
  ],
  [
    "change-column-type",
    "ALTER TABLE users ALTER COLUMN id TYPE bigint;",
    "ALTER TABLE users ADD COLUMN id_new bigint;",
  ],
  [
    "add-foreign-key-validated",
    "ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id);",
    "ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID;",
  ],
  [
    "add-check-validated",
    "ALTER TABLE users ADD CONSTRAINT age_pos CHECK (age > 0);",
    "ALTER TABLE users ADD CONSTRAINT age_pos CHECK (age > 0) NOT VALID;",
  ],
  [
    "add-unique-or-primary-key",
    "ALTER TABLE users ADD CONSTRAINT email_key UNIQUE (email);",
    "ALTER TABLE users ADD CONSTRAINT email_key UNIQUE USING INDEX email_idx;",
  ],
  [
    "add-unique-or-primary-key",
    "ALTER TABLE users ADD PRIMARY KEY (id);",
    "ALTER TABLE users ADD PRIMARY KEY USING INDEX users_pkey_idx;",
  ],
  [
    "rename",
    "ALTER TABLE users RENAME COLUMN email TO email_address;",
    "ALTER TABLE users ADD COLUMN email_address text;",
  ],
  ["rename", "ALTER TABLE users RENAME TO accounts;", "CREATE VIEW accounts AS SELECT * FROM users;"],
  [
    "drop-column-or-table",
    "ALTER TABLE users DROP COLUMN legacy;",
    "ALTER TABLE users ALTER COLUMN legacy DROP NOT NULL;",
  ],
  ["drop-column-or-table", "DROP TABLE old_users;", "SELECT 1;"],
  ["table-rewrite-command", "VACUUM FULL users;", "VACUUM users;"],
  ["table-rewrite-command", "CLUSTER users USING users_pkey;", "ANALYZE users;"],
  [
    "refresh-matview-blocking",
    "REFRESH MATERIALIZED VIEW stats;",
    "REFRESH MATERIALIZED VIEW CONCURRENTLY stats;",
  ],
  ["reindex-blocking", "REINDEX INDEX idx;", "REINDEX INDEX CONCURRENTLY idx;"],
  ["explicit-lock-table", "LOCK TABLE users IN ACCESS EXCLUSIVE MODE;", "SELECT 1;"],
];

describe("rules", () => {
  it.each(cases)("%s fires on: %s", async (rule, bad) => {
    expect(await ruleIds(bad)).toContain(rule);
  });

  it.each(cases)("%s stays quiet on the safe form of: %s", async (rule, _bad, safe) => {
    expect(await ruleIds(safe)).not.toContain(rule);
  });

  it("allows constant and stable defaults on Postgres 11+", async () => {
    for (const d of ["0", "'pending'", "now()", "CURRENT_TIMESTAMP", "true", "'{}'::jsonb"]) {
      expect(await ruleIds(`ALTER TABLE users ADD COLUMN x text DEFAULT ${d};`)).toEqual([]);
    }
  });

  it("flags any default before Postgres 11", async () => {
    expect(await ruleIds("ALTER TABLE users ADD COLUMN x int DEFAULT 0;", { pgVersion: 10 })).toContain(
      "add-column-rewrite",
    );
  });

  it("warns, not errors, when the default calls an unknown function", async () => {
    const { findings } = await analyze("ALTER TABLE users ADD COLUMN x int DEFAULT my_fn();");
    const f = findings.find((x) => x.rule === "add-column-rewrite");
    expect(f?.severity).toBe("warning");
  });

  it("checks every command in a multi-command ALTER TABLE", async () => {
    const ids = await ruleIds(
      "ALTER TABLE users ADD COLUMN t uuid DEFAULT gen_random_uuid(), ALTER COLUMN email SET NOT NULL;",
    );
    expect(ids).toEqual(expect.arrayContaining(["add-column-rewrite", "set-not-null"]));
  });
});

describe("context", () => {
  it("ignores lock rules on a table created earlier in the same file", async () => {
    const sql = `CREATE TABLE widgets (id bigint);
      CREATE INDEX widgets_id ON widgets (id);
      ALTER TABLE widgets ADD COLUMN token uuid DEFAULT gen_random_uuid();
      ALTER TABLE public.widgets ALTER COLUMN id SET NOT NULL;`;
    expect(await ruleIds(sql, {}, true)).toEqual([]);
  });

  it("flags CONCURRENTLY inside an explicit transaction", async () => {
    const sql = "BEGIN; CREATE INDEX CONCURRENTLY idx ON users (email); COMMIT;";
    expect(await ruleIds(sql)).toContain("concurrently-in-transaction");
  });

  it("flags CONCURRENTLY when the tool wraps files in a transaction", async () => {
    expect(
      await ruleIds("CREATE INDEX CONCURRENTLY idx ON users (email);", { inTransaction: true }),
    ).toContain("concurrently-in-transaction");
  });

  it("allows CONCURRENTLY after the transaction commits", async () => {
    const sql = "BEGIN; SELECT 1; COMMIT; CREATE INDEX CONCURRENTLY idx ON users (email);";
    expect(await ruleIds(sql)).toEqual([]);
  });

  it("asks for lock_timeout once per file", async () => {
    const sql = "ALTER TABLE users ADD COLUMN a text; ALTER TABLE users ADD COLUMN b text;";
    const ids = await ruleIds(sql, {}, true);
    expect(ids.filter((r) => r === "require-lock-timeout")).toHaveLength(1);
  });

  it("doesn't ask for lock_timeout when it's set first", async () => {
    for (const set of ["SET lock_timeout = '2s';", "SET LOCAL lock_timeout TO 2000;"]) {
      expect(await ruleIds(`${set} ALTER TABLE users ADD COLUMN a text;`, {}, true)).toEqual([]);
    }
  });

  it("treats lock_timeout = 0 as not set", async () => {
    const ids = await ruleIds("SET lock_timeout = 0; ALTER TABLE users ADD COLUMN a text;", {}, true);
    expect(ids).toContain("require-lock-timeout");
  });

  it("doesn't ask for lock_timeout for VALIDATE CONSTRAINT alone", async () => {
    expect(await ruleIds("ALTER TABLE orders VALIDATE CONSTRAINT fk;", {}, true)).toEqual([]);
  });
});

describe("ignores", () => {
  it("honours an ignore comment above a statement", async () => {
    const sql = "-- pgdeadbolt-ignore require-concurrent-index\nCREATE INDEX idx ON users (email);";
    expect(await ruleIds(sql)).toEqual([]);
  });

  it("only ignores the statement the comment is attached to", async () => {
    const sql =
      "-- pgdeadbolt-ignore require-concurrent-index\nCREATE INDEX a ON users (email);\nCREATE INDEX b ON users (name);";
    expect(await ruleIds(sql)).toEqual(["require-concurrent-index"]);
  });

  it("honours a file-wide ignore", async () => {
    const sql = "-- pgdeadbolt-ignore-file rename\nALTER TABLE users RENAME COLUMN a TO b;";
    expect(await ruleIds(sql)).toEqual([]);
  });

  it("honours ignores passed as options", async () => {
    expect(await ruleIds("VACUUM FULL users;", { ignore: ["table-rewrite-command"] })).toEqual([]);
  });
});

describe("positions", () => {
  it("reports the line and column where each statement starts, after comments", async () => {
    const sql = "-- add things\nSELECT 1;\n\n  -- index\n  CREATE INDEX idx ON users (email);";
    const { findings } = await analyze(sql);
    const f = findings.find((x) => x.rule === "require-concurrent-index");
    expect(f).toMatchObject({ line: 5, column: 3 });
    expect(f?.statement.startsWith("CREATE INDEX")).toBe(true);
  });

  it("counts lines correctly after multi-byte characters", async () => {
    const sql = "-- café ☕ migration\nCREATE INDEX idx ON users (email);";
    const { findings } = await analyze(sql);
    expect(findings[0]).toMatchObject({ line: 2, column: 1 });
  });
});

describe("fixes", () => {
  it("rewrites CREATE INDEX with CONCURRENTLY", async () => {
    const { findings } = await analyze("CREATE UNIQUE INDEX idx ON users (email);");
    expect(findings[0]?.fix).toContain("CREATE UNIQUE INDEX CONCURRENTLY idx ON users (email);");
  });

  it("splits a foreign key into NOT VALID and VALIDATE", async () => {
    const { findings } = await analyze(
      "ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id);",
    );
    const fix = findings.find((f) => f.rule === "add-foreign-key-validated")?.fix ?? "";
    expect(fix).toContain("NOT VALID;");
    expect(fix).toContain("ALTER TABLE orders VALIDATE CONSTRAINT fk;");
  });

  it("maps serial types to their integer type", async () => {
    const { findings } = await analyze("ALTER TABLE users ADD COLUMN n bigserial;");
    expect(findings.find((f) => f.rule === "add-column-rewrite")?.fix).toContain("ADD COLUMN n bigint;");
  });
});
