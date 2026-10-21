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

export type Database = import("node:sqlite").DatabaseSync;

/** How long a connection waits for another writer's lock before failing. */
export const BUSY_TIMEOUT_MS = 5000;

export function versionOf(db: Database): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

/** The version a store may be upgraded from; a newer one was written by a newer agent-config. */
export function checkVersion(from: number): void {
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

/** Ticket statuses the schema allows, as the progress counts use them. */
const STATUS_TODO = "todo";
const STATUS_IN_PROGRESS = "in_progress";
const STATUS_DONE = "done";

/** The single row of table `plan`. */
export type PlanRow = {
  title: string;
  kind: string;
  request: string;
  outcome: string | null;
  status: string;
  tracker: string;
  createdAt: string;
};

export type PlanEpic = {
  id: string;
  title: string;
  goal: string;
  doneWhen: string;
  position: number;
  trackerId: string | null;
};

/** A ticket with its blocker ids and the wave it can start in (null when done or stuck). */
export type PlanTicket = {
  id: string;
  epicId: string | null;
  kind: string;
  title: string;
  outcome: string;
  doneWhen: string;
  size: string;
  touches: string;
  status: string;
  trackerId: string | null;
  blockedBy: string[];
  wave: number | null;
};

export type PlanDecision = {
  id: number;
  topic: string;
  question: string;
  answer: string;
  why: string | null;
  decidedBy: string;
};

export type PlanFact = { id: number; topic: string; fact: string; source: string };

export type PlanFinding = {
  id: number;
  kind: string;
  lens: string;
  detail: string;
  why: string;
  recommendation: string | null;
  status: string;
  resolution: string | null;
  ticketId: string | null;
};

/** Ticket counts by status. */
export type PlanProgress = { todo: number; inProgress: number; done: number; total: number };

/** Everything one store holds, for display. */
export type PlanDetail = {
  path: string;
  version: number;
  plan: PlanRow | null;
  epics: PlanEpic[];
  tickets: PlanTicket[];
  decisions: PlanDecision[];
  facts: PlanFact[];
  findings: PlanFinding[];
  progress: PlanProgress;
};

/** Reads one store without writing to it; a store newer than this agent-config throws. */
export async function readPlan(path: string): Promise<PlanDetail> {
  // Loaded here so the SQLite experimental warning never shows on other commands.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = versionOf(db);
    checkVersion(version);
    const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
    const plan =
      (db
        .prepare(
          "SELECT title, kind, request, outcome, status, tracker, created_at AS createdAt FROM plan WHERE id = 1",
        )
        .get() as PlanRow | undefined) ?? null;
    const epics = all<PlanEpic>(
      "SELECT id, title, goal, done_when AS doneWhen, position, tracker_id AS trackerId FROM epics ORDER BY position, id",
    );
    const blockedBy = new Map<string, string[]>();
    for (const row of all<{ blocker: string; blocked: string }>(
      "SELECT blocker, blocked FROM blocks ORDER BY blocker",
    )) {
      blockedBy.set(row.blocked, [...(blockedBy.get(row.blocked) ?? []), row.blocker]);
    }
    const waves = new Map(
      all<{ ticket_id: string; wave: number }>("SELECT ticket_id, wave FROM waves").map((row) => [
        row.ticket_id,
        Number(row.wave),
      ]),
    );
    const tickets = all<Omit<PlanTicket, "blockedBy" | "wave">>(
      "SELECT id, epic_id AS epicId, kind, title, outcome, done_when AS doneWhen, size, touches, status, tracker_id AS trackerId FROM tickets ORDER BY rowid",
    ).map((ticket) => ({
      ...ticket,
      blockedBy: blockedBy.get(ticket.id) ?? [],
      wave: waves.get(ticket.id) ?? null,
    }));
    const count = (status: string): number => tickets.filter((t) => t.status === status).length;
    return {
      path,
      version,
      plan,
      epics,
      tickets,
      decisions: all<PlanDecision>(
        "SELECT id, topic, question, answer, why, decided_by AS decidedBy FROM decisions ORDER BY id",
      ),
      facts: all<PlanFact>("SELECT id, topic, fact, source FROM facts ORDER BY id"),
      findings: all<PlanFinding>(
        "SELECT id, kind, lens, detail, why, recommendation, status, resolution, ticket_id AS ticketId FROM findings ORDER BY id",
      ),
      progress: {
        todo: count(STATUS_TODO),
        inProgress: count(STATUS_IN_PROGRESS),
        done: count(STATUS_DONE),
        total: tickets.length,
      },
    };
  } finally {
    db.close();
  }
}
