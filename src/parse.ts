import { parse } from "libpg-query";
import type { Statement } from "./types.js";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

interface RawStmt {
  stmt: Record<string, unknown>;
  stmt_location?: number;
  stmt_len?: number;
}

/**
 * Parses SQL with Postgres's own parser (libpg_query). Locations from the
 * parser are byte offsets, so text and line numbers are taken from the UTF-8
 * bytes, not the JS string.
 */
export async function parseSql(sql: string): Promise<Statement[]> {
  const bytes = Buffer.from(sql, "utf8");
  let result: { stmts?: RawStmt[] };
  try {
    result = (await parse(sql)) as { stmts?: RawStmt[] };
  } catch (err) {
    const e = err as { message?: string; cursorPosition?: number; sqlDetails?: { cursorPosition?: number } };
    const pos = e.sqlDetails?.cursorPosition ?? e.cursorPosition ?? 0;
    const { line, column } = position(bytes, Math.max(0, pos - 1));
    throw new ParseError(e.message ?? String(err), line, column);
  }
  return (result.stmts ?? []).map((raw, index) => {
    let start = raw.stmt_location ?? 0;
    const end = raw.stmt_len ? start + raw.stmt_len : bytes.length;
    // The parser's location includes leading whitespace and comments; skip to the first real token.
    const slice = bytes.subarray(start, end).toString("utf8");
    const lead = leadingTrivia(slice);
    start += Buffer.byteLength(slice.slice(0, lead), "utf8");
    const text = slice.slice(lead).trim();
    const { line, column } = position(bytes, start);
    return { node: raw.stmt, text, line, column, index };
  });
}

/** Length of whitespace and SQL comments at the start of a string. */
function leadingTrivia(s: string): number {
  let i = 0;
  for (;;) {
    while (i < s.length && /\s/.test(s[i] ?? "")) i++;
    if (s.startsWith("--", i)) {
      const nl = s.indexOf("\n", i);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s.startsWith("/*", i)) {
      const close = s.indexOf("*/", i + 2);
      i = close === -1 ? s.length : close + 2;
    } else return i;
  }
}

function position(bytes: Buffer, offset: number): { line: number; column: number } {
  const before = bytes.subarray(0, offset).toString("utf8");
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

/** The node type of a statement, e.g. "AlterTableStmt". */
export function kind(stmt: Statement): string {
  return Object.keys(stmt.node)[0] ?? "";
}

/** The body of a statement node, typed loosely. */
export function body<T = Record<string, unknown>>(stmt: Statement): T {
  return stmt.node[kind(stmt)] as T;
}
