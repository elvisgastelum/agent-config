import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { PLAN_DB, PLAN_SCHEMA } from "../src/planning.ts";
import { servePlans, type PlanServer } from "../src/serve.ts";

let root: string;
let server: PlanServer | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "serve-test-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(root, { recursive: true, force: true });
});

/** A store at `dir/plan.sqlite` holding `sql` after the schema. */
function store(dir: string, sql: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PLAN_DB);
  const db = new DatabaseSync(path);
  db.exec(`${PLAN_SCHEMA}; PRAGMA foreign_keys = ON; ${sql}`);
  db.close();
  return path;
}

const planRow = (title: string, createdAt = "2026-01-01 00:00:00"): string =>
  `INSERT INTO plan (title, kind, request, status, created_at) VALUES ('${title}', 'feat', 'req', 'review', '${createdAt}');`;

const FULL = `${planRow("Alpha plan")}
  INSERT INTO epics (id, title, goal, done_when, position) VALUES ('E1', 'Epic one', 'goal', 'dw', 1);
  INSERT INTO tickets (id, epic_id, title, outcome, done_when, size, touches, status) VALUES
    ('T1', 'E1', 'First ticket', 'o', 'c', 'P2', 'a', 'done'),
    ('T2', 'E1', 'Second ticket', 'o', 'c', 'P2', 'b', 'todo'),
    ('T3', NULL, 'Third ticket', 'o', 'c', 'P2', 'c', 'todo');
  INSERT INTO blocks (blocker, blocked) VALUES ('T1', 'T2'), ('T2', 'T3');
  INSERT INTO decisions (topic, question, answer, decided_by) VALUES ('dtopic', 'dquestion', 'danswer', 'user');
  INSERT INTO facts (topic, fact, source) VALUES ('ftopic', 'a fact', 'src');
  INSERT INTO findings (kind, lens, detail, why, status) VALUES ('risk', 'lens', 'finding detail', 'because', 'open');`;

async function start(): Promise<string> {
  server = await servePlans([root], { host: "127.0.0.1" });
  return `http://127.0.0.1:${server.port}${new URL(server.urls.local).pathname}`;
}

const text = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { res, body: await res.text() };
};

describe("plans serve", () => {
  test("the index lists a store's progress and escapes its title", async () => {
    store(join(root, "a"), FULL);
    store(join(root, "b"), planRow("<script>alert(1)</script>"));
    const { res, body } = await text(await start());
    expect(res.status).toBe(200);
    expect(body).toContain("Alpha plan");
    expect(body).toContain("1/3 done");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>");
  });

  test("the plan page shows every part of the store", async () => {
    store(join(root, "a"), FULL);
    const base = await start();
    const index = (await text(base)).body;
    const href = /href="(plan\/[^"]+)"/.exec(index)?.[1];
    expect(href).toBeDefined();
    const { res, body } = await text(new URL(href!, base).href);
    expect(res.status).toBe(200);
    for (const part of [
      "First ticket",
      "Second ticket",
      "Epic one",
      "dquestion",
      "a fact",
      "finding detail",
      "Wave 1",
      'href="#ticket-T1"',
    ]) {
      expect(body).toContain(part);
    }
    expect(body).toContain('href="../"');
  });

  test("a store created after start shows up on the next request", async () => {
    const base = await start();
    expect((await text(base)).body).not.toContain("Late plan");
    store(join(root, "late"), planRow("Late plan"));
    expect((await text(base)).body).toContain("Late plan");
  });

  test("answers 404 without the token, with a wrong one, and for odd paths", async () => {
    store(join(root, "a"), FULL);
    const base = await start();
    const origin = new URL(base).origin;
    const token = new URL(base).pathname.split("/")[1];
    const paths = [
      "/",
      "/wrong-token/",
      `/${token}/plan/unknown`,
      `/${token}/plan/..%2F..%2Fetc%2Fpasswd`,
      `/${token}/../`,
    ];
    for (const path of paths) {
      const res = await fetch(origin + path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toContain(token);
    }
  });

  test("answers 405 with Allow to other methods", async () => {
    const res = await fetch(await start(), { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("sets the security headers", async () => {
    const res = await fetch(await start());
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a file that is not SQLite shows an error card and the other store still renders", async () => {
    store(join(root, "a"), FULL);
    mkdirSync(join(root, "bad"));
    writeFileSync(join(root, "bad", PLAN_DB), "not a database at all, just text".repeat(20));
    const { res, body } = await text(await start());
    expect(res.status).toBe(200);
    expect(body).toContain("Alpha plan");
    expect(body).toContain(relative(process.cwd(), join(root, "bad", PLAN_DB)));
  });

  test("never changes a store", async () => {
    const path = store(join(root, "a"), FULL);
    const before = readFileSync(path);
    const base = await start();
    const href = /href="(plan\/[^"]+)"/.exec((await text(base)).body)![1];
    await text(new URL(href, base).href);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
