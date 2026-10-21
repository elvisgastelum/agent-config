// The /planning plan tools an agent reaches over MCP: read tools, and write tools that each run in
// one BEGIN IMMEDIATE transaction on a store at the current schema version. Write results are rows
// as stored (snake_case columns), unlike readPlan's camelCase.

import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonSchema, McpTool } from "./mcp.ts";
import {
  DECIDED_BY,
  FINDING_KINDS,
  FINDING_STATUSES,
  PLAN_DB,
  PLAN_KIND_NAMES,
  PLAN_SCHEMA,
  PLAN_SCHEMA_VERSION,
  PLAN_STATUSES,
  PLAN_TOOLS,
  PLAN_STORE_PATH,
  PLAN_TRACKERS,
  PLANS_MCP,
  PLANS_DIR,
  PLANS_UPGRADE,
  STORY_SIZES,
  TICKET_KINDS,
  TICKET_STATUSES,
} from "./planning.ts";
import {
  BUSY_TIMEOUT_MS,
  checkVersion,
  findStores,
  readPlan,
  versionOf,
  type Database,
  type PlanDetail,
} from "./plans.ts";

export { PLANS_MCP };

export const PLANS_MCP_INSTRUCTIONS = `Plan stores live at ${PLAN_STORE_PATH} under the repository root. Pass absolute store paths (plan_list returns them). Read with plan_get sections or small plan_query selects, not a full dump.`;

/** Most rows plan_query returns; more are cut and flagged as truncated. */
const MAX_QUERY_ROWS = 500;

/** A plan title: lowercase words joined by single hyphens, as it names the store folder. */
const TITLE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_TITLE_LENGTH = 80;

const PLAN_SECTIONS = ["plan", "epics", "tickets", "decisions", "facts", "findings", "progress"];

/**
 * Resolves `store` against `cwd` to a plan store: a directory means its plan.sqlite, and the file
 * must exist at `.plans/<month>/<title>/plan.sqlite`.
 */
export function resolveStore(store: string, cwd: string): string {
  let path = isAbsolute(store) ? store : resolve(cwd, store);
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, PLAN_DB);
  const plansDir = basename(dirname(dirname(dirname(path))));
  if (basename(path) !== PLAN_DB || plansDir !== PLANS_DIR) {
    throw new Error(`${store} is not a plan store; expected ${PLAN_STORE_PATH}`);
  }
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return path;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Row = Record<string, unknown>;

/**
 * Runs `change` in one immediate transaction on a store at the current schema version, with foreign
 * keys on. A failed change rolls back and rethrows its own error.
 */
