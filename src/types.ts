/** A Postgres table lock mode, weakest to strongest. */
export type LockMode =
  | "ACCESS SHARE"
  | "ROW SHARE"
  | "ROW EXCLUSIVE"
  | "SHARE UPDATE EXCLUSIVE"
  | "SHARE"
  | "SHARE ROW EXCLUSIVE"
  | "EXCLUSIVE"
  | "ACCESS EXCLUSIVE";

export type Severity = "error" | "warning";

/** One statement from a migration file, with its position in the source. */
export interface Statement {
  /** The parse tree node, e.g. `{ AlterTableStmt: {...} }`. */
  node: Record<string, unknown>;
  /** The statement's SQL text. */
  text: string;
  /** 1-based line and column where the statement starts. */
  line: number;
  column: number;
  /** Index of the statement in the file. */
  index: number;
}

export interface Finding {
  rule: string;
  severity: Severity;
  /** One line: what's wrong. */
  message: string;
  /** Why it hurts in production. */
  why: string;
  /** How to do the same change safely, often as SQL. */
  fix: string;
  /** The lock the statement takes, when that's the problem. */
  lock?: LockMode;
  file: string;
  line: number;
  column: number;
  statement: string;
}

export interface Options {
  /** Major Postgres version the migration will run on. Default 16. */
  pgVersion: number;
  /**
   * Whether the migration tool wraps each file in a transaction
   * (Rails, Django, Knex, Flyway and others do by default).
   */
  inTransaction: boolean;
  /** Rule IDs to turn off. */
  ignore: string[];
}

export const DEFAULT_OPTIONS: Options = { pgVersion: 16, inTransaction: false, ignore: [] };

/** What a rule can see about the whole file, not just one statement. */
export interface Context {
  options: Options;
  /** Tables created earlier in this file: they're empty, so most locks on them don't matter. */
  createdTables: Set<string>;
  /** Whether a lock_timeout has been set before this statement. */
  lockTimeoutSet: boolean;
  /** Whether this statement runs inside a transaction block. */
  inTransaction: boolean;
}

export interface RuleFinding {
  message: string;
  why: string;
  fix: string;
  lock?: LockMode;
  severity?: Severity;
}

export interface Rule {
  id: string;
  severity: Severity;
  /** One-sentence summary, shown by `pgdeadbolt rules`. */
  summary: string;
  check(stmt: Statement, ctx: Context): RuleFinding[];
}
