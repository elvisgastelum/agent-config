// The t3-code-integration catalog item: routes the flows through the T3 Code MCP server when a
// session runs inside T3 Code, and changes nothing anywhere else.

import { START_SESSION } from "./store.ts";
import { RUNTIME_LABELS, type Runtime } from "./tiers.ts";

/** The catalog item's ID. */
export const T3_ITEM = "t3-code-integration";

/** The MCP server T3 Code adds to every session it starts. */
export const T3_SERVER = "t3-code";

/**
 * T3 Code tools that start work in a child agent, another thread, a worktree or a scheduled run.
 * The planning guard denies them; keep in step with T3_LAUNCH_TOOLS in assets/planning-guard.mjs.
 */
export const T3_LAUNCH_TOOLS = [
  "delegate_task",
  "t3_thread_launch",
  "create_threads",
  "t3_thread_send",
  "t3_worktree_handoff",
  "schedule_task",
  "run_scheduled_task_now",
] as const;

/** T3 Code's child-agent tool, whose handoffs the brief guard checks. */
export const T3_DELEGATE_TOOL = "delegate_task";

/** Claude's name for a T3 Code tool, as a hook matcher sees it. */
export const claudeT3Tool = (tool: string): string => `mcp__${T3_SERVER}__${tool}`;

/**
 * A hook matcher that matches exactly these tool names. Claude Code reads a matcher with a `-`
 * (as in `t3-code`) as a regex, so it is anchored: unanchored, `Write` would match `TodoWrite`.
 */
export const exactToolMatcher = (tools: readonly string[]): string => `^(?:${tools.join("|")})$`;

/** The tool names an exact matcher lists. */
export const matcherTools = (matcher: string): string[] =>
  matcher
    .replace(/^\^\(\?:/, "")
    .replace(/\)\$$/, "")
    .split("|");

/** The skill the item installs, loaded inside T3 Code before delegating or coordinating. */
export const T3_SKILL = "t3-code";

/** Each runtime's tool for asking the user a question with selectable options. */
export const QUESTION_TOOLS: Record<Runtime, string | undefined> = {
  claude: "AskUserQuestion",
  opencode: "question",
  codex: "request_user_input",
  pi: undefined,
};

/** Raw model IDs per rung, as `delegate_task` takes them in `target.model`; empty means inherit. */
export interface T3Models {
  fast: string;
  balanced: string;
  deep: string;
}

/** The gate every T3 line sits behind, so a session outside T3 Code reads it as a no-op. */
export const T3_GATE = `Only when the \`${T3_SERVER}\` MCP tools are available (T3 Code also sets \`T3CODE_THREAD_ID\`) does this apply; otherwise skip it and work exactly as the rest of these instructions say.`;

export const T3_SECTION_HEADING = "## In T3 Code";

const code = (text: string): string => `\`${text}\``;

/** How a run asks the user: the runtime's question tool with options, never plain text when one exists. */
export function questionRule(runtime: Runtime): string {
  const tool = QUESTION_TOOLS[runtime];
  const how = tool
    ? `the ${code(tool)} tool`
    : "the runtime's question tool when it has one (otherwise one message with numbered options)";
  return `Ask every question with ${how}: selectable options, the recommended one first and labelled so, multi-select when the choices combine, and a short description per option. Never ask in plain text when a question tool exists.`;
}

/** The rule for showing coordination visually. */
export const VISUAL_RULE = `When coordination has several parts (waves, dependencies, parallel tickets, merge order, a status board), show it as a diagram or table: check the page with ${code("html_preview")}, then show it with ${code("html_render")}, and keep a one-line text summary beside it.`;

const RELAY_RULE = `A child that asks a question waits for an answer: read it with ${code("t3_pending_request")} (${code("list")}, then ${code("read")}), ask the user with the question tool, and answer it with ${code("respond")}.`;

const rungModel = (model: string): string => (model ? code(model) : "the session model");

function questionLines(runtimes: Runtime[]): string {
  return runtimes
    .map((r) => {
      const tool = QUESTION_TOOLS[r];
      return `${RUNTIME_LABELS[r]}: ${tool ? code(tool) : "numbered options when it has no question tool"}`;
    })
    .join("; ");
}