async function writeStore<T>(store: string, cwd: string, change: (db: Database) => T): Promise<T> {
  const path = resolveStore(store, cwd);
  // Loaded here so the SQLite experimental warning never shows on other commands.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA foreign_keys = ON");
    const version = versionOf(db);
    checkVersion(version);
    if (version < PLAN_SCHEMA_VERSION) {
      throw new Error(
        `store is schema v${version}; run agent-config plans ${PLANS_UPGRADE} <path> first`,
      );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = change(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The original error is the one worth reporting.
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

/** The arguments the caller gave, minus `store` and the key, as column values. */
const given = (args: Row, columns: string[]): Row =>
  Object.fromEntries(columns.filter((c) => args[c] !== undefined).map((c) => [c, args[c]]));

function insertRow(db: Database, table: string, values: Row): number {
  const columns = Object.keys(values);
  const marks = columns.map(() => "?").join(", ");
  const result = db
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${marks})`)
    .run(...(Object.values(values) as never[]));
  return Number(result.lastInsertRowid);
}

function updateRow(db: Database, table: string, key: string, id: unknown, values: Row): void {
  const columns = Object.keys(values);
  if (columns.length === 0) return;
  db.prepare(
    `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`,
  ).run(...(Object.values(values) as never[]), id as never);
}

const selectRow = (db: Database, table: string, key: string, id: unknown): Row =>
  db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id as never) as Row;

/** Updates the given columns of row `id`, or inserts it when new; an insert needs `required` too. */
function saveRow(
  db: Database,
  table: string,
  id: unknown,
  args: Row,
  columns: string[],
  required: string[],
): Row {
  const values = given(args, columns);
  if (selectRow(db, table, "id", id)) {
    updateRow(db, table, "id", id, values);
  } else {
    const missing = required.filter((c) => values[c] === undefined);
    if (missing.length > 0) {
      throw new Error(`${table} ${String(id)} is new; missing ${missing.join(", ")}`);
    }
    insertRow(db, table, { id, ...values });
  }
  return selectRow(db, table, "id", id);
}

const text = (description?: string): JsonSchema => ({ type: "string", minLength: 1, description });
const nullableText: JsonSchema = { type: ["string", "null"] };
const choice = (values: readonly string[]): JsonSchema => ({ type: "string", enum: [...values] });
const storeProp: JsonSchema = text("Absolute path of the plan.sqlite");

const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const EPIC_FIELDS: Record<string, JsonSchema> = {
  title: text(),
  goal: text(),
  done_when: text(),
  position: { type: "integer" },
  tracker_id: nullableText,
};
const EPIC_REQUIRED = ["title", "goal", "done_when", "position"];

const TICKET_FIELDS: Record<string, JsonSchema> = {
  epic_id: nullableText,
  kind: choice(TICKET_KINDS),
  title: text(),
  outcome: text(),
  done_when: text(),
  size: choice(STORY_SIZES),
  touches: text(),
  status: choice(TICKET_STATUSES),
  tracker_id: nullableText,
};
const TICKET_REQUIRED = ["title", "outcome", "done_when", "size", "touches"];

const BLOCK_FIELDS = { blocker: text(), blocked: text() };

const atLeastOne = (args: Row, columns: string[]): Row => {
  const values = given(args, columns);
  if (Object.keys(values).length === 0)
    throw new Error(`give at least one of ${columns.join(", ")}`);
  return values;
};

export function planTools(cwd: string): McpTool[] {
  return [
    {
      name: PLAN_TOOLS.plan_list,
      description: `Lists the plan stores under a repository's ${PLANS_DIR} folder with each plan's title, kind, status and ticket progress. Start here to find a store path.`,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Repository root (default: the server's directory)",
          },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const root = typeof args.root === "string" ? resolve(cwd, args.root) : cwd;
        const dir = join(root, PLANS_DIR);
        const paths = existsSync(dir) ? findStores([dir]) : [];
        const stores = [];
        for (const store of paths) {
          try {
            const { plan, version, progress } = await readPlan(store);
            stores.push({
              store,
              title: plan?.title ?? null,
              kind: plan?.kind ?? null,
              status: plan?.status ?? null,
              version,
              progress,
            });
          } catch (error) {
            stores.push({ store, error: message(error) });
          }
        }
        return { stores };
      },
    },
    {
      name: PLAN_TOOLS.plan_get,
      description:
        "Reads a plan store, optionally only some sections (plan, epics, tickets, decisions, facts, findings, progress). Prefer asking for the sections you need.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          store: { type: "string", minLength: 1, description: "Absolute path of the plan.sqlite" },
          sections: { type: "array", items: { type: "string", enum: PLAN_SECTIONS } },
        },
        required: ["store"],
        additionalProperties: false,
      },
      async handler(args) {
        const detail = await readPlan(resolveStore(String(args.store), cwd));
        const wanted = (args.sections as string[] | undefined) ?? PLAN_SECTIONS;
        const result: Record<string, unknown> = { store: detail.path, version: detail.version };
        for (const section of wanted) result[section] = detail[section as keyof PlanDetail];
        return result;
      },
    },
    {
      name: PLAN_TOOLS.plan_query,
      description: `Runs one read-only SQL statement against a plan store and returns up to ${MAX_QUERY_ROWS} rows. Use small selects, for example SELECT * FROM waves ORDER BY wave.`,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          store: { type: "string", minLength: 1, description: "Absolute path of the plan.sqlite" },
          sql: { type: "string", minLength: 1 },
          params: { type: "array", items: { type: ["string", "number", "null"] } },
        },
        required: ["store", "sql"],
        additionalProperties: false,
      },
      async handler(args) {
        const path = resolveStore(String(args.store), cwd);
        // Loaded here so the SQLite experimental warning never shows on other commands.
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
          const params = (args.params as (string | number | null)[] | undefined) ?? [];
          const rows = db.prepare(String(args.sql)).all(...params);
          return { rows: rows.slice(0, MAX_QUERY_ROWS), truncated: rows.length > MAX_QUERY_ROWS };
        } finally {
          db.close();
        }
      },
    },
    {
      name: PLAN_TOOLS.plan_create,
      description: `Creates a plan store at ${PLAN_STORE_PATH} under the root and returns its absolute path. Refuses when that store already exists.`,
      readOnly: false,
      inputSchema: object(
        {
          root: text("Repository root (default: the server's directory)"),
          title: text("Kebab-case plan title, at most 80 characters"),
          kind: choice(PLAN_KIND_NAMES),
          request: text("What the user asked to plan"),
        },
        ["title", "kind", "request"],
      ),
      async handler(args) {
        const title = String(args.title);
        if (title.length > MAX_TITLE_LENGTH || !TITLE_PATTERN.test(title)) {
          throw new Error(
            `title must be kebab-case (${TITLE_PATTERN.source}) and at most ${MAX_TITLE_LENGTH} characters`,
          );
        }
        const root = typeof args.root === "string" ? resolve(cwd, args.root) : cwd;
        const now = new Date();
        const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
        const store = join(root, PLANS_DIR, month, title, PLAN_DB);
        mkdirSync(dirname(store), { recursive: true });
        // Claim the file exclusively, so a concurrent create fails here and the cleanup below only
        // ever removes a file this call made.
        try {
          closeSync(openSync(store, "wx"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`${store} already exists`);
          }
          throw error;
        }
        const { DatabaseSync } = await import("node:sqlite");
        try {
          const db = new DatabaseSync(store);
          try {
            db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
            db.exec(PLAN_SCHEMA);
            insertRow(db, "plan", { id: 1, title, kind: args.kind, request: args.request });
          } finally {
            db.close();
          }
        } catch (error) {
          rmSync(store, { force: true });
          throw error;
        }
        return { store };
      },
    },
    {
      name: PLAN_TOOLS.plan_update,
      description:
        "Sets the kind, outcome, status or tracker of the plan and returns the plan row. Give at least one field.",
      readOnly: false,
      inputSchema: object(
        {
          store: storeProp,
          kind: choice(PLAN_KIND_NAMES),
          outcome: text(),
          status: choice(PLAN_STATUSES),
          tracker: choice(PLAN_TRACKERS),
        },
        ["store"],
      ),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => {
          updateRow(
            db,
            "plan",
            "id",
            1,
            atLeastOne(args, ["kind", "outcome", "status", "tracker"]),
          );
          return selectRow(db, "plan", "id", 1);
        }),
    },
    {
      name: PLAN_TOOLS.fact_add,
      description: "Records a fact found while exploring, with where it came from. Returns its id.",
      readOnly: false,
      inputSchema: object({ store: storeProp, topic: text(), fact: text(), source: text() }, [
        "store",
        "topic",
        "fact",
        "source",
      ]),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => ({
          id: insertRow(db, "facts", given(args, ["topic", "fact", "source"])),
        })),
    },
    {
      name: PLAN_TOOLS.decision_add,
      description:
        "Records a decision: the question, the answer, why, and whether the user or a recommendation decided it. Returns its id.",
      readOnly: false,
      inputSchema: object(
        {
          store: storeProp,
          topic: text(),
          question: text(),
          answer: text(),
          why: text(),
          decided_by: choice(DECIDED_BY),
        },
        ["store", "topic", "question", "answer", "decided_by"],
      ),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => ({
          id: insertRow(
            db,
            "decisions",
            given(args, ["topic", "question", "answer", "why", "decided_by"]),
          ),
        })),
    },
    {
      name: PLAN_TOOLS.finding_add,
      description:
        "Records a gap, red flag, smell or risk found by a review lens, with why it matters. Returns its id.",
      readOnly: false,
      inputSchema: object(
        {
          store: storeProp,
          kind: choice(FINDING_KINDS),
          lens: text(),
          detail: text(),
          why: text(),
          recommendation: text(),
        },
        ["store", "kind", "lens", "detail", "why"],
      ),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => ({
          id: insertRow(
            db,
            "findings",
            given(args, ["kind", "lens", "detail", "why", "recommendation"]),
          ),
        })),
    },
    {
      name: PLAN_TOOLS.finding_update,
      description:
        "Sets the status, resolution or ticket of a finding and returns the finding row. Give at least one field.",
      readOnly: false,
      inputSchema: object(
        {
          store: storeProp,
          id: { type: "integer" },
          status: choice(FINDING_STATUSES),
          resolution: text(),
          ticket_id: text(),
        },
        ["store", "id"],
      ),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => {
          const values = atLeastOne(args, ["status", "resolution", "ticket_id"]);
          if (!selectRow(db, "findings", "id", args.id)) {
            throw new Error(`finding ${String(args.id)} not found`);
          }
          updateRow(db, "findings", "id", args.id, values);
          return selectRow(db, "findings", "id", args.id);
        }),
    },
    {
      name: PLAN_TOOLS.epic_save,
      description:
        "Updates the given fields of an epic, or creates it when the id is new (then title, goal, done_when and position are required). Returns the epic row.",
      readOnly: false,
      inputSchema: object({ store: storeProp, id: text(), ...EPIC_FIELDS }, ["store", "id"]),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) =>
          saveRow(db, "epics", args.id, args, Object.keys(EPIC_FIELDS), EPIC_REQUIRED),
        ),
    },
    {
      name: PLAN_TOOLS.ticket_save,
      description:
        "Updates the given fields of a ticket, or creates it when the id is new (then title, outcome, done_when, size and touches are required). Also how ticket progress is recorded: set status. Returns the ticket row.",
      readOnly: false,
      inputSchema: object({ store: storeProp, id: text(), ...TICKET_FIELDS }, ["store", "id"]),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) =>
          saveRow(db, "tickets", args.id, args, Object.keys(TICKET_FIELDS), TICKET_REQUIRED),
        ),
    },
    {
      name: PLAN_TOOLS.block_add,
      description: "Makes one ticket block another: the blocked ticket waits for the blocker.",
      readOnly: false,
      inputSchema: object({ store: storeProp, ...BLOCK_FIELDS }, ["store", "blocker", "blocked"]),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => {
          insertRow(db, "blocks", given(args, ["blocker", "blocked"]));
          return { blocker: args.blocker, blocked: args.blocked };
        }),
    },
    {
      name: PLAN_TOOLS.block_remove,
      description:
        "Removes a blocker link between two tickets; a link that does not exist is an error.",
      readOnly: false,
      inputSchema: object({ store: storeProp, ...BLOCK_FIELDS }, ["store", "blocker", "blocked"]),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => {
          const result = db
            .prepare("DELETE FROM blocks WHERE blocker = ? AND blocked = ?")
            .run(args.blocker as string, args.blocked as string);
          if (Number(result.changes) === 0) {
            throw new Error(`${String(args.blocker)} does not block ${String(args.blocked)}`);
          }
          return { blocker: args.blocker, blocked: args.blocked };
        }),
    },
    {
      name: PLAN_TOOLS.draft_replace,
      description:
        "Replaces the whole draft in one transaction: deletes every block, ticket and epic, then inserts the given ones. Returns the counts and the waves the tickets can start in; on any error the earlier draft stays.",
      readOnly: false,
      inputSchema: object(
        {
          store: storeProp,
          epics: {
            type: "array",
            items: object({ id: text(), ...EPIC_FIELDS }, ["id", ...EPIC_REQUIRED]),
          },
          tickets: {
            type: "array",
            items: object({ id: text(), ...TICKET_FIELDS }, ["id", ...TICKET_REQUIRED]),
          },
          blocks: { type: "array", items: object(BLOCK_FIELDS, ["blocker", "blocked"]) },
        },
        ["store", "epics", "tickets", "blocks"],
      ),
      handler: (args) =>
        writeStore(String(args.store), cwd, (db) => {
          const epics = args.epics as Row[];
          const tickets = args.tickets as Row[];
          const blocks = args.blocks as Row[];
          for (const table of ["blocks", "tickets", "epics"]) db.exec(`DELETE FROM ${table}`);
          const epicColumns = ["id", ...Object.keys(EPIC_FIELDS)];
          const ticketColumns = ["id", ...Object.keys(TICKET_FIELDS)];
          for (const epic of epics) insertRow(db, "epics", given(epic, epicColumns));
          for (const ticket of tickets) insertRow(db, "tickets", given(ticket, ticketColumns));
          for (const block of blocks) insertRow(db, "blocks", given(block, ["blocker", "blocked"]));
          return {
            epics: epics.length,
            tickets: tickets.length,
            blocks: blocks.length,
            waves: db
              .prepare("SELECT epic_id, ticket_id, wave FROM waves ORDER BY wave, ticket_id")
              .all(),
          };
        }),
    },
  ];
}
