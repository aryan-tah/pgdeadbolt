import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSql } from "../src/parse.js";
import { rehearse, tablesIn } from "../src/rehearse/index.js";
import { seedTable } from "../src/rehearse/seed.js";

describe("tablesIn", () => {
  it("finds the target table and tables a foreign key references", async () => {
    const [stmt] = await parseSql(
      "ALTER TABLE app.orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id);",
    );
    expect(tablesIn(stmt!).sort()).toEqual(["app.orders", "users"]);
  });

  it("doesn't treat an index name as a table", async () => {
    const [stmt] = await parseSql("REINDEX INDEX CONCURRENTLY users_email_idx;");
    expect(tablesIn(stmt!)).toEqual([]);
  });
});

const url = process.env.DATABASE_URL;

// Needs a disposable Postgres: CI provides one; locally, run
//   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16-alpine
// and DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm test
describe.skipIf(!url)("rehearse (needs DATABASE_URL)", () => {
  const table = `rh_${process.pid}`;
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(`DROP TABLE IF EXISTS ${table}`);
    await client.query(
      `CREATE TABLE ${table} (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL, created_at timestamptz NOT NULL)`,
    );
    await seedTable(client, table, 300_000);
  }, 120_000);

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS ${table}`);
    await client.end();
  });

  it("seeds the requested number of rows", async () => {
    const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    expect(Number(rows[0]?.n)).toBe(300_000);
  });

  it("measures that CREATE INDEX blocks writes and CONCURRENTLY doesn't", async () => {
    const [blocking] = await rehearse(`CREATE INDEX ${table}_a ON ${table} (email);`, { url: url as string });
    const [concurrent] = await rehearse(`CREATE INDEX CONCURRENTLY ${table}_b ON ${table} (email);`, {
      url: url as string,
    });
    expect(blocking?.locks[0]).toEqual({ relation: table, mode: "SHARE" });
    expect(concurrent?.locks[0]).toEqual({ relation: table, mode: "SHARE UPDATE EXCLUSIVE" });
    // A blocking build holds up writes for most of its run; a concurrent one barely at all.
    expect(blocking!.writeBlockedMs).toBeGreaterThan(blocking!.durationMs * 0.5);
    expect(concurrent!.writeBlockedMs).toBeLessThan(blocking!.writeBlockedMs);
    // Reads aren't blocked by a SHARE lock.
    expect(blocking!.readBlockedMs).toBeLessThan(blocking!.writeBlockedMs);
  }, 120_000);

  it("sees ACCESS EXCLUSIVE when a column add rewrites the table", async () => {
    const [r] = await rehearse(`ALTER TABLE ${table} ADD COLUMN token uuid DEFAULT gen_random_uuid();`, {
      url: url as string,
    });
    expect(r?.locks[0]?.mode).toBe("ACCESS EXCLUSIVE");
    expect(r!.readBlockedMs).toBeGreaterThan(0);
  }, 120_000);

  it("stops at a failing statement and reports the error", async () => {
    const results = await rehearse(`ALTER TABLE ${table} ADD COLUMN x int; SELECT * FROM nope; SELECT 1;`, {
      url: url as string,
    });
    expect(results).toHaveLength(2);
    expect(results[1]?.error).toMatch(/nope/);
  }, 60_000);
});
