import { body, kind } from "../parse.js";
import type { Context, Rule, RuleFinding, Statement } from "../types.js";

// ---------------------------------------------------------------------------
// AST helpers. Shapes follow libpg_query's JSON output.

type Node = Record<string, unknown>;

interface RangeVar {
  schemaname?: string;
  relname?: string;
}

interface AlterTableCmd {
  subtype: string;
  name?: string;
  def?: Node;
}

/** "schema.table" or "table", as written. */
export function tableName(rv: RangeVar | undefined): string {
  if (!rv?.relname) return "?";
  return rv.schemaname ? `${rv.schemaname}.${rv.relname}` : rv.relname;
}

function stripSemicolon(text: string): string {
  return text.replace(/;\s*$/, "").trim();
}

function strings(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((n) => (n as { String?: { sval?: string } }).String?.sval ?? "").filter(Boolean);
}

/** All function names called anywhere inside an expression. */
function functionNames(expr: unknown, out: string[] = []): string[] {
  if (Array.isArray(expr)) {
    for (const e of expr) functionNames(e, out);
  } else if (expr && typeof expr === "object") {
    for (const [k, v] of Object.entries(expr as Node)) {
      if (k === "FuncCall") {
        const names = strings((v as { funcname?: unknown }).funcname);
        const last = names[names.length - 1];
        if (last) out.push(last.toLowerCase());
      }
      functionNames(v, out);
    }
  }
  return out;
}

/** Functions Postgres marks VOLATILE that people put in column defaults. */
const VOLATILE = new Set([
  "random",
  "clock_timestamp",
  "timeofday",
  "gen_random_uuid",
  "uuid_generate_v1",
  "uuid_generate_v1mc",
  "uuid_generate_v4",
  "uuidv4",
  "uuidv7",
  "nextval",
  "setseed",
  "txid_current",
]);

/** Stable or immutable functions that are safe in a default on PG 11+. */
const NON_VOLATILE = new Set([
  "now",
  "current_timestamp",
  "transaction_timestamp",
  "statement_timestamp",
  "lower",
  "upper",
  "coalesce",
  "to_jsonb",
  "jsonb_build_object",
  "json_build_object",
  "array",
]);

/** Serial pseudo-types and the integer type each one really is. */
const SERIAL_TYPES = new Map([
  ["smallserial", "smallint"],
  ["serial2", "smallint"],
  ["serial", "integer"],
  ["serial4", "integer"],
  ["bigserial", "bigint"],
  ["serial8", "bigint"],
]);

function constraintsOf(colDef: Node | undefined): Node[] {
  const list = (colDef?.ColumnDef as { constraints?: unknown } | undefined)?.constraints;
  return Array.isArray(list)
    ? (list.map((c) => (c as { Constraint?: Node }).Constraint).filter(Boolean) as Node[])
    : [];
}

function alterCmds(stmt: Statement): AlterTableCmd[] {
  const cmds = (body(stmt) as { cmds?: unknown }).cmds;
  return Array.isArray(cmds)
    ? (cmds
        .map((c) => (c as { AlterTableCmd?: AlterTableCmd }).AlterTableCmd)
        .filter(Boolean) as AlterTableCmd[])
    : [];
}

function alteredTable(stmt: Statement): string {
  return tableName((body(stmt) as { relation?: RangeVar }).relation);
}