/**
 * The always-on block. Runtimes that share one instructions file (AGENTS.md in a project) get one
 * block naming each runtime's question tool, so its text does not depend on which runtime planned it.
 */
export function t3InstructionsBlock(runtimes: Runtime[]): string {
  return `${T3_SECTION_HEADING}

${T3_GATE}

Inside T3 Code, load the \`${T3_SKILL}\` skill before delegating, running background work, creating worktrees, messaging another thread or session, or delivering a PR. Where T3 Code's own harness rules are stricter, they win.

- **Questions**: ask with the question tool (${questionLines(runtimes)}), as selectable options, the recommended one first, multi-select when choices combine; never as plain text when a question tool exists.
- **Visuals**: ${VISUAL_RULE}
- **Agents**: a same-provider sub-agent that finishes in this turn keeps the native agent tool. \`delegate_task\` is for another provider's model, a separate worktree, or background work. Follow its \`next\`; never poll \`task_status\`.
- **Worktrees**: T3 Code manages them. A child that needs its own checkout gets \`delegate_task\` with \`isolation:"worktree"\`, never \`git worktree add\`, and its checkout is never removed with \`git worktree remove\`.
- **Threads and sessions**: \`t3_thread_read\` a thread before answering about it. A new top-level thread (\`t3_thread_launch\`) is started only when the user picks it.`;
}

/** The skill: how each flow step maps onto T3 Code's tools. */
export function t3SkillMarkdown(runtime: Runtime, models: T3Models): string {
  return `---
name: ${T3_SKILL}
description: Inside T3 Code only (the ${T3_SERVER} MCP tools are available). Use before delegating to an agent, running background work, creating a worktree, messaging another thread or session, asking the user a question, showing a plan or status, or delivering a PR, so the work goes through T3 Code's tools. Outside T3 Code it does not apply.
---

# Working inside T3 Code

${T3_GATE}

Tool names here are bare; ${RUNTIME_LABELS.claude} calls them \`mcp__${T3_SERVER}__<tool>\`.

## Map each step to T3 Code

| Step | Outside T3 Code | Inside T3 Code |
|---|---|---|
| Sub-agent on this provider that finishes in this turn (ladder rungs, scribe, planners, reviewers) | the native agent tool | the same native agent tool |
| Work on another provider's model, in its own checkout, or left running in the background | \`agent-config delegate\` or a native agent | \`delegate_task\` |
| One ticket per worktree (parallel waves) | \`git worktree add\` plus one orchestrator each | \`delegate_task\` with \`isolation:"worktree"\`, one per ticket, launched together |
| Long checks, suites and builds | the foreground shell | a background command, then \`t3_background_wait\` with its task ID (${RUNTIME_LABELS.claude} only) |
| A question for the user | text | the question tool with selectable options |
| A plan, waves, merge order or status | text | a diagram or table through \`html_preview\` and \`html_render\` |
| After opening a PR | the PR URL in the report | \`link_pull_request\` with its full URL |
| Waiting for CI or reviews | polling | \`watch_pull_request\`, then end the turn; \`unwatch_pull_request\` before handing back |
| A credential | asking in chat | \`request_secret\` |
| Another session's work | the plan store's session rows | \`t3_thread_read\` that thread |

## Delegating

1. Call \`orchestrator_capabilities\` once per thread before the first \`delegate_task\`.
2. Pick \`target.model\` from the rung: fast ${rungModel(models.fast)}, balanced ${rungModel(models.balanced)}, deep ${rungModel(models.deep)}. A ladder handoff keeps its phase line as the first line of \`task\`. On ${RUNTIME_LABELS.claude}, the brief guard checks that line against \`target.model\`, and it knows only the haiku, sonnet and opus families, so a \`plan\`, \`risk\` or \`review\` handoff stays on a Claude model.
3. Write \`task\` so it stands alone: the child gets no history. Name the files, the acceptance criteria, the checks to run and what to report.
4. Keep each \`taskId\`. Follow the returned \`next\` and never poll: no \`task_status\` loops, no \`sleep\`, no watchers. Read \`task_status\` once its completion wakes you.
5. Stop a child you no longer need with \`task_cancel\`, never \`t3_thread_interrupt\`.
6. ${RELAY_RULE}

## Worktrees

A \`delegate_task\` with \`isolation:"worktree"\` gets a new checkout prepared from this thread's commit, under T3 Code's worktree folder. Uncommitted edits stay behind. The child creates its own branch there, \`git fetch origin && git checkout -b <branch> origin/<base>\`, and reports the checkout path (\`pwd\`) with its result. Merges then run in that checkout. T3 Code owns it: never \`git worktree remove\` it. \`t3_worktree_list\` and \`t3_worktree_status\` show what exists.

## Questions and visuals

- ${questionRule(runtime)}
- ${VISUAL_RULE}

## Threads and sessions

- \`t3_thread_read\` a thread before you answer about it or take over its work; mention a thread by its \`link\`.
- \`t3_thread_send\` continues another thread's work only when the user asks for it.
- \`t3_thread_launch\` starts a new top-level thread only when the user picks that option. Offer it as one of the question's options, beside copying the command.
- A plan store session row records \`T3CODE_THREAD_ID\` as the session id, so another thread can find the owner.
`;
}

