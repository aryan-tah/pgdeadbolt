import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allRuleIds } from "../src/rules/index.js";

const page = (id: string) =>
  join(import.meta.dirname, "..", "docs", "src", "content", "docs", "rules", `${id}.md`);

describe("docs", () => {
  // SARIF output and GitHub annotations link to /rules/<id>/, so every rule needs a page.
  it.each(allRuleIds)("rule %s has a docs page", (id) => {
    expect(existsSync(page(id))).toBe(true);
  });
});
