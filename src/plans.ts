// Finds and upgrades the SQLite stores of /planning plans.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLAN_DB, PLAN_SCHEMA } from "./planning.ts";

/** Directories a store search never enters. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

export class MissingPathError extends Error {}

export type PlanUpgrades = {
  upgraded: string[];
  failed: { path: string; error: string }[];
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

/** Runs the schema on each store in one transaction; a store that fails does not stop the rest. */
export async function upgradeStores(stores: string[], dryRun = false): Promise<PlanUpgrades> {
  const result: PlanUpgrades = { upgraded: [], failed: [] };
  if (dryRun) return { ...result, upgraded: [...stores] };
  // Loaded here so the SQLite experimental warning never shows on other commands.
  const { DatabaseSync } = await import("node:sqlite");
  for (const path of stores) {
    try {
      const db = new DatabaseSync(path);
      try {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(PLAN_SCHEMA);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } finally {
        db.close();
      }
      result.upgraded.push(path);
    } catch (error) {
      result.failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
