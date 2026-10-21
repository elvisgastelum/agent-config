import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { PLAN_DB } from "../src/planning.ts";
import { findStores, MissingPathError, upgradeStores } from "../src/plans.ts";
import { put } from "./helpers.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plans-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A store as an older version left it: a stale waves view over a ticket table. */
function staleStore(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PLAN_DB);
  const db = new DatabaseSync(path);
  db.exec("CREATE VIEW waves AS SELECT 'stale' AS ticket_id, 0 AS wave");
  db.close();
  return path;
}

function wavesOf(path: string): unknown[] {
  const db = new DatabaseSync(path);
  try {
    db.prepare(
      "INSERT INTO tickets (id, title, outcome, done_when, size, touches, status) VALUES ('T1', 'T1', 'o', 'c', 'P3', 'a', 'todo')",
    ).run();
    return db.prepare("SELECT ticket_id, wave FROM waves").all();
  } finally {
    db.close();
  }
}

describe("plans upgrade", () => {
  test("replaces a stale waves view with the current one", async () => {
    const path = staleStore(join(root, "a"));
    const result = await upgradeStores([path]);
    expect(result).toEqual({ upgraded: [path], failed: [] });
    expect(wavesOf(path)).toEqual([{ ticket_id: "T1", wave: 1 }]);
  });

  test("finds nested stores and skips node_modules and .git", () => {
    const one = staleStore(join(root, ".plans", "10-2026", "one"));
    const two = staleStore(join(root, ".plans", "10-2026", "two"));
    staleStore(join(root, "node_modules", "pkg"));
    staleStore(join(root, ".git", "x"));
    expect(findStores([root]).sort()).toEqual([one, two].sort());
    expect(findStores([one])).toEqual([one]);
  });

  test("reports a file that is not SQLite and still upgrades the others", async () => {
    const bad = join(root, "bad", PLAN_DB);
    put(bad, "this is not a database, just text padded to be long enough to look like one\n");
    const good = staleStore(join(root, "good"));
    const result = await upgradeStores([bad, good]);
    expect(result.upgraded).toEqual([good]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toBe(bad);
    expect(result.failed[0]?.error).not.toBe("");
    expect(wavesOf(good)).toEqual([{ ticket_id: "T1", wave: 1 }]);
  });

  test("dry run writes nothing", async () => {
    const path = staleStore(join(root, "a"));
    const result = await upgradeStores([path], true);
    expect(result).toEqual({ upgraded: [path], failed: [] });
    const db = new DatabaseSync(path);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    db.close();
    expect(tables).toEqual([]);
  });

  test("a missing path is an error and creates no file", async () => {
    const missing = join(root, "nope", PLAN_DB);
    expect(() => findStores([missing])).toThrow(MissingPathError);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(root, "nope"))).toBe(false);
  });
});
