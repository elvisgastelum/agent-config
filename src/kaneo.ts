// The kaneo catalog item's text: the work-tracking skill, its always-on instructions and the
// cheap kaneo-scribe agent that saves tickets, rendered per runtime.

import { RUNTIME_LABELS, type Runtime } from "./tiers.ts";

/** The catalog item that installs this skill, the scribe and the MCP server. */
export const KANEO_ITEM = "kaneo";
export const KANEO_SKILL = "kaneo-work-tracking";
export const SCRIBE = "kaneo-scribe";
export const KANEO_MCP = "kaneo";

/** Kaneo has no epic type: an epic is a task whose title starts with this. */
export const EPIC_TITLE_PREFIX = "Epic: ";
export const EPIC_LABEL = "epic";
const EPIC_LABEL_COLOR = "#8B5CF6";
/** First line of every story description in an epic: `Epic: FEX-1`. */
export const EPIC_LINE = "Epic:";
/** Story description line naming the areas or paths it changes, so waves avoid overlap. */
export const TOUCHES_LINE = "Touches:";
/** How the stories of an epic split into waves that can run in parallel. */
export const WAVE_RULE = `The next wave is every open story with no unfinished blocker; when two of them share an area in their \`${TOUCHES_LINE}\` lines, the later one in priority order moves to the following wave.`;

/** The Kaneo MCP tools the scribe may call (Claude Code lists them by name). */
export const KANEO_TOOLS = [
  "whoami",
  "list_workspaces",
  "list_projects",
  "get_project",
  "list_project_columns",
  "list_tasks",
  "get_task",
  "search",
  "create_task",
  "update_task",
  "update_task_status",
  "move_task",
  "update_task_assignee",
  "update_task_due_date",
  "list_workspace_labels",
  "create_label",
  "attach_label_to_task",
  "detach_label_from_task",
  "get_task_relations",
  "create_task_relation",
  "delete_task_relation",
  "list_task_comments",
  "create_task_comment",
  "list_workspace_members",
].map((t) => `mcp__${KANEO_MCP}__${t}`);

const CALL: Record<Runtime, (agent: string) => string> = {
  claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
  opencode: (agent) => `the task tool with the \`${agent}\` agent`,
  codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
  pi: (agent) => `the subagent tool with the \`${agent}\` agent`,
};

/** The Kaneo web base URL, from what the user typed or an MCP endpoint. */
export function kaneoBaseUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  // A pasted dashboard or MCP link keeps only the part before /dashboard or /api, so a Kaneo
  // served under a sub-path still works; query and fragment never belong to the base.
  const path = url.pathname.replace(/\/(dashboard|api)(\/.*)?$/, "").replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Warns about a base URL that would send Kaneo MCP traffic, and its credentials, unencrypted. */
export function kaneoUrlWarning(base: string): string | undefined {
  const url = new URL(base);
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
  if (url.protocol === "http:" && !local)
    return `${base} is not https: Kaneo MCP traffic, including any credentials, is sent unencrypted`;
  return undefined;
}

export function kaneoMcpUrl(base: string): string {
  return `${base}/api/mcp`;
}

