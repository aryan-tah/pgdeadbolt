import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);

export interface DisposablePostgres {
  url: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Starts a throwaway Postgres in Docker and waits until it accepts connections. */
export async function startPostgres(version: number): Promise<DisposablePostgres> {
  const port = await freePort();
  const password = "pgdeadbolt";
  const name = `pgdeadbolt-rehearsal-${process.pid}-${Date.now()}`;
  try {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      `127.0.0.1:${port}:5432`,
      `postgres:${version}-alpine`,
    ]);
  } catch (err) {
    throw new Error(
      `Couldn't start Postgres ${version} in Docker. Is Docker running?\n${(err as Error).message}`,
    );
  }
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const stop = async () => {
    await run("docker", ["rm", "-f", name]).catch(() => undefined);
  };
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return { url, stop };
    } catch {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) {
        await stop();
        throw new Error("Postgres in Docker didn't become ready within 60 seconds.");
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
