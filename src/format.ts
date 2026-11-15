import type { AnalyzeResult } from "./analyze.js";
import { REQUIRE_LOCK_TIMEOUT, rules } from "./rules/index.js";
import type { Finding } from "./types.js";

export type Format = "pretty" | "json" | "github" | "sarif";

const useColor = () => !process.env.NO_COLOR && process.stdout.isTTY === true;
const paint = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint("31");
const yellow = paint("33");
const green = paint("32");
const dim = paint("2");
const bold = paint("1");
const cyan = paint("36");

function summary(results: AnalyzeResult[]) {
  const all = results.flatMap((r) => r.findings);
  return {
    files: results.length,
    statements: results.reduce((n, r) => n + r.statements, 0),
    errors: all.filter((f) => f.severity === "error").length,
    warnings: all.filter((f) => f.severity === "warning").length,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function pretty(results: AnalyzeResult[]): string {
  const out: string[] = [];
  for (const r of results) {
    if (!r.findings.length) continue;
    out.push(bold(r.file));
    for (const f of r.findings) {
      const sev = f.severity === "error" ? red("error") : yellow("warning");
      out.push(`  ${dim(`${f.line}:${f.column}`)}  ${sev}  ${f.message}  ${dim(f.rule)}`);
      if (f.lock) out.push(`         ${dim(`lock: ${f.lock}`)}`);
      out.push(`         ${dim(f.why)}`);
      out.push(`         ${cyan("fix:")}`);
      for (const line of f.fix.split("\n")) out.push(`           ${line}`);
      out.push("");
    }
  }
  const s = summary(results);
  if (s.errors + s.warnings === 0) {
    out.push(
      green(`✓ No lock problems in ${plural(s.files, "file")} (${plural(s.statements, "statement")}).`),
    );
  } else {
    const parts = [
      s.errors && red(plural(s.errors, "error")),
      s.warnings && yellow(plural(s.warnings, "warning")),
    ].filter(Boolean);
    out.push(`${s.errors ? red("✖") : yellow("!")} ${parts.join(", ")} in ${plural(s.files, "file")}.`);
  }
  return out.join("\n");
}

const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s: string) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

function github(results: AnalyzeResult[]): string {
  return results
    .flatMap((r) => r.findings)
    .map(
      (f) =>
        `::${f.severity} file=${escapeProp(f.file)},line=${f.line},col=${f.column},title=${escapeProp(`pgdeadbolt: ${f.rule}`)}::${escapeData(`${f.message}\n\n${f.why}\n\nFix:\n${f.fix}`)}`,
    )
    .join("\n");
}

function json(results: AnalyzeResult[]): string {
  return JSON.stringify({ summary: summary(results), results }, null, 2);
}

function sarif(results: AnalyzeResult[], version: string): string {
  const all = [
    ...rules.map((r) => ({ id: r.id, summary: r.summary, severity: r.severity })),
    REQUIRE_LOCK_TIMEOUT,
  ];
  const level = (s: string) => (s === "error" ? "error" : "warning");
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "pgdeadbolt",
              version,
              informationUri: "https://pgdeadbolt.aryantah.com",
              rules: all.map((r) => ({
                id: r.id,
                shortDescription: { text: r.summary },
                helpUri: `https://pgdeadbolt.aryantah.com/rules/${r.id}/`,
                defaultConfiguration: { level: level(r.severity) },
              })),
            },
          },
          results: results.flatMap((r) =>
            r.findings.map((f: Finding) => ({
              ruleId: f.rule,
              level: level(f.severity),
              message: { text: `${f.message} Fix: ${f.fix}` },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.file },
                    region: { startLine: f.line, startColumn: f.column },
                  },
                },
              ],
            })),
          ),
        },
      ],
    },
    null,
    2,
  );
}

export function format(results: AnalyzeResult[], kind: Format, version: string): string {
  switch (kind) {
    case "json":
      return json(results);
    case "github":
      return github(results);
    case "sarif":
      return sarif(results, version);
    default:
      return pretty(results);
  }
}