export function kaneoSkillMarkdown(runtime: Runtime, scribeModel: string): string {
  return `---
name: ${KANEO_SKILL}
description: Kaneo stories, tickets, estimates, labels, dependencies, or work splitting, plus branches and pull requests for Kaneo tickets. Use when planning, creating, estimating, or tracking work through the Kaneo MCP, or when creating a branch or PR for work on a Kaneo ticket such as FEX-2.
---

# Kaneo work tracking

Use the Kaneo MCP as the source of truth for work. Discover the target workspace, project, and project columns before creating or changing work; do not assume a Kaneo URL, ID, project, status, or assignee.

## Keep Kaneo work on cheap models

Kaneo calls return long JSON and ticket text is boilerplate, so neither belongs in the main session. Decide scope, estimates, splits, and dependencies here; let cheap agents gather and type.

- **Context for a ticket**: when the ticket needs facts from code, logs, or a diff (where a behavior lives, what a change touched, why a test fails), ask ${CALL[runtime]("ladder-read-fast")} for terse \`path:line\` bullets when the model-ladder agents are installed, and put only those bullets in the description.
- **Saving tickets**: hand the finished batch to ${CALL[runtime](SCRIBE)} (${scribeModel}). Give it the workspace and project IDs, and for each story the exact title, description, column, priority, labels, and relations. It creates or updates them and replies with identifiers and task IDs; it decides nothing.
- **Reading the board**: ask the scribe for a summary (open tickets in a column, a ticket's relations) instead of listing tasks here.
- **Check its work**: compare the scribe's reply with the batch you sent, and fetch one task yourself when something is missing. When it replies \`partial\` or a call failed, fix only that item, directly or with one more scribe call.
- Without an agent tool, or for a single small call, use the Kaneo MCP directly.

## Create a story

1. List workspaces, projects, and the target project's columns. When the request does not identify one clear destination, ask the user to choose.
2. Estimate the work before creating it. A new implementation story must be \`P5\` or smaller; split larger scope first.
3. Create the task, then label it. Kaneo keeps one label row per task, so create each label on the task with \`create_label\`, its \`taskId\` and the color below. Do not list workspace labels to look one up: in a large workspace the result is too big to read.
4. Give the task a specific title, a description with the intended outcome and completion criteria, a selected project status, and an appropriate priority.
5. Report the created story and its estimate.

Every story created by an agent receives exactly these labels:

- \`made_by_agent\`, color \`#3B82F6\`.
- One point label in the \`P<number>\` format.

Reuse each label's exact name and color, so every task carries the same label. Create each label on a task once: no small read shows a task's labels, so a failed \`create_label\` is never retried: leave the story as is and name the missing label in the report. \`attach_label_to_task\` and \`detach_label_from_task\` take label ids, never names.

## Point scale

Use Fibonacci-sized point labels: \`P1\`, \`P2\`, \`P3\`, \`P5\`, \`P8\`, \`P13\`, \`P21\`, then \`P34\`, \`P55\`, and so on. Create only labels needed by the work being tracked, using these colors:

| Label | Meaning | Color |
| --- | --- | --- |
| \`P1\` | Small change | \`#22C55E\` |
| \`P2\` | About two tickets can fit in one day | \`#84CC16\` |
| \`P3\` | Preferred size: one day with some free time | \`#EAB308\` |
| \`P5\` | One full day of focused work | \`#F59E0B\` |
| \`P8\` | Too large for one implementation story; split it | \`#F97316\` |
| \`P13\` | Too large for one implementation story; split it | \`#EF4444\` |
| \`P21\` | Too large for one implementation story; split it | \`#B91C1C\` |
| \`P34\` | Too large for one implementation story; split it | \`#991B1B\` |
| \`P55\` and larger | Too large for one implementation story; split it | \`#7F1D1D\` |

For an existing oversized story, record its honest \`P8+\` estimate before splitting it when the user asks for an estimate. For new work, split the scope before task creation, so every created implementation story is \`P5\` or smaller.

## Split oversized work

Split any \`P8+\` work into independently trackable stories with a clear outcome and an estimate of \`P5\` or less. Do not create an oversized parent story just to hold the split.

For each resulting story:

- Create it in the selected project, attach \`made_by_agent\` and its point label, and state its completion criteria.
- State its execution order and prerequisites in the description.
- For a dependency, create a \`blocks\` relation from the prerequisite task to the task that must wait.
- For work that can proceed simultaneously, create \`related\` relations and state the parallel group in every participating task description.

Use the dependency graph as the execution order. A task with no unresolved prerequisite may run in parallel with other ready tasks. Report the ordered sequence, parallel groups, and blocking edges after creating the split.

## Plan an epic

An epic groups the stories of one outcome. Kaneo has no epic type, so mark it this way:

1. Create the epic as a task titled \`${EPIC_TITLE_PREFIX}<outcome>\`. Its description holds the goal and a "Done when" list of acceptance criteria. Label it \`made_by_agent\` and \`${EPIC_LABEL}\` (color \`${EPIC_LABEL_COLOR}\`), with no point label: an epic is never worked directly.
2. Split its scope into stories as above. Start every story description with these two lines, then its outcome and completion criteria:
   - \`${EPIC_LINE} <EPIC-ID>\`
   - \`${TOUCHES_LINE} <areas or paths it changes>\`
3. Create a \`related\` relation from the epic to each story, and a \`blocks\` relation for every prerequisite between stories.

A story's epic is the one its \`${EPIC_LINE}\` line names; an epic's stories are its \`related\` tasks that carry that line. ${WAVE_RULE}

## Update existing work

Fetch the task and its relations before changing it. Preserve labels and project status unless the request calls for a change. When adding an estimate to an existing task, ensure exactly one point label is attached; replace an obsolete point label rather than accumulating multiple estimates.

## Ticket identifiers

A ticket's identifier is its project slug, a hyphen, and its task number: project slug \`FEX\` with task \`number\` 2 is \`FEX-2\`. Read both values from Kaneo (\`get_project\` or \`list_tasks\` for the slug, \`get_task\` or \`list_tasks\` for the number); never guess them from the task title or its position in a column.

When the user names a ticket by identifier, resolve it by listing the project's tasks and matching \`number\`, then work from that task's title and description.

## Branches for ticket work

Name a branch for work on a Kaneo ticket \`<IDENTIFIER>/<short-description>\`:

- \`<IDENTIFIER>\` is the ticket identifier exactly as Kaneo shows it, uppercase: \`FEX-2\`.
- \`<short-description>\` is a lowercase kebab-case summary of the ticket title, at most about five words, without the identifier, numbering prefixes such as \`T01 ·\`, or punctuation: \`FEX-2/some-feature-getting-done\`.

Create it from the up-to-date default branch unless the user names another base:

\`\`\`bash
git fetch origin
git switch -c FEX-2/some-feature-getting-done origin/main
\`\`\`

Work for one ticket stays on one branch. When work spans several tickets, name the branch after the ticket that owns the main outcome and mention the others in the PR. Never create a bare \`FEX-2\` branch: Git cannot hold both \`FEX-2\` and \`FEX-2/...\` as branch names. Work without a Kaneo ticket follows the repository's own branch convention.

## Pull requests for ticket work

When a PR delivers work attached to a Kaneo ticket, mention the ticket:

- Start the PR body with a ticket line that links the ticket's Kaneo page: \`Kaneo: [FEX-2 — <ticket title>](<ticket URL>)\`. A bare identifier without the link is not enough.
- Link every other ticket the PR touches the same way, on the same line or the next.
- Keep the PR title in the repository's usual style; when the repository has no title convention, prefix it with the identifier: \`FEX-2: Add guest RSVP form\`.
- Derive the identifier from the branch name when it follows the convention above, and confirm it against Kaneo.

Build each ticket URL from values read from Kaneo, never from guesses:

\`\`\`text
<base-url>/dashboard/workspace/<workspaceId>/project/<projectId>/task/<taskId>
\`\`\`

- \`<base-url>\` is the \`kaneo\` MCP server URL without its trailing \`/api/mcp\`, such as \`https://kaneo.example.com\`.
- \`<workspaceId>\`, \`<projectId>\`, and \`<taskId>\` are the task's IDs from \`get_task\` or \`list_tasks\` (\`workspaceId\` from the project when the task omits it), not the project slug or task number.

A URL the user shared for the ticket works too. When the base URL or any ID cannot be read, stop and ask the user for the ticket URL instead of opening the PR with an unlinked ticket line.

After the PR exists, add a comment to the Kaneo task with the PR URL, and move the task to the project's review column when one exists and the user has not asked to keep the status. Leave PRs for work without a ticket unchanged.
`;
}