/** A key that treats `public.users`, `users` and `"Users"`-style spellings of the same table alike. */
export function tableKey(name: string): string {
  return name
    .replace(/"/g, "")
    .toLowerCase()
    .replace(/^public\./, "");
}

/** True when the table was created earlier in the same file, so it's empty and nothing else uses it yet. */
function isNewTable(name: string, ctx: Context): boolean {
  return ctx.createdTables.has(tableKey(name));
}

function hasOption(options: unknown, name: string): boolean {
  return (
    Array.isArray(options) &&
    options.some((o) => (o as { DefElem?: { defname?: string } }).DefElem?.defname === name)
  );
}

// ---------------------------------------------------------------------------
// Rules

const requireConcurrentIndex: Rule = {
  id: "require-concurrent-index",
  severity: "error",
  summary: "CREATE INDEX without CONCURRENTLY blocks writes to the table for the whole build.",
  check(stmt, ctx) {
    if (kind(stmt) !== "IndexStmt") return [];
    const s = body<{ concurrent?: boolean; relation?: RangeVar; idxname?: string }>(stmt);
    if (s.concurrent || isNewTable(tableName(s.relation), ctx)) return [];
    return [
      {
        message: `CREATE INDEX on ${tableName(s.relation)} blocks every INSERT, UPDATE and DELETE until the index is built.`,
        why: "A plain CREATE INDEX takes a SHARE lock. Reads continue, but writes queue for as long as the build takes, which grows with table size: seconds to minutes on a big table.",
        fix: `${stripSemicolon(stmt.text).replace(/^CREATE\s+(UNIQUE\s+)?INDEX/i, (m) => `${m} CONCURRENTLY`)};\n-- CONCURRENTLY can't run inside a transaction: run it in its own migration step.`,
        lock: "SHARE",
      },
    ];
  },
};

const requireConcurrentIndexDrop: Rule = {
  id: "require-concurrent-index-drop",
  severity: "warning",
  summary: "DROP INDEX without CONCURRENTLY takes an ACCESS EXCLUSIVE lock on the table.",
  check(stmt) {
    if (kind(stmt) !== "DropStmt") return [];
    const s = body<{ removeType?: string; concurrent?: boolean }>(stmt);
    if (s.removeType !== "OBJECT_INDEX" || s.concurrent) return [];
    return [
      {
        message: "DROP INDEX without CONCURRENTLY locks the table against reads and writes.",
        why: "The drop itself is quick, but it needs an ACCESS EXCLUSIVE lock. If a long query holds the table, the DROP waits, and every query after it waits behind the DROP.",
        fix: `${stripSemicolon(stmt.text).replace(/^DROP\s+INDEX/i, "DROP INDEX CONCURRENTLY")};`,
        lock: "ACCESS EXCLUSIVE",
      },
    ];
  },
};

const concurrentlyInTransaction: Rule = {
  id: "concurrently-in-transaction",
  severity: "error",
  summary: "CONCURRENTLY operations fail inside a transaction block.",
  check(stmt, ctx) {
    if (!ctx.inTransaction) return [];
    const k = kind(stmt);
    const s = body<{ concurrent?: boolean; params?: unknown }>(stmt);
    const concurrent =
      ((k === "IndexStmt" || k === "DropStmt" || k === "RefreshMatViewStmt") && s.concurrent) ||
      (k === "ReindexStmt" && hasOption(s.params, "concurrently"));
    if (!concurrent) return [];
    return [
      {
        message: "This CONCURRENTLY statement runs inside a transaction, where Postgres refuses it.",
        why: "CREATE/DROP INDEX CONCURRENTLY, REINDEX CONCURRENTLY and friends can't run in a transaction block. The migration will fail at this line.",
        fix: "Move it to its own migration that your tool runs without a transaction (for example `disable_ddl_transaction!` in Rails, `atomic = False` in Django, or a separate file in tools that wrap each file).",
      },
    ];
  },
};

const addColumnRewrite: Rule = {
  id: "add-column-rewrite",
  severity: "error",
  summary:
    "Adding a column that needs a value per row (volatile default, serial, identity, stored generated) rewrites the table.",
  check(stmt, ctx) {
    if (kind(stmt) !== "AlterTableStmt") return [];
    const table = alteredTable(stmt);
    if (isNewTable(table, ctx)) return [];
    const out: RuleFinding[] = [];
    for (const cmd of alterCmds(stmt)) {
      if (cmd.subtype !== "AT_AddColumn") continue;
      const col = cmd.def?.ColumnDef as { colname?: string; typeName?: { names?: unknown } } | undefined;
      const colName = col?.colname ?? "?";
      const typeNames = strings(col?.typeName?.names);
      const type = (typeNames[typeNames.length - 1] ?? "").toLowerCase();
      const constraints = constraintsOf(cmd.def);
      const def = constraints.find((c) => c.contype === "CONSTR_DEFAULT");
      const fns = def ? functionNames(def.raw_expr) : [];
      const volatile = fns.filter((f) => VOLATILE.has(f));
      const unknown = fns.filter((f) => !VOLATILE.has(f) && !NON_VOLATILE.has(f));

      let reason: string | undefined;
      let severity: "error" | "warning" = "error";
      if (SERIAL_TYPES.has(type)) reason = `${type} fills every existing row from a sequence`;
      else if (constraints.some((c) => c.contype === "CONSTR_IDENTITY"))
        reason = "an identity column fills every existing row";
      else if (constraints.some((c) => c.contype === "CONSTR_GENERATED"))
        reason = "a stored generated column is computed for every existing row";
      else if (volatile.length)
        reason = `the default calls ${volatile.join(", ")}(), which is volatile, so each row gets its own value`;
      else if (def && ctx.options.pgVersion < 11)
        reason = "before Postgres 11, any default rewrites the table";
      else if (unknown.length) {
        reason = `the default calls ${unknown.join(", ")}(); if that function is VOLATILE, every row is rewritten`;
        severity = "warning";
      }
      if (!reason) continue;
      out.push({
        severity,
        message: `ADD COLUMN ${colName} on ${table} rewrites the whole table: ${reason}.`,
        why: "A table rewrite holds an ACCESS EXCLUSIVE lock, blocking all reads and writes, for as long as it takes to copy every row.",
        fix: [
          `ALTER TABLE ${table} ADD COLUMN ${colName} ${SERIAL_TYPES.get(type) ?? (typeNames.join(".") || "<type>")};`,
          `-- Backfill existing rows in small batches, outside the migration's transaction:`,
          `--   UPDATE ${table} SET ${colName} = <value> WHERE id BETWEEN $1 AND $2;`,
          `-- Then set the default for new rows (cheap, no rewrite):`,
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${volatile.length === 1 && fns.length === 1 ? `${volatile[0]}()` : "<expression>"};`,
        ].join("\n"),
        lock: "ACCESS EXCLUSIVE",
      });
    }
    return out;
  },
};

const setNotNull: Rule = {
  id: "set-not-null",
  severity: "error",
  summary: "SET NOT NULL scans the whole table under an ACCESS EXCLUSIVE lock.",
  check(stmt, ctx) {
    if (kind(stmt) !== "AlterTableStmt") return [];
    const table = alteredTable(stmt);
    if (isNewTable(table, ctx)) return [];
    return alterCmds(stmt)
      .filter((c) => c.subtype === "AT_SetNotNull")
      .map((c) => {
        const col = c.name ?? "?";
        const check = `${(table.split(".").pop() ?? table).replace(/"/g, "")}_${col}_not_null`;
        return {
          message: `SET NOT NULL on ${table}.${col} blocks reads and writes while Postgres checks every row.`,
          why: "Postgres has to prove no row is null. Without a valid CHECK constraint to rely on, it scans the whole table while holding ACCESS EXCLUSIVE.",
          fix:
            ctx.options.pgVersion >= 12
              ? [
                  `ALTER TABLE ${table} ADD CONSTRAINT ${check} CHECK (${col} IS NOT NULL) NOT VALID;`,
                  `ALTER TABLE ${table} VALIDATE CONSTRAINT ${check};  -- scans, but doesn't block writes`,
                  `ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL;  -- Postgres 12+ uses the check, no scan`,
                  `ALTER TABLE ${table} DROP CONSTRAINT ${check};`,
                ].join("\n")
              : `On Postgres ${ctx.options.pgVersion}, keep a CHECK (${col} IS NOT NULL) constraint (added NOT VALID, then validated) instead of SET NOT NULL.`,
          lock: "ACCESS EXCLUSIVE" as const,
        };
      });
  },
};

const changeColumnType: Rule = {
  id: "change-column-type",
  severity: "error",
  summary: "Changing a column's type usually rewrites the table and its indexes.",
  check(stmt, ctx) {
    if (kind(stmt) !== "AlterTableStmt") return [];
    const table = alteredTable(stmt);
    if (isNewTable(table, ctx)) return [];
    return alterCmds(stmt)
      .filter((c) => c.subtype === "AT_AlterColumnType")
      .map((c) => {
        const names = strings(
          (c.def?.ColumnDef as { typeName?: { names?: unknown } } | undefined)?.typeName?.names,
        );
        const to = names[names.length - 1] ?? "?";
        return {
          message: `Changing ${table}.${c.name ?? "?"} to ${to} rewrites the table and rebuilds its indexes.`,
          why: "Most type changes copy every row under ACCESS EXCLUSIVE, blocking reads and writes. A few are metadata-only (varchar to text, or making a varchar longer); if this is one of them, ignore this finding.",
          fix: [
            "Expand and contract instead:",
            `1. ALTER TABLE ${table} ADD COLUMN ${c.name ?? "col"}_new ${names.join(".")};`,
            "2. Write to both columns from the app, and backfill old rows in batches.",
            "3. Switch reads to the new column, then drop the old one in a later deploy.",
          ].join("\n"),
          lock: "ACCESS EXCLUSIVE" as const,
        };
      });
  },
};

function validatedConstraintRule(
  id: string,
  contype: string,
  label: string,
  lock: "SHARE ROW EXCLUSIVE" | "ACCESS EXCLUSIVE",
  why: string,
): Rule {
  return {
    id,
    severity: "error",
    summary: `Adding a ${label} without NOT VALID checks every row while holding a lock.`,
    check(stmt, ctx) {
      if (kind(stmt) !== "AlterTableStmt") return [];
      const table = alteredTable(stmt);
      if (isNewTable(table, ctx)) return [];
      return alterCmds(stmt)
        .filter((c) => c.subtype === "AT_AddConstraint")
        .map(
          (c) =>
            c.def?.Constraint as
              | { contype?: string; skip_validation?: boolean; conname?: string }
              | undefined,
        )
        .filter((con) => con?.contype === contype && !con.skip_validation)
        .map((con) => ({
          message: `Adding ${label} ${con?.conname ? `${con.conname} ` : ""}on ${table} validates every row while holding ${lock}.`,
          why,
          fix: con?.conname
            ? `${stripSemicolon(stmt.text)} NOT VALID;\nALTER TABLE ${table} VALIDATE CONSTRAINT ${con.conname};  -- separate step: checks rows without blocking writes`
            : `Name the constraint, add it NOT VALID, then run ALTER TABLE ${table} VALIDATE CONSTRAINT <name>; as a separate step.`,
          lock,
        }));
    },
  };
}

const addForeignKey = validatedConstraintRule(
  "add-foreign-key-validated",
  "CONSTR_FOREIGN",
  "FOREIGN KEY",
  "SHARE ROW EXCLUSIVE",
  "Postgres checks every existing row against the referenced table and locks both tables against writes while it does.",
);

const addCheck = validatedConstraintRule(
  "add-check-validated",
  "CONSTR_CHECK",
  "CHECK constraint",
  "ACCESS EXCLUSIVE",
  "Postgres scans the whole table to validate the check, blocking reads and writes the entire time.",
);

const addUniqueOrPrimaryKey: Rule = {
  id: "add-unique-or-primary-key",
  severity: "error",
  summary: "Adding UNIQUE or PRIMARY KEY builds an index under an ACCESS EXCLUSIVE lock.",
  check(stmt, ctx) {
    if (kind(stmt) !== "AlterTableStmt") return [];
    const table = alteredTable(stmt);
    if (isNewTable(table, ctx)) return [];
    return alterCmds(stmt)
      .filter((c) => c.subtype === "AT_AddConstraint")
      .map(
        (c) =>
          c.def?.Constraint as
            | { contype?: string; indexname?: string; conname?: string; keys?: unknown }
            | undefined,
      )
      .filter(
        (con) => (con?.contype === "CONSTR_UNIQUE" || con?.contype === "CONSTR_PRIMARY") && !con.indexname,
      )
      .map((con) => {
        const cols = strings(con?.keys);
        const pk = con?.contype === "CONSTR_PRIMARY";
        const idx = `${(table.split(".").pop() ?? table).replace(/"/g, "")}_${cols.join("_") || "key"}_idx`;
        return {
          message: `Adding ${pk ? "a PRIMARY KEY" : "a UNIQUE constraint"} on ${table} builds its index while blocking reads and writes.`,
          why: "The index behind the constraint is built under ACCESS EXCLUSIVE, so the table is unusable for the whole build.",
          fix: [
            `CREATE UNIQUE INDEX CONCURRENTLY ${idx} ON ${table} (${cols.join(", ") || "<columns>"});`,
            `ALTER TABLE ${table} ADD CONSTRAINT ${con?.conname ?? `${idx.replace(/_idx$/, "")}_${pk ? "pkey" : "key"}`} ${pk ? "PRIMARY KEY" : "UNIQUE"} USING INDEX ${idx};`,
            pk ? "-- The columns must already be NOT NULL, or Postgres scans the table to check." : "",
          ]
            .filter(Boolean)
            .join("\n"),
          lock: "ACCESS EXCLUSIVE" as const,
        };
      });
  },
};

const renameObject: Rule = {
  id: "rename",
  severity: "warning",
  summary: "Renaming a column or table breaks application code that's still running.",
  check(stmt, ctx) {
    if (kind(stmt) !== "RenameStmt") return [];
    const s = body<{ renameType?: string; relation?: RangeVar; subname?: string; newname?: string }>(stmt);
    if (s.renameType !== "OBJECT_COLUMN" && s.renameType !== "OBJECT_TABLE") return [];
    const table = tableName(s.relation);
    if (isNewTable(table, ctx)) return [];
    const what = s.renameType === "OBJECT_COLUMN" ? `column ${table}.${s.subname}` : `table ${table}`;
    return [
      {
        message: `Renaming ${what} to ${s.newname} breaks any running code that still uses the old name.`,
        why: "During a deploy, old app servers keep running against the new schema. Their queries fail until they're replaced.",
        fix: "Expand and contract: add the new name, write to both, move reads over, then remove the old name in a later deploy. For tables, a view under the old name can bridge the gap.",
        lock: "ACCESS EXCLUSIVE",
      },
    ];
  },
};

const dropColumnOrTable: Rule = {
  id: "drop-column-or-table",
  severity: "warning",
  summary: "Dropping a column or table breaks code that still uses it, and can't be undone.",
  check(stmt, ctx) {
    const k = kind(stmt);
    if (k === "AlterTableStmt") {
      const table = alteredTable(stmt);
      if (isNewTable(table, ctx)) return [];
      return alterCmds(stmt)
        .filter((c) => c.subtype === "AT_DropColumn")
        .map((c) => ({
          message: `Dropping column ${table}.${c.name} breaks running code that still selects or writes it.`,
          why: "Old app servers keep running during a deploy. Queries that name the column fail, and ORMs that SELECT * can break too.",
          fix: "Stop reading and writing the column in one deploy (many ORMs have an ignored-columns setting), then drop it in the next.",
          lock: "ACCESS EXCLUSIVE" as const,
        }));
    }
    if (k === "DropStmt") {
      const s = body<{ removeType?: string; objects?: unknown }>(stmt);
      if (s.removeType !== "OBJECT_TABLE") return [];
      return [
        {
          message: "DROP TABLE deletes the data and breaks any running code that still uses the table.",
          why: "It can't be undone without a backup, and it waits for an ACCESS EXCLUSIVE lock like any other DDL.",
          fix: "Remove all code that uses the table first. Consider renaming it to <name>_deprecated for one release before dropping.",
          lock: "ACCESS EXCLUSIVE",
        },
      ];
    }
    return [];
  },
};

const tableRewriteCommand: Rule = {
  id: "table-rewrite-command",
  severity: "error",
  summary: "VACUUM FULL and CLUSTER rewrite the table under an ACCESS EXCLUSIVE lock.",
  check(stmt) {
    const k = kind(stmt);
    const full = k === "VacuumStmt" && hasOption(body<{ options?: unknown }>(stmt).options, "full");
    if (!full && k !== "ClusterStmt") return [];
    return [
      {
        message: `${full ? "VACUUM FULL" : "CLUSTER"} rewrites the table and blocks all reads and writes until it finishes.`,
        why: "Both copy the entire table into new storage while holding ACCESS EXCLUSIVE.",
        fix: "Use pg_repack or pg_squeeze, which rebuild tables online, and run them outside migrations.",
        lock: "ACCESS EXCLUSIVE",
      },
    ];
  },
};

const refreshMatviewBlocking: Rule = {
  id: "refresh-matview-blocking",
  severity: "warning",
  summary: "REFRESH MATERIALIZED VIEW without CONCURRENTLY blocks reads of the view.",
  check(stmt) {
    if (kind(stmt) !== "RefreshMatViewStmt" || body<{ concurrent?: boolean }>(stmt).concurrent) return [];
    return [
      {
        message:
          "REFRESH MATERIALIZED VIEW without CONCURRENTLY blocks every read of the view until it finishes.",
        why: "A plain refresh holds ACCESS EXCLUSIVE on the view for the whole recompute.",
        fix: `${stripSemicolon(stmt.text).replace(/^REFRESH\s+MATERIALIZED\s+VIEW/i, "REFRESH MATERIALIZED VIEW CONCURRENTLY")};\n-- Needs a unique index on the view.`,
        lock: "ACCESS EXCLUSIVE",
      },
    ];
  },
};

const reindexBlocking: Rule = {
  id: "reindex-blocking",
  severity: "error",
  summary: "REINDEX without CONCURRENTLY blocks writes, and reads that use the index.",
  check(stmt, ctx) {
    if (kind(stmt) !== "ReindexStmt" || hasOption(body<{ params?: unknown }>(stmt).params, "concurrently"))
      return [];
    return [
      {
        severity: ctx.options.pgVersion >= 12 ? "error" : "warning",
        message: "REINDEX without CONCURRENTLY blocks writes to the table while the index rebuilds.",
        why: "It locks the table against writes and blocks queries that use the index.",
        fix:
          ctx.options.pgVersion >= 12
            ? `${stripSemicolon(stmt.text).replace(/^REINDEX\s+(\w+)/i, "REINDEX $1 CONCURRENTLY")};`
            : "Postgres 11 and older have no REINDEX CONCURRENTLY: build a new index CONCURRENTLY, then drop the old one.",
        lock: "SHARE",
      },
    ];
  },
};

const explicitLockTable: Rule = {
  id: "explicit-lock-table",
  severity: "warning",
  summary: "LOCK TABLE in a migration holds a lock for the rest of the transaction.",
  check(stmt) {
    if (kind(stmt) !== "LockStmt") return [];
    return [
      {
        message: "LOCK TABLE holds its lock until the migration's transaction ends.",
        why: "Everything else in the same transaction now runs while the table is locked, so a slow step blocks traffic for longer than you'd expect.",
        fix: "Remove it if possible. If you need it, keep the transaction tiny and set lock_timeout first.",
      },
    ];
  },
};

/**
 * Not a per-statement rule: the analyzer adds one finding per file when a
 * statement that needs an ACCESS EXCLUSIVE lock runs without a lock_timeout.
 */
export const REQUIRE_LOCK_TIMEOUT = {
  id: "require-lock-timeout",
  severity: "warning" as const,
  summary: "Without lock_timeout, a DDL statement waiting for its lock blocks every query behind it.",
};

export const rules: Rule[] = [
  requireConcurrentIndex,
  requireConcurrentIndexDrop,
  concurrentlyInTransaction,
  addColumnRewrite,
  setNotNull,
  changeColumnType,
  addForeignKey,
  addCheck,
  addUniqueOrPrimaryKey,
  renameObject,
  dropColumnOrTable,
  tableRewriteCommand,
  refreshMatviewBlocking,
  reindexBlocking,
  explicitLockTable,
];

export const allRuleIds = [...rules.map((r) => r.id), REQUIRE_LOCK_TIMEOUT.id];
