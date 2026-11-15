import { body, kind, parseSql } from "./parse.js";
import { REQUIRE_LOCK_TIMEOUT, rules, tableKey, tableName } from "./rules/index.js";
import { type Context, DEFAULT_OPTIONS, type Finding, type Options, type Statement } from "./types.js";

export interface AnalyzeResult {
  file: string;
  findings: Finding[];
  statements: number;
}

const IGNORE = /--\s*pgdeadbolt-ignore(-file)?(?::|\s)\s*([\w\s,-]+)/gi;

/** Rule IDs ignored by comments: `-- pgdeadbolt-ignore rule-a, rule-b` above a statement, or `-ignore-file` anywhere. */
function ignoreDirectives(sql: string): { file: Set<string>; byLine: Map<number, Set<string>> } {
  const file = new Set<string>();
  const byLine = new Map<number, Set<string>>();
  sql.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(IGNORE)) {
      const ids = (m[2] ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const target = m[1] ? file : (byLine.get(i + 1) ?? new Set<string>());
      for (const id of ids) target.add(id);
      if (!m[1]) byLine.set(i + 1, target);
    }
  });
  return { file, byLine };
}

/** Ignores that apply to a statement: on its own lines, or in the comment lines directly above it. */
function ignoredFor(stmt: Statement, sql: string, byLine: Map<number, Set<string>>): Set<string> {
  const lines = sql.split("\n");
  const out = new Set<string>();
  const add = (n: number) => {
    for (const id of byLine.get(n) ?? []) out.add(id);
  };
  const span = stmt.text.split("\n").length;
  for (let n = stmt.line; n < stmt.line + span; n++) add(n);
  for (let n = stmt.line - 1; n >= 1; n--) {
    const t = (lines[n - 1] ?? "").trim();
    if (t === "" || t.startsWith("--")) add(n);
    else break;
  }
  return out;
}

/** Whether a statement needs an ACCESS EXCLUSIVE (or similar write-blocking) lock on an existing table. */
function takesStrongLock(stmt: Statement, ctx: Context): boolean {
  const k = kind(stmt);
  const b = body<{
    relation?: { schemaname?: string; relname?: string };
    cmds?: unknown;
    removeType?: string;
    concurrent?: boolean;
  }>(stmt);
  if (k === "AlterTableStmt") {
    if (ctx.createdTables.has(tableKey(tableName(b.relation)))) return false;
    const subtypes = Array.isArray(b.cmds)
      ? b.cmds.map((c) => (c as { AlterTableCmd?: { subtype?: string } }).AlterTableCmd?.subtype)
      : [];
    return subtypes.some((s) => s !== "AT_ValidateConstraint" && s !== "AT_SetStatistics");
  }
  if (k === "RenameStmt") return !ctx.createdTables.has(tableKey(tableName(b.relation)));
  if (k === "DropStmt")
    return (b.removeType === "OBJECT_TABLE" || b.removeType === "OBJECT_INDEX") && !b.concurrent;
  return k === "LockStmt";
}

function lockTimeoutValue(stmt: Statement): number | undefined {
  if (kind(stmt) !== "VariableSetStmt") return undefined;
  const s = body<{ name?: string; kind?: string; args?: unknown }>(stmt);
  if (s.name !== "lock_timeout") return undefined;
  if (s.kind === "VAR_RESET" || s.kind === "VAR_SET_DEFAULT") return 0;
  const arg = Array.isArray(s.args)
    ? (s.args[0] as { A_Const?: { ival?: { ival?: number }; sval?: { sval?: string } } })?.A_Const
    : undefined;
  if (arg?.sval?.sval !== undefined) return /^0\s*(ms|s)?$/i.test(arg.sval.sval.trim()) ? 0 : 1;
  return arg?.ival?.ival ?? 0;
}

/** Analyze one migration's SQL. */
export async function analyze(
  sql: string,
  opts: Partial<Options> & { file?: string } = {},
): Promise<AnalyzeResult> {
  const options: Options = { ...DEFAULT_OPTIONS, ...opts, ignore: opts.ignore ?? [] };
  const file = opts.file ?? "<sql>";
  const statements = await parseSql(sql);
  const { file: fileIgnores, byLine } = ignoreDirectives(sql);
  const globalIgnores = new Set([...options.ignore, ...fileIgnores]);

  const ctx: Context = {
    options,
    createdTables: new Set(),
    lockTimeoutSet: false,
    inTransaction: options.inTransaction,
  };
  const findings: Finding[] = [];
  let lockTimeoutReported = false;

  for (const stmt of statements) {
    const k = kind(stmt);
    if (k === "TransactionStmt") {
      const t = body<{ kind?: string }>(stmt).kind ?? "";
      if (t === "TRANS_STMT_BEGIN" || t === "TRANS_STMT_START") ctx.inTransaction = true;
      if (t === "TRANS_STMT_COMMIT" || t === "TRANS_STMT_ROLLBACK") ctx.inTransaction = false;
      continue;
    }
    const timeout = lockTimeoutValue(stmt);
    if (timeout !== undefined) {
      ctx.lockTimeoutSet = timeout > 0;
      continue;
    }

    const ignored = ignoredFor(stmt, sql, byLine);
    const skip = (id: string) => globalIgnores.has(id) || ignored.has(id) || ignored.has("all");

    for (const rule of rules) {
      if (skip(rule.id)) continue;
      for (const f of rule.check(stmt, ctx)) {
        findings.push({
          rule: rule.id,
          severity: f.severity ?? rule.severity,
          message: f.message,
          why: f.why,
          fix: f.fix,
          ...(f.lock ? { lock: f.lock } : {}),
          file,
          line: stmt.line,
          column: stmt.column,
          statement: stmt.text,
        });
      }
    }

    if (
      !lockTimeoutReported &&
      !ctx.lockTimeoutSet &&
      !skip(REQUIRE_LOCK_TIMEOUT.id) &&
      takesStrongLock(stmt, ctx)
    ) {
      lockTimeoutReported = true;
      findings.push({
        rule: REQUIRE_LOCK_TIMEOUT.id,
        severity: REQUIRE_LOCK_TIMEOUT.severity,
        message: "This migration takes a strong lock without setting lock_timeout first.",
        why: "Even an instant ALTER TABLE has to wait for its lock. While it waits behind a long-running query, every new query on the table queues behind it, and the table looks down.",
        fix: "SET lock_timeout = '2s';  -- at the top of the migration; retry the migration if it times out",
        lock: "ACCESS EXCLUSIVE",
        file,
        line: stmt.line,
        column: stmt.column,
        statement: stmt.text,
      });
    }

    if (k === "CreateStmt" || k === "CreateTableAsStmt") {
      const rel =
        k === "CreateStmt"
          ? body<{ relation?: { schemaname?: string; relname?: string } }>(stmt).relation
          : (body<{ into?: { rel?: { schemaname?: string; relname?: string } } }>(stmt).into?.rel ??
            undefined);
      ctx.createdTables.add(tableKey(tableName(rel)));
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return { file, findings, statements: statements.length };
}
