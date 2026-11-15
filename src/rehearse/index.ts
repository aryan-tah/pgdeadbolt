import pg from "pg";
import { body, kind, parseSql } from "../parse.js";
import { tableName } from "../rules/index.js";
import type { LockMode, Statement } from "../types.js";

export interface StatementResult {
  index: number;
  line: number;
  statement: string;
  /** How long the statement itself took. */
  durationMs: number;
  /** Tables the statement touched, which were probed. */
  tables: string[];
  /** Locks the migration's connection was seen holding on tables, strongest first. */
  locks: { relation: string; mode: LockMode }[];
  /** Longest a probe write (ROW EXCLUSIVE) waited on any touched table. */
  writeBlockedMs: number;
  /** Longest a probe read (ACCESS SHARE) waited on any touched table. */
  readBlockedMs: number;
  error?: string;
}

export interface RehearseOptions {
  url: string;
  /** How often probes try to take their lock. Default 5 ms. */
  probeIntervalMs?: number;
  /** Called after each statement, for progress output. */
  onStatement?: (r: StatementResult) => void;
}

const LOCK_ORDER: LockMode[] = [
  "ACCESS SHARE",
  "ROW SHARE",
  "ROW EXCLUSIVE",
  "SHARE UPDATE EXCLUSIVE",
  "SHARE",
  "SHARE ROW EXCLUSIVE",
  "EXCLUSIVE",
  "ACCESS EXCLUSIVE",
];

const MODE_FROM_PG: Record<string, LockMode> = {
  AccessShareLock: "ACCESS SHARE",
  RowShareLock: "ROW SHARE",
  RowExclusiveLock: "ROW EXCLUSIVE",
  ShareUpdateExclusiveLock: "SHARE UPDATE EXCLUSIVE",
  ShareLock: "SHARE",
  ShareRowExclusiveLock: "SHARE ROW EXCLUSIVE",
  ExclusiveLock: "EXCLUSIVE",
  AccessExclusiveLock: "ACCESS EXCLUSIVE",
};

/** Every table a statement names: the target, plus referenced tables for foreign keys. */
export function tablesIn(stmt: Statement): string[] {
  const out = new Set<string>();
  const visit = (node: unknown, key?: string) => {
    if (Array.isArray(node)) for (const n of node) visit(n);
    else if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if ((key === "relation" || key === "pktable" || key === "RangeVar") && typeof o.relname === "string") {
        out.add(tableName(o as { relname: string; schemaname?: string }));
      }
      for (const [k, v] of Object.entries(o)) visit(v, k);
    }
  };
  // Index names in REINDEX INDEX / DROP INDEX aren't tables; skip those statement kinds' relations.
  const k = kind(stmt);
  if (k === "ReindexStmt" && body<{ kind?: string }>(stmt).kind === "REINDEX_OBJECT_INDEX") return [];
  visit(stmt.node);
  return [...out];
}

/** Quotes "schema.table" for SQL, part by part. */
function quoteTable(name: string): string {
  return name
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".");
}

/** Keeps trying to take `mode` on a table and records the longest wait. */
class Probe {
  private client: pg.Client;
  private running = false;
  private loop?: Promise<void>;
  worstMs = 0;

  constructor(
    url: string,
    private table: string,
    private mode: "ROW EXCLUSIVE" | "ACCESS SHARE",
    private intervalMs: number,
  ) {
    this.client = new pg.Client({ connectionString: url, application_name: "pgdeadbolt-probe" });
  }

  async connect() {
    await this.client.connect();
    await this.client.query("SET lock_timeout = '60s'");
  }

  start() {
    this.running = true;
    this.worstMs = 0;
    this.loop = (async () => {
      while (this.running) {
        const t0 = performance.now();
        try {
          await this.client.query("BEGIN");
          await this.client.query(`LOCK TABLE ${quoteTable(this.table)} IN ${this.mode} MODE`);
          await this.client.query("ROLLBACK");
        } catch {
          await this.client.query("ROLLBACK").catch(() => undefined);
          // The table may not exist yet (or was just dropped); that's not a wait.
          await new Promise((r) => setTimeout(r, this.intervalMs));
          continue;
        }
        this.worstMs = Math.max(this.worstMs, performance.now() - t0);
        await new Promise((r) => setTimeout(r, this.intervalMs));
      }
    })();
  }

