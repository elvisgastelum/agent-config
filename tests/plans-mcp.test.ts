import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { serveMcp } from "../src/mcp.ts";
import { planTools } from "../src/plans-mcp.ts";
import { PLAN_DB, PLAN_SCHEMA, PLAN_SCHEMA_VERSION } from "../src/planning.ts";

let root: string;
let store: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plans-mcp-test-"));
  const dir = join(root, ".plans", "10-2026", "demo");
  mkdirSync(dir, { recursive: true });
  store = join(dir, PLAN_DB);
  const db = new DatabaseSync(store);
  db.exec(PLAN_SCHEMA);
  db.exec(
    `INSERT INTO plan (title, kind, request, outcome, status, tracker, created_at) VALUES ('Demo', 'feat', 'req', NULL, 'review', 'store', '2026-01-01 00:00:00');
     INSERT INTO tickets (id, title, outcome, done_when, size, touches, status) VALUES
       ('T1', 'One', 'o1', 'c1', 'P2', 'a', 'todo'),
       ('T2', 'Two', 'o2', 'c2', 'P3', 'b', 'done');`,
  );
  db.close();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Reply = {
  id: number | null;
  result?: Record<string, any>;
  error?: { code: number; message: string };
};

/** Sends each line to a fresh server and returns the parsed replies once input has ended. */
async function exchange(lines: string[], cwd = root): Promise<Reply[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += chunk));
  const done = serveMcp(planTools(cwd), { name: "t", version: "1", input, output });
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await done;
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Reply);
}

const rpc = (id: number | null, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

async function call(name: string, args: unknown, cwd = root): Promise<Reply> {
  const [reply] = await exchange([rpc(1, "tools/call", { name, arguments: args })], cwd);
  return reply!;
}

describe("protocol", () => {
  test("initialize echoes a supported version and falls back to the latest", async () => {
    const [ok, unknown] = await exchange([
      rpc(1, "initialize", { protocolVersion: "2025-03-26" }),
      rpc(2, "initialize", { protocolVersion: "1999-01-01" }),
    ]);
    expect(ok!.result!.protocolVersion).toBe("2025-03-26");
    expect(unknown!.result!.protocolVersion).toBe("2025-11-25");
    expect(ok!.result!.serverInfo).toEqual({ name: "t", version: "1" });
    expect(ok!.result!.capabilities.tools).toEqual({ listChanged: false });
  });

  test("a notification gets no reply and ping replies {}", async () => {
    const replies = await exchange([
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
      rpc(7, "ping"),
    ]);
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 7, result: {} }]);
  });

  test("tools/list lists the three read-only tools", async () => {
    const [reply] = await exchange([rpc(1, "tools/list")]);
    const tools = reply!.result!.tools as { name: string; annotations: unknown }[];
    expect(tools.map((t) => t.name)).toEqual(["plan_list", "plan_get", "plan_query"]);
    for (const tool of tools) expect(tool.annotations).toEqual({ readOnlyHint: true });
  });

  test("unknown tool, unknown method and bad JSON are JSON-RPC errors", async () => {
    const replies = await exchange([
      rpc(1, "tools/call", { name: "nope" }),
      rpc(2, "nope/nope"),
      "{not json",
      "[]",
    ]);
    expect(replies[0]!.error!.code).toBe(-32602);
    expect(replies[1]!.error!.code).toBe(-32601);
    expect(replies[2]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(replies[3]!.error!.code).toBe(-32600);
  });
});

describe("tools", () => {
  test("plan_list returns stores with title and progress; no .plans means none", async () => {
    const reply = await call("plan_list", {});
    expect(reply.result!.isError).toBe(false);
    expect(reply.result!.structuredContent.stores).toEqual([
      {
        store,
        title: "Demo",
        kind: "feat",
        status: "review",
        version: PLAN_SCHEMA_VERSION,
        progress: { todo: 1, inProgress: 0, done: 1, total: 2 },
      },
    ]);
    const empty = mkdtempSync(join(tmpdir(), "plans-mcp-empty-"));
    try {
      const none = await call("plan_list", { root: empty });
      expect(none.result!.structuredContent).toEqual({ stores: [] });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("plan_get returns only the requested sections", async () => {
    const some = (await call("plan_get", { store, sections: ["tickets"] })).result!
      .structuredContent;
    expect(Object.keys(some).sort()).toEqual(["store", "tickets", "version"]);
    expect(some.tickets).toHaveLength(2);
    const all = (await call("plan_get", { store })).result!.structuredContent;
    expect(Object.keys(all).sort()).toEqual(
      [
        "decisions",
        "epics",
        "facts",
        "findings",
        "plan",
        "progress",
        "store",
        "tickets",
        "version",
      ].sort(),
    );
  });

  test("plan_query runs a select with params and cannot write", async () => {
    const ok = await call("plan_query", {
      store,
      sql: "SELECT id FROM tickets WHERE status = ?",
      params: ["done"],
    });
    expect(ok.result!.structuredContent).toEqual({ rows: [{ id: "T2" }], truncated: false });
    const bad = await call("plan_query", { store, sql: "DELETE FROM tickets" });
    expect(bad.result!.isError).toBe(true);
    const count = await call("plan_query", { store, sql: "SELECT count(*) AS n FROM tickets" });
    expect(count.result!.structuredContent.rows).toEqual([{ n: 2 }]);
  });

  test("a store outside .plans/<month>/<title>/plan.sqlite or a missing one is an error", async () => {
    const other = join(root, "plan.sqlite");
    new DatabaseSync(other).close();
    const outside = await call("plan_get", { store: other });
    expect(outside.result!.isError).toBe(true);
    expect(outside.result!.content[0].text).toContain(".plans");
    const missing = await call("plan_get", {
      store: join(root, ".plans", "10-2026", "gone", PLAN_DB),
    });
    expect(missing.result!.isError).toBe(true);
  });

  test("invalid arguments name the field", async () => {
    const missing = await call("plan_get", {});
    expect(missing.result!.isError).toBe(true);
    expect(missing.result!.content[0].text).toContain("store");
    const extra = await call("plan_get", { store, bogus: 1 });
    expect(extra.result!.isError).toBe(true);
    expect(extra.result!.content[0].text).toContain("bogus");
  });
});
