import type pg from "pg";

interface Column {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
  character_maximum_length: number | null;
}

/** A value expression for column type `udt`, varied by the series row `g`. */
function valueFor(col: Column): string | undefined {
  const t = col.udt_name;
  const len = col.character_maximum_length;
  switch (t) {
    case "int2":
      return "(g % 32000)::smallint";
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
      return `g::${t === "numeric" ? "numeric" : t}`;
    case "text":
    case "varchar":
    case "bpchar":
      return len ? `left('v' || g || md5(g::text), ${len})` : `'v' || g || '-' || md5(g::text)`;
    case "bool":
      return "(g % 2 = 0)";
    case "timestamptz":
    case "timestamp":
      return "now() - (g || ' seconds')::interval";
    case "date":
      return "current_date - (g % 3650)";
    case "uuid":
      return "md5(g::text)::uuid";
    case "jsonb":
    case "json":
      return `jsonb_build_object('n', g)::${t}`;
    default:
      return col.is_nullable === "YES" ? "NULL" : undefined;
  }
}

/**
 * Fills a table with `rows` synthetic rows, in batches, so rehearsals run
 * against realistic sizes. Columns with defaults, identity or generated values
 * are left to Postgres. Integer foreign keys point at ids 1..n of the parent,
 * so seed parents first.
 */
export async function seedTable(
  client: pg.Client,
  table: string,
  rows: number,
  onProgress?: (done: number) => void,
): Promise<void> {
  const [schema, name] = table.includes(".") ? table.split(".", 2) : ["public", table];
  const { rows: cols } = await client.query<Column>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated, character_maximum_length
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, name],
  );
  if (!cols.length)
    throw new Error(`Table ${table} doesn't exist in the rehearsal database. Create it with --setup first.`);

  const { rows: fks } = await client.query<{ column_name: string; ref_table: string }>(
    `SELECT kcu.column_name, ccu.table_schema || '.' || ccu.table_name AS ref_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
    [schema, name],
  );
  const fkCols = new Map(fks.map((f) => [f.column_name, f.ref_table]));

  const names: string[] = [];
  const values: string[] = [];
  for (const col of cols) {
    if (col.is_identity === "YES" || col.is_generated === "ALWAYS" || col.column_default !== null) continue;
    const ref = fkCols.get(col.column_name);
    let expr: string | undefined;
    if (ref) {
      const { rows: r } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${ref}`);
      const n = Math.max(1, Number(r[0]?.n ?? 1));
      expr = `(1 + (g % ${n}))::${col.udt_name}`;
    } else expr = valueFor(col);
    if (expr === undefined) {
      throw new Error(
        `Can't generate values for ${table}.${col.column_name} (${col.data_type}). Give it a default or make it nullable.`,
      );
    }
    names.push(`"${col.column_name}"`);
    values.push(expr);
  }

  const batch = 100_000;
  for (let start = 1; start <= rows; start += batch) {
    const end = Math.min(rows, start + batch - 1);
    const insert = names.length
      ? `INSERT INTO ${table} (${names.join(", ")}) SELECT ${values.join(", ")} FROM generate_series(${start}, ${end}) AS g`
      : `INSERT INTO ${table} SELECT FROM generate_series(${start}, ${end}) AS g`;
    await client.query(insert);
    onProgress?.(end);
  }
  await client.query(`ANALYZE ${table}`);
}
