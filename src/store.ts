// How /brief and /continue reach a plan store when a ticket ID is not in Kaneo or Kaneo is not
// installed: where stores are found, which one an ID resolves to, and how every session writes it.
// One text, shared by every action that works store tickets, so the rules never drift apart.

import {
  PLAN_DB,
  PLANS_DIR,
  PYTHON_FALLBACK,
  STORE_MIGRATION,
  STORE_WRITE_PREFIX,
} from "./planning.ts";

/** Every plan store, one folder per month and per plan. */
export const storeGlob = (): string => `${PLANS_DIR}/*/*/${PLAN_DB}`;

/** Only plans the planning action finished writing are worked. */
export const WRITTEN_STATUS = "written";

/** Month folders sorted newest first: by year, then by month. */
export const MONTH_ORDER_EXAMPLE = "01-2027, 10-2026, 02-2026";

/** The ticket table's columns that track who works a ticket and its PR. */
export const SESSIONS_TABLE = "ticket_sessions";
export const PR_URL_COLUMN = "tickets.pr_url";

/** The status write for the ticket `<ID>`; built on call, since planning.ts imports this file's users. */
export const setStatus = (status: string): string =>
  `${STORE_WRITE_PREFIX} UPDATE tickets SET status = '${status}' WHERE id = '<ID>';`;

/** The session row a session or orchestrator adds when it takes the ticket `<ID>`. */
export const START_SESSION =
  "INSERT INTO ticket_sessions (ticket_id, session_id, started_at, last_seen_at) VALUES ('<ID>', '<session id>', datetime('now'), datetime('now'));";

/** The heading shared by every action's store section. */
export const STORE_HEADING = "Plan store fallback";

const code = (text: string): string => `\`${text}\``;

/**
 * The store rules every action renders under its own heading: lookup order, discovery, writes,
 * the migration and sessions. Built on call, since planning.ts imports the actions that import this.
 */
export function storeAccess(scribe: string): string {
  return `An ID that is not a Kaneo ticket can be a ticket or epic in a plan store that the planning action wrote.

**Lookup order.**

1. Kaneo first, when the \`kaneo\` item is installed and ${scribe} gets an answer from the Kaneo MCP \`whoami\`. When the ID resolves in Kaneo, Kaneo wins, even when a store has the same ID.
2. Fall back to the stores only when Kaneo is not installed, \`whoami\` gets no answer, or Kaneo answers explicitly that no such identifier exists after \`whoami\` succeeded. Any other Kaneo error (timeouts, permissions, server errors) stops the run: report it, never fall back.
3. A store plan whose \`plan.tracker\` is \`kaneo\` already lives in Kaneo: work its tickets in Kaneo through their \`tracker_id\`.

**Discovery.** Resolve the main checkout's root to an absolute path (the first \`worktree\` line of \`git worktree list --porcelain\`); a worktree has no \`${PLANS_DIR}\` of its own. Its stores are ${code(storeGlob())}. Use only stores whose plan row has \`status = '${WRITTEN_STATUS}'\`, and look the ID up in their \`tickets\` and \`epics\`. One match is taken silently. Several matches ask the user which plan, newest first: order the \`MM-yyyy\` folders by year, then by month, newest first, never as plain text (${MONTH_ORDER_EXAMPLE}). Hand every agent that works a store ticket this absolute store path.

**Reads and writes.** Query with small selects (\`sqlite3 -box <store> "SELECT …"\`). Start every write with ${code(STORE_WRITE_PREFIX)}: a leading \`5000\` line from a write is the busy_timeout prefix echoing, not an error. ${PYTHON_FALLBACK}

**Migration.** Before the first write to a store, including the status update right after reading the ticket at pick, bring it up to date: when ${code(STORE_MIGRATION.check)} returns no row, run ${code(STORE_MIGRATION.addPrUrl)}, which fails when run twice, so the check always comes first; then run \`CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE}\` from the planning schema (\`ticket_id\` referencing \`tickets(id)\` with \`ON DELETE CASCADE\`, \`session_id\`, \`started_at\`, \`last_seen_at\`, \`ended_at\`, primary key \`(ticket_id, session_id)\`), which is safe to repeat.

**Sessions.** A session's id is the runtime's session id when the runtime exposes one, otherwise a UUID generated at the start of the run and kept for the whole run. The session or orchestrator working a ticket writes the store itself, at the absolute path it was given, and owns its \`${SESSIONS_TABLE}\` row: it inserts the row (\`started_at\`, \`last_seen_at\`) when it takes the ticket, updates \`last_seen_at\` on each of its store writes, writes the PR URL to ${code(PR_URL_COLUMN)} after opening the PR, and sets \`ended_at\` when the PR is opened, it stops or it fails. Ended sessions never count as active.`;
}
