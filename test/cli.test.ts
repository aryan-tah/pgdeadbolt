import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  vi.stubEnv("GITHUB_ACTIONS", "");
  vi.stubEnv("NO_COLOR", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("cli", () => {
  it("exits 0 for a safe migration", async () => {
    expect(await main(["check", fixture("safe.sql")])).toBe(0);
    expect(out.join("\n")).toContain("No lock problems");
  });

  it("exits 1 when there are errors", async () => {
    expect(await main(["check", fixture("unsafe.sql")])).toBe(1);
    expect(out.join("\n")).toContain("require-concurrent-index");
  });

  it("exits 0 on warnings unless asked to fail on them", async () => {
    expect(await main(["check", fixture("warning.sql")])).toBe(0);
    expect(await main(["check", fixture("warning.sql"), "--fail-on-warning"])).toBe(1);
  });

  it("exits 2 when SQL can't be parsed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgdeadbolt-"));
    writeFileSync(join(dir, "bad.sql"), "CREATE TABLE (oops;");
    expect(await main(["check", dir])).toBe(2);
    expect(err.join("\n")).toContain("could not parse");
  });

  it("exits 2 for a missing path or unknown option", async () => {
    expect(await main(["check", "nope/does-not-exist"])).toBe(2);
    expect(await main(["check", "--bogus"])).toBe(2);
  });

  it("walks directories for .sql files", async () => {
    expect(await main(["check", join(import.meta.dirname, "fixtures")])).toBe(1);
    expect(out.join("\n")).toContain("3 files");
  });

  it("emits GitHub annotations", async () => {
    await main(["check", fixture("unsafe.sql"), "--format", "github"]);
    expect(out[0]).toMatch(
      /^::error file=.*unsafe\.sql,line=1,col=1,title=pgdeadbolt%3A require-concurrent-index::/,
    );
    expect(out[0]).not.toContain("\n");
  });

  it("emits valid JSON and SARIF", async () => {
    await main(["check", fixture("unsafe.sql"), "--format", "json"]);
    expect(JSON.parse(out.join("\n")).summary.errors).toBe(1);
    out = [];
    await main(["check", fixture("unsafe.sql"), "--format", "sarif"]);
    const sarif = JSON.parse(out.join("\n"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0].ruleId).toBe("require-concurrent-index");
  });

  it("lists rules", async () => {
    expect(await main(["rules"])).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(16);
  });

  it("applies --ignore and --pg-version", async () => {
    expect(await main(["check", fixture("unsafe.sql"), "--ignore", "require-concurrent-index"])).toBe(0);
    expect(await main(["check", fixture("safe.sql"), "--pg-version", "abc"])).toBe(2);
  });
});
