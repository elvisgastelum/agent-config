// The /planning plan tools an agent reaches over MCP: read side.

import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { McpTool } from "./mcp.ts";
import { PLAN_DB, PLAN_STORE_PATH, PLANS_DIR } from "./planning.ts";
import { findStores, readPlan, type PlanDetail } from "./plans.ts";

/** The server name an agent registers the plan tools under. */
export const PLANS_MCP = "plans";

export const PLANS_MCP_INSTRUCTIONS = `Plan stores live at ${PLAN_STORE_PATH} under the repository root. Pass absolute store paths (plan_list returns them). Read with plan_get sections or small plan_query selects, not a full dump.`;

/** Most rows plan_query returns; more are cut and flagged as truncated. */
const MAX_QUERY_ROWS = 500;

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

export function planTools(cwd: string): McpTool[] {
  return [
    {
      name: "plan_list",
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
      name: "plan_get",
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
      name: "plan_query",
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
          const params = (args.params as (string | number | null)[] | undefined) ?? [];
          const rows = db.prepare(String(args.sql)).all(...params);
          return { rows: rows.slice(0, MAX_QUERY_ROWS), truncated: rows.length > MAX_QUERY_ROWS };
        } finally {
          db.close();
        }
      },
    },
  ];
}