  async stop() {
    this.running = false;
    await this.loop;
  }

  async end() {
    await this.client.end().catch(() => undefined);
  }
}

/**
 * Runs a migration against a real (disposable) Postgres and measures, for each
 * statement, how long a concurrent write or read on the same tables would have
 * waited, and which locks the migration actually held.
 *
 * Statements run exactly as written: BEGIN/COMMIT pass through, everything else
 * autocommits. Point this at a throwaway database, never production.
 */
export async function rehearse(sql: string, opts: RehearseOptions): Promise<StatementResult[]> {
  const interval = opts.probeIntervalMs ?? 5;
  const statements = await parseSql(sql);
  const migration = new pg.Client({ connectionString: opts.url, application_name: "pgdeadbolt-migration" });
  const sampler = new pg.Client({ connectionString: opts.url, application_name: "pgdeadbolt-sampler" });
  await migration.connect();
  await sampler.connect();
  const pid = (await migration.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;

  const probes = new Map<string, [Probe, Probe]>();
  const probesFor = async (table: string) => {
    let pair = probes.get(table);
    if (!pair) {
      pair = [
        new Probe(opts.url, table, "ROW EXCLUSIVE", interval),
        new Probe(opts.url, table, "ACCESS SHARE", interval),
      ];
      await Promise.all(pair.map((p) => p.connect()));
      probes.set(table, pair);
    }
    return pair;
  };

  const results: StatementResult[] = [];
  try {
    for (const stmt of statements) {
      const tables = tablesIn(stmt);
      const pairs = await Promise.all(tables.map(probesFor));
      for (const [w, r] of pairs) {
        w.start();
        r.start();
      }

      const seen = new Map<string, LockMode>();
      let sampling = true;
      const sample = (async () => {
        while (sampling) {
          const { rows } = await sampler.query<{ rel: string | null; mode: string }>(
            // Only tables, views and materialized views: an index being built shows up as an
            // unnamed OID with its own lock, which isn't what blocks traffic.
            `SELECT c.oid::regclass::text AS rel, l.mode FROM pg_locks l
               JOIN pg_class c ON c.oid = l.relation
              WHERE l.pid = $1 AND l.locktype = 'relation' AND l.granted AND c.relkind IN ('r', 'p', 'm', 'v')`,
            [pid],
          );
          for (const row of rows) {
            if (!row.rel || row.rel.startsWith("pg_")) continue;
            const mode = MODE_FROM_PG[row.mode];
            if (!mode) continue;
            const prev = seen.get(row.rel);
            if (!prev || LOCK_ORDER.indexOf(mode) > LOCK_ORDER.indexOf(prev)) seen.set(row.rel, mode);
          }
          await new Promise((r) => setTimeout(r, interval));
        }
      })();

      // Let probes and the sampler warm up so the statement starts under load.
      await new Promise((r) => setTimeout(r, interval * 4));
      const t0 = performance.now();
      let error: string | undefined;
      try {
        await migration.query(stmt.text);
      } catch (err) {
        error = (err as Error).message;
      }
      const durationMs = performance.now() - t0;
      // Give blocked probes a moment to get through and record their wait.
      await new Promise((r) => setTimeout(r, interval * 4));
      sampling = false;
      await sample;
      for (const [w, r] of pairs) await Promise.all([w.stop(), r.stop()]);

      const result: StatementResult = {
        index: stmt.index,
        line: stmt.line,
        statement: stmt.text,
        durationMs,
        tables,
        locks: [...seen.entries()]
          .map(([relation, mode]) => ({ relation, mode }))
          .sort((a, b) => LOCK_ORDER.indexOf(b.mode) - LOCK_ORDER.indexOf(a.mode)),
        writeBlockedMs: Math.max(0, ...pairs.map(([w]) => w.worstMs)),
        readBlockedMs: Math.max(0, ...pairs.map(([, r]) => r.worstMs)),
        ...(error ? { error } : {}),
      };
      results.push(result);
      opts.onStatement?.(result);
      if (error && kind(stmt) !== "TransactionStmt") break;
    }
  } finally {
    for (const [w, r] of probes.values()) await Promise.all([w.end(), r.end()]);
    await sampler.end().catch(() => undefined);
    await migration.end().catch(() => undefined);
  }
  return results;
}
