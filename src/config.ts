import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "./types.js";

export interface Config extends Partial<Options> {
  /** Fail (exit 1) on warnings too, not just errors. */
  failOnWarning?: boolean;
}

/** Reads `pgdeadbolt.config.json`, or the `"pgdeadbolt"` key in package.json, from a directory. */
export function loadConfig(dir: string): Config {
  const file = join(dir, "pgdeadbolt.config.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Config;
  const pkg = join(dir, "package.json");
  if (existsSync(pkg)) {
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { pgdeadbolt?: Config };
    if (parsed.pgdeadbolt) return parsed.pgdeadbolt;
  }
  return {};
}