/** The always-on block; runtimes that share one file (a project's AGENTS.md) are all named. */
export function kaneoInstructionsBlock(runtimes: Runtime[]): string {
  const scribe =
    runtimes.length === 1
      ? CALL[runtimes[0]!](SCRIBE)
      : `the \`${SCRIBE}\` agent (${runtimes.map((r) => `${RUNTIME_LABELS[r]}: ${CALL[r](SCRIBE)}`).join("; ")})`;
  return `## Kaneo work tracking

Kaneo is the work tracker, reached through the \`${KANEO_MCP}\` MCP server. Use the \`${KANEO_SKILL}\` skill before planning, creating, estimating, splitting, or updating Kaneo tickets, and before creating a branch or PR for ticket work.

- A ticket identifier is the project slug plus the task number, such as \`FEX-2\`. Read both from Kaneo; never guess them.
- Name a branch for ticket work \`<IDENTIFIER>/<short-kebab-description>\`, such as \`FEX-2/some-feature-getting-done\`, created from the up-to-date default branch unless another base is named.
- A PR for ticket work starts its body with \`Kaneo: [<IDENTIFIER> — <ticket title>](<ticket URL>)\`, linking the ticket's Kaneo page, and links every other ticket it touches the same way. Build each URL from IDs read from Kaneo, as the \`${KANEO_SKILL}\` skill describes; never guess them. After opening it, comment the PR URL on the Kaneo task.
- Save and read tickets through ${scribe}, a cheap agent, and gather ticket context with ladder read agents, so Kaneo output stays out of this session.`;
}

