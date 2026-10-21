import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { serveMcp } from "../src/mcp.ts";
import { planTools } from "../src/plans-mcp.ts";
import { PLAN_DB, PLAN_SCHEMA, PLAN_SCHEMA_VERSION } from "../src/planning.ts";

const V0_SCHEMA = new URL("./fixtures/plan-schema-v0.sql", import.meta.url);

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

  test("tools/list lists the read tools as read-only and the write tools as not", async () => {
    const [reply] = await exchange([rpc(1, "tools/list")]);
    const tools = reply!.result!.tools as { name: string; annotations: unknown }[];
    expect(tools).toHaveLength(14);
    const reads = ["plan_list", "plan_get", "plan_query"];
    expect(tools.map((t) => t.name).slice(0, 3)).toEqual(reads);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: reads.includes(tool.name) });
    }
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

const ok = async (name: string, args: unknown): Promise<Record<string, any>> => {
  const reply = await call(name, args);
  expect(reply.result!.isError, JSON.stringify(reply.result)).toBe(false);
  return reply.result!.structuredContent;
};
const fails = async (name: string, args: unknown): Promise<string> => {
  const reply = await call(name, args);
  expect(reply.result!.isError).toBe(true);
  return reply.result!.content[0].text;
};
const detail = async (): Promise<Record<string, any>> => ok("plan_get", { store });

describe("write tools", () => {
  test("plan_create makes the store at the current schema; duplicates and bad titles fail", async () => {
    const now = new Date();
    const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
    const made = await ok("plan_create", { title: "new-plan", kind: "feat", request: "do it" });
    const expected = join(root, ".plans", month, "new-plan", PLAN_DB);
    expect(made).toEqual({ store: expected });
    const got = await ok("plan_get", { store: expected });
    expect(got.version).toBe(PLAN_SCHEMA_VERSION);
    expect(got.plan).toMatchObject({ title: "new-plan", kind: "feat", request: "do it" });
    expect(await fails("plan_create", { title: "new-plan", kind: "feat", request: "x" })).toContain(
      "exists",
    );
    const bad = await fails("plan_create", { title: "Not Kebab", kind: "feat", request: "x" });
    expect(bad).toContain("title");
    expect(existsSync(join(root, ".plans", month, "Not Kebab"))).toBe(false);
  });

  test("plan_update, fact_add, decision_add, finding_add and finding_update round-trip", async () => {
    await fails("plan_update", { store });
    const plan = await ok("plan_update", { store, outcome: "done well", status: "written" });
    expect(plan).toMatchObject({ outcome: "done well", status: "written" });
    expect(await ok("fact_add", { store, topic: "t", fact: "f", source: "s" })).toEqual({ id: 1 });
    expect(
      await ok("decision_add", {
        store,
        topic: "t",
        question: "q",
        answer: "a",
        decided_by: "user",
      }),
    ).toEqual({ id: 1 });
    expect(
      await ok("finding_add", { store, kind: "gap", lens: "l", detail: "d", why: "w" }),
    ).toEqual({ id: 1 });
    const row = await ok("finding_update", {
      store,
      id: 1,
      status: "resolved",
      resolution: "fixed",
      ticket_id: "T1",
    });
    expect(row).toMatchObject({ id: 1, status: "resolved", resolution: "fixed", ticket_id: "T1" });
    const got = await detail();
    expect(got.plan).toMatchObject({ outcome: "done well", status: "written" });
    expect(got.facts).toEqual([{ id: 1, topic: "t", fact: "f", source: "s" }]);
    expect(got.decisions[0]).toMatchObject({ decidedBy: "user", why: null });
    expect(got.findings[0]).toMatchObject({ status: "resolved", ticketId: "T1" });
    expect(await fails("finding_update", { store, id: 9, status: "open" })).toContain(
      "finding 9 not found",
    );
    await fails("finding_update", { store, id: 1 });
  });

  test("epic_save and ticket_save insert then partially update", async () => {
    const epic = { store, id: "E1", title: "Epic", goal: "g", done_when: "d", position: 1 };
    expect(await ok("epic_save", epic)).toMatchObject({ id: "E1", title: "Epic" });
    expect(await ok("epic_save", { store, id: "E1", goal: "new goal" })).toMatchObject({
      title: "Epic",
      goal: "new goal",
    });
    const missing = await fails("epic_save", { store, id: "E2", title: "x" });
    for (const field of ["goal", "done_when", "position"]) expect(missing).toContain(field);
    const ticket = {
      store,
      id: "T3",
      epic_id: "E1",
      title: "Three",
      outcome: "o",
      done_when: "c",
      size: "P2",
      touches: "x",
    };
    expect(await ok("ticket_save", ticket)).toMatchObject({ id: "T3", status: "todo" });
    expect(await ok("ticket_save", { store, id: "T3", status: "in_progress" })).toMatchObject({
      title: "Three",
      status: "in_progress",
    });
    expect((await detail()).progress).toEqual({ todo: 1, inProgress: 1, done: 1, total: 3 });
    const none = await fails("ticket_save", { store, id: "T9", title: "x" });
    for (const field of ["outcome", "done_when", "size", "touches"]) expect(none).toContain(field);
    await fails("ticket_save", { ...ticket, id: "T4", epic_id: "NOPE" });
    expect((await detail()).tickets.map((t: { id: string }) => t.id)).toEqual(["T1", "T2", "T3"]);
  });

  test("block_add and block_remove", async () => {
    await ok("block_add", { store, blocker: "T1", blocked: "T2" });
    expect((await detail()).tickets[1].blockedBy).toEqual(["T1"]);
    await ok("block_remove", { store, blocker: "T1", blocked: "T2" });
    expect((await detail()).tickets[1].blockedBy).toEqual([]);
    await fails("block_remove", { store, blocker: "T1", blocked: "T2" });
  });

  test("draft_replace replaces an earlier draft atomically and returns waves", async () => {
    const t = (id: string) => ({
      id,
      title: id,
      outcome: "o",
      done_when: "c",
      size: "P2",
      touches: "x",
    });
    const epics = [{ id: "E1", title: "e", goal: "g", done_when: "d", position: 1 }];
    const result = await ok("draft_replace", {
      store,
      epics,
      tickets: [{ ...t("A"), epic_id: "E1" }, t("B")],
      blocks: [{ blocker: "A", blocked: "B" }],
    });
    expect(result).toMatchObject({ epics: 1, tickets: 2, blocks: 1 });
    expect(result.waves).toEqual([
      { epic_id: "E1", ticket_id: "A", wave: 1 },
      { epic_id: null, ticket_id: "B", wave: 2 },
    ]);
    await fails("draft_replace", {
      store,
      epics: [],
      tickets: [t("C")],
      blocks: [{ blocker: "C", blocked: "ZZ" }],
    });
    expect((await detail()).tickets.map((x: { id: string }) => x.id)).toEqual(["A", "B"]);
  });

  test("an old or newer store rejects writes", async () => {
    const old = join(root, ".plans", "10-2026", "old", PLAN_DB);
    mkdirSync(join(old, ".."), { recursive: true });
    const db = new DatabaseSync(old);
    db.exec(readFileSync(V0_SCHEMA, "utf8"));
    db.close();
    expect(await fails("fact_add", { store: old, topic: "t", fact: "f", source: "s" })).toContain(
      "plans upgrade",
    );
    const newer = new DatabaseSync(store);
    newer.exec(`PRAGMA user_version = ${PLAN_SCHEMA_VERSION + 1}`);
    newer.close();
    expect(await fails("fact_add", { store, topic: "t", fact: "f", source: "s" })).toContain(
      "newer",
    );
  });
});
