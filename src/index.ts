export { type AnalyzeResult, analyze } from "./analyze.js";
export { type Config, loadConfig } from "./config.js";
export { type Format, format } from "./format.js";
export { ParseError, parseSql } from "./parse.js";
export { type RehearseOptions, rehearse, type StatementResult } from "./rehearse/index.js";
export { allRuleIds, rules } from "./rules/index.js";
export type { Finding, LockMode, Options, Rule, Severity } from "./types.js";

declare const __VERSION__: string | undefined;

/** The package version, injected from package.json at build time. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";