/** The T3 lines the /continue action renders when the item is installed at its scope. */
export function t3ContinueSection(runtime: Runtime, models: T3Models): string {
  return `${T3_SECTION_HEADING}

${T3_GATE} Load the \`${T3_SKILL}\` skill first.

- **Sessions**: \`${START_SESSION}\` and the orchestrators' session rows use \`T3CODE_THREAD_ID\` as the session id. Before taking over an in_progress ticket, \`t3_thread_read\` the thread its last session names.
- **Questions**: ${questionRule(runtime)}
- **Show the plan**: the picked tickets, waves and merge order (parallel step 1.6, parallel-wave step 2.4) are shown as a diagram. ${VISUAL_RULE}
- **Parallel step 2**: T3 Code manages the worktrees, so skip \`git worktree add\`. Have the scribe move each ticket to In Progress.
- **Parallel step 3**: launch one child per ticket with \`delegate_task\`, all in the same turn: \`isolation:"worktree"\`, \`role:"implementation"\`, \`target.model\` ${rungModel(models.deep)}, \`title\` \`<IDENTIFIER> <ticket title>\`. Its \`task\` holds the orchestrator duties listed in step 3 and says: create the branch with \`git fetch origin && git checkout -b <branch> origin/<base>\`, act as the ladder orchestrator (load the \`model-ladder\` skill and hand reads, edits and reviews to ladder agents), and report the checkout path. Keep each \`taskId\` and follow \`next\` instead of waiting inline. ${RELAY_RULE}
- **Merge loop**: step 2 runs in the checkout path each child reported. While a PR waits for CI, \`watch_pull_request\` it instead of polling.
- **PRs**: after a PR opens, \`link_pull_request\` it with its full URL.
- **Clean up**: T3 Code owns the children's checkouts, so skip \`git worktree remove\`. The report table adds each ticket's thread link.`;
}

/** The T3 lines the /brief action renders when the item is installed at its scope. */
export function t3BriefSection(runtime: Runtime): string {
  return `${T3_SECTION_HEADING}

${T3_GATE} Load the \`${T3_SKILL}\` skill first.

- **Questions**: ${questionRule(runtime)}
- **Show the plan**: the epic, its waves, blockers and merge order are shown as a diagram before the brief is written. ${VISUAL_RULE}
- **Hand-off**: after copying the brief, also offer to start it in a new T3 Code thread as one option of the question. Only when the user picks it, \`t3_thread_launch\` with the brief as \`message\` and mention the thread by its \`link\`.`;
}

/**
 * The T3 lines the /planning action renders when the item is installed at its scope. Planning
 * stays planning: the planning guard denies T3 tools that start work elsewhere.
 */
export function t3PlanningSection(runtime: Runtime): string {
  return `${T3_SECTION_HEADING}

${T3_GATE} Load the \`${T3_SKILL}\` skill first.

- **Questions**: ${questionRule(runtime)}
- **Show the plan**: the report shows the epics, waves and dependencies as a diagram, not only as text. ${VISUAL_RULE}
- **Stay read-only**: planners stay native read-only agents. Never \`delegate_task\`, \`t3_thread_launch\`, \`create_threads\`, \`t3_thread_send\`, \`t3_worktree_handoff\` or \`schedule_task\` during planning; the next command is given to copy into a fresh thread.`;
}