export const SCRIBE_DESCRIPTION =
  "Kaneo ticket clerk on a cheap model. Creates, updates, labels, relates and comments Kaneo tasks exactly as specified, or summarizes the board, and replies with identifiers and task IDs. Never plans or estimates.";

export const SCRIBE_BODY = `You are the Kaneo scribe, a cheap worker that saves and reads Kaneo tickets through the \`${KANEO_MCP}\` MCP tools. The parent session already decided what to track; you carry it out exactly.

Rules:
- When the Kaneo tools are not declared yet, load them first with \`tool_search\` (query \`kaneo\`).
- Do only what the request lists. Never invent stories, change estimates, rename titles, or pick another project or column.
- Before creating tasks, read the project (for its slug) and its columns.
- Label tools take label ids, never names. Kaneo keeps one label row per task, so a label name is reused by creating it on each task: \`create_label\` with its \`taskId\` and the color the request gives. Use \`attach_label_to_task\` only with a label id the request gives. Never call \`list_workspace_labels\` to look a label up: in a large workspace its result is too big to read.
- Create tasks in the order given, then label them, then create relations (\`blocks\` from the prerequisite to the waiting task), then comments.
- For a summary request, read what is needed and reply with at most 15 bullets: identifier, title, column, labels, instead of the shape below.
- Never edit files or run shell commands. You are already a delegated agent: never delegate further.
- When a read or an update fails, retry it once. Never retry a create (task, label, relation, comment): it can succeed on the server even when its reply fails, so list it under FAILED marked \`unknown\` (it may exist; the parent checks before re-creating). Skip every label, relation and comment that depends on it, and list those under FAILED marked \`skipped\` (never sent). If any other call still fails, continue with the rest and report it.

For a write request, reply in exactly this shape:

STATUS: done | partial
SAVED:
- <IDENTIFIER> | <title> | <task id> | <labels>
RELATIONS: <created relations, or "none">
FAILED: <"none", or one line per failed call:>
- <unknown | skipped | error> | <call and its target> | <error>
`;
