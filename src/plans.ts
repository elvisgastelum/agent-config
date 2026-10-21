// Finds and upgrades the SQLite stores of /planning plans.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLAN_DB, PLAN_MIGRATIONS, PLAN_SCHEMA_VERSION } from "./planning.ts";

/** Directories a store search never enters. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

export class MissingPathError extends Error {}

/** What an upgrade did to one store; `pending` is a dry run that would upgrade it. */
export type PlanUpgrade = {
  path: string;
  status: "upgraded" | "current" | "pending" | "failed";
  from?: number;
  to?: number;
  error?: string;
};

function collect(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collect(path, found);
    } else if (entry.name === PLAN_DB) {
      found.push(path);
    }
  }
}

/** A file is one store; a directory is searched for stores. A missing path throws. */
export function findStores(paths: string[]): string[] {
  const found: string[] = [];
  for (const given of paths) {
    const path = resolve(given);
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      throw new MissingPathError(`${given} does not exist`);
    }
    if (isDir) collect(path, found);
    else found.push(path);
  }
  return [...new Set(found)];
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Database = import("node:sqlite").DatabaseSync;

function versionOf(db: Database): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

/** The version a store may be upgraded from; a newer one was written by a newer agent-config. */
function checkVersion(from: number): void {
  if (from > PLAN_SCHEMA_VERSION) {
    throw new Error(
      `store version ${from} is newer than the ${PLAN_SCHEMA_VERSION} this agent-config supports; run agent-config update`,
    );
  }
}

/**
 * Brings each store to the current schema version in one transaction, applying the migrations it
 * is missing; a store that fails does not stop the rest. A dry run reads each store read-only.
 */
export async function upgradeStores(stores: string[], dryRun = false): Promise<PlanUpgrade[]> {
  // Loaded here so the SQLite experimental warning never shows on other commands.
  const { DatabaseSync } = await import("node:sqlite");
  const to = PLAN_SCHEMA_VERSION;
  const results: PlanUpgrade[] = [];
  for (const path of stores) {
    try {
      const db = new DatabaseSync(path, { readOnly: dryRun });
      try {
        if (dryRun) {
          const from = versionOf(db);
          checkVersion(from);
          results.push({ path, status: from === to ? "current" : "pending", from, to });
          continue;
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          const from = versionOf(db);
          checkVersion(from);
          if (from === to) {
            db.exec("ROLLBACK");
            results.push({ path, status: "current", from, to });
            continue;
          }
          for (const migration of PLAN_MIGRATIONS.slice(from, to)) db.exec(migration);
          db.exec(`PRAGMA user_version = ${to}`);
          db.exec("COMMIT");
          results.push({ path, status: "upgraded", from, to });
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
    } catch (error) {
      results.push({ path, status: "failed", error: message(error) });
    }
  }
  return results;
}
