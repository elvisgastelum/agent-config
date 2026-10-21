import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { PLAN_DB, PLAN_MIGRATIONS, PLAN_SCHEMA, PLAN_SCHEMA_VERSION } from "../src/planning.ts";
import { findStores, MissingPathError, upgradeStores } from "../src/plans.ts";
import { put } from "./helpers.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plans-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const V0_SCHEMA = readFileSync(new URL("./fixtures/plan-schema-v0.sql", import.meta.url), "utf8");

/** A store created from `schema`, at the path `dir/plan.sqlite`. */
function storeFrom(dir: string, schema: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PLAN_DB);
  const db = new DatabaseSync(path);
  db.exec(schema);
  db.close();
  return path;
}

/** A store as release 0.11.0 left it: no schema version and a waves view DuckDB cannot read. */
const staleStore = (dir: string): string => storeFrom(dir, V0_SCHEMA);

function versionOf(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
  } finally {
    db.close();
  }
}

function shapeOf(path: string): unknown[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
      .all();
  } finally {
    db.close();
  }
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
  test("a new store is stamped with the current version", () => {
    const fresh = storeFrom(join(root, "fresh"), PLAN_SCHEMA);
    expect(versionOf(fresh)).toBe(PLAN_SCHEMA_VERSION);
    expect(PLAN_MIGRATIONS).toHaveLength(PLAN_SCHEMA_VERSION);
  });

  test("upgrades a version 0 store to the shape of a new store", async () => {
    const fresh = storeFrom(join(root, "fresh"), PLAN_SCHEMA);
    const path = staleStore(join(root, "a"));
    expect(versionOf(path)).toBe(0);
    const result = await upgradeStores([path]);
    expect(result).toEqual([{ path, status: "upgraded", from: 0, to: PLAN_SCHEMA_VERSION }]);
    expect(shapeOf(path)).toEqual(shapeOf(fresh));
    expect(versionOf(path)).toBe(versionOf(fresh));
    expect(wavesOf(path)).toEqual([{ ticket_id: "T1", wave: 1 }]);
  });

  test("a second upgrade is current and changes nothing", async () => {
    const path = staleStore(join(root, "a"));
    await upgradeStores([path]);
    const shape = shapeOf(path);
    const result = await upgradeStores([path]);
    expect(result).toEqual([
      { path, status: "current", from: PLAN_SCHEMA_VERSION, to: PLAN_SCHEMA_VERSION },
    ]);
    expect(shapeOf(path)).toEqual(shape);
    expect(versionOf(path)).toBe(PLAN_SCHEMA_VERSION);
  });

  test("refuses a store newer than this agent-config and leaves it untouched", async () => {
    const path = storeFrom(join(root, "a"), PLAN_SCHEMA);
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA user_version = ${PLAN_SCHEMA_VERSION + 1}`);
    db.close();
    const shape = shapeOf(path);
    const result = await upgradeStores([path]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("failed");
    expect(result[0]?.error).toContain("agent-config update");
    expect(shapeOf(path)).toEqual(shape);
    expect(versionOf(path)).toBe(PLAN_SCHEMA_VERSION + 1);
  });

  test("a dry run reports pending and writes nothing", async () => {
    const path = staleStore(join(root, "a"));
    const shape = shapeOf(path);
    const result = await upgradeStores([path], true);
    expect(result).toEqual([{ path, status: "pending", from: 0, to: PLAN_SCHEMA_VERSION }]);
    expect(shapeOf(path)).toEqual(shape);
    expect(versionOf(path)).toBe(0);
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
    expect(result.map((r) => r.status)).toEqual(["failed", "upgraded"]);
    expect(result[0]?.path).toBe(bad);
    expect(result[0]?.error).not.toBe("");
    expect(wavesOf(good)).toEqual([{ ticket_id: "T1", wave: 1 }]);
  });

  test("a missing path is an error and creates no file", async () => {
    const missing = join(root, "nope", PLAN_DB);
    expect(() => findStores([missing])).toThrow(MissingPathError);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(root, "nope"))).toBe(false);
  });
});
