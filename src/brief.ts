// The brief catalog item's text: a manual-only action that diagnoses what a Kaneo epic is missing
// on the deep rung, asks how to run it, and copies a brief that starts with /continue, so a fresh
// session works the whole epic: cheap maps and edits, deep plans and risk calls, reviewers routed by
// risk, and a deep ladder-orchestrator per parallel ticket.

import { COMMIT_SKILL, COMMIT_WRITER } from "./commit.ts";
import { CONTINUE, actionCommand, actionFrontmatter } from "./continue.ts";
import { KANEO_SKILL, SCRIBE } from "./kaneo.ts";
import {
  PHASE_PREFIX,
  ROUTED_REVIEW,
  modelRouting,
  phase,
  prDelivery,
  ticketPhases,
  type LoopModels,
} from "./loop.ts";
import { STORE_WRITE_PREFIX } from "./planning.ts";
import { START_SESSION, STORE_HEADING, setStatus, storeAccess } from "./store.ts";
import { T3_DELEGATE_TOOL, T3_THREAD_START_TOOLS, claudeT3Tool, exactToolMatcher } from "./t3.ts";
import { ORCHESTRATOR, agentName, type Runtime } from "./tiers.ts";

export const BRIEF = "brief";
export const BRIEF_GUARD_FILE = "brief-guard.mjs";

const DESCRIPTION =
  "Prepare a /continue brief for a Kaneo epic, ticket or bug, or an epic or ticket ID from a .plans store: diagnose what it is missing, ask how to run it, and copy the brief to the clipboard, so a fresh session works the whole epic.";

export const BRIEF_HINT = "<kaneo-epic-or-ticket-url | ticket-code | .plans store ID>";

const CALL: Record<Runtime, (agent: string) => string> = {
  claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
  opencode: (agent) => `the task tool with the \`${agent}\` agent`,
  codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
  pi: (agent) => `the subagent tool with the \`${agent}\` agent`,
};

/** Models the action names, one per rung. */
export type BriefModels = LoopModels;

export { PHASE_PREFIX };

/** The line a user adds under the phase line to let a review run on the fast rung. */
export const FAST_REVIEW_APPROVAL = "Fast review: approved by the user";

/** The Claude tools the brief guard hook checks: agent handoffs (T3 delegate_task, t3_thread_launch and create_threads too), clipboard copies, brief writes. */
export const BRIEF_GUARD_MATCHER = exactToolMatcher([
  "Agent",
  "Task",
  "Bash",
  "Write",
  claudeT3Tool(T3_DELEGATE_TOOL),
  ...T3_THREAD_START_TOOLS.map(claudeT3Tool),
]);

/** Claude's tool for asking the user a question with options. */
const CLAUDE_QUESTION_TOOL = "AskUserQuestion";

const DEEP_READER = agentName("read", "deep");
const FAST_READER = agentName("read", "fast");
const FAST_REVIEWER = agentName("review", "fast");
const BALANCED_REVIEWER = agentName("review", "balanced");
const DEEP_REVIEWER = agentName("review", "deep");

const agent = (name: string): string => `\`${name}\``;

/** Nests lines under a numbered step of the brief's loop. */
const indent = (text: string): string => text.replace(/^/gm, "   ");

/** The brief's placeholders, filled in by the brief run that writes it. */
const BRANCH_PLACEHOLDER = "<branch>";
const REVIEW_PLACEHOLDER = "<review routing>";

export function briefMarkdown(runtime: Runtime, models: BriefModels, briefDir: string): string {
  const cmd = actionCommand(runtime, BRIEF);
  const cont = actionCommand(runtime, CONTINUE);
  const args =
    runtime === "codex"
      ? `Argument: the user's message after \`${cmd}\`.`
      : "Argument: `$ARGUMENTS`.";
  const ask =
    runtime === "claude"
      ? `with the ${CLAUDE_QUESTION_TOOL} tool`
      : "in one message with numbered options";
  const guard =
    runtime === "claude"
      ? " The brief guard hook denies a `diagnose`, `plan` or `risk` handoff off the deep rung, a review on fast without the user's approval, an incomplete brief, and a clipboard copy of a brief that is missing, incomplete or not in a command of its own."
      : "";
  const deepRead = agent(DEEP_READER);
  const fastRead = agent(FAST_READER);
  const deepReview = agent(DEEP_REVIEWER);
  const routed = ROUTED_REVIEW;
  const steps = ticketPhases(BRANCH_PLACEHOLDER, REVIEW_PLACEHOLDER);
  const phases = steps.map((step, i) => `${i + 2}. ${step}`).join("\n");
  // Pick is step 1, the phases follow, then Deliver and Next.
  const deliver = steps.length + 2;
  return `${actionFrontmatter(runtime, BRIEF, DESCRIPTION, BRIEF_HINT)}

## Arguments

${args} It names one Kaneo epic or ticket: a URL (\`…/task/<id>\`) or an identifier such as \`FEX-12\`, or an ID from a plan store (see "${STORE_HEADING}"). When it is empty, ask for it and wait.

## Save context

This session decides; everything bulky runs on an agent and comes back as a short summary. Agents run through ${CALL[runtime]("<name>")}.

- **Kaneo**: every read and write goes through ${agent(SCRIBE)} (${models.fast}). Ask for summaries, never raw Kaneo JSON.
- **Reasoning**: the diagnosis runs on ${deepRead} (${models.deep}). Every handoff starts with its phase line, \`${phase("<phase>")}\`.${guard}
- **The brief's loop** runs the same way: explorers map, researchers look things up, edit agents write, reviewers on the rung the risk calls for check, and each parallel ticket is led by ${agent(ORCHESTRATOR)} (${models.deep}).
- Anything else you read follows the \`model-ladder\` skill.

When one of these agents is not installed, do the step yourself with bounded reads.

## 1. What is missing to complete the epic

1. Load the \`${KANEO_SKILL}\` skill. Have the scribe resolve the argument to its epic: the ticket itself when it is the epic, otherwise the epic it belongs to (its parent, epic or \`related\` relation; with none, the ticket is the root). In the same request, ask for one summary of the epic (identifier, title, URL, description, acceptance criteria) and of every ticket related to it (subtasks, related, blocking, blocked by), each with identifier, title, status, priority, size label, relations, its criteria in one line and any PR link in its comments.
2. Hand that summary to ${deepRead}:

   \`\`\`
   ${phase("diagnose")}
   Epic: <identifier> <title>, <url>
   Tickets: <the scribe's summary>
   Scope: this repository
   Question: what is missing to complete this epic?
   Answer shape: done tickets; open tickets in dependency order with what blocks each; work the epic's criteria need that no ticket covers (proposed tickets: title, one-line scope, size, dependencies); gaps (vague or missing criteria, tickets without criteria, dependency cycles, stale blockers, code that contradicts a done ticket); waves of open tickets that can run in parallel (no dependency between them, different areas of the code), each ticket with the context a fresh session needs and the paths it touches.
   Budget: <= 700 words
   \`\`\`

3. Show the user the overview: progress (done / open / missing), blockers, missing tickets, gaps, and the proposed order and waves.

## ${STORE_HEADING}

${storeAccess(CALL[runtime](SCRIBE))}

When the argument resolves to a store, steps 1 and 2 read and write the store instead of Kaneo:

- **Resolve.** A store ticket's epic is the \`epics\` row its \`epic_id\` names. A ticket whose \`epic_id\` is NULL is its own root: the brief's \`## Epic\` section describes the ticket itself. Summarize the epic and its tickets for the diagnosis with small selects (\`id, title, status, size, touches, done_when\` and their \`blocks\`), never a dump.
- **Missing tickets.** When the user chose to create them, insert them into the same store's \`tickets\` and \`blocks\`, every write starting with ${"`"}${STORE_WRITE_PREFIX}${"`"}. IDs continue the plan's prefix (after \`BCS-9\` comes \`BCS-10\`); each has a non-empty \`touches\`, its outcome, \`done_when\` from the diagnosis findings, and a size. \`SELECT * FROM waves ORDER BY wave\` must then list every open ticket: one missing sits in a dependency cycle, so fix its blocks.
- **The brief** names the absolute store path in its \`## Epic\` section, so the new session works the same store.

## 2. Ask how to run it

Ask these four ${ask}, recommending the first option of each, and wait for the answers:

1. **Missing tickets**: create them in Kaneo now / list them in the brief for the new session to create first / leave them out.
2. **Parallelism**: parallel waves of up to N tickets (\`${cont} parallel N\`, N = the widest wave) / one ticket at a time (\`${cont}\`). Recommend one at a time when no wave has two tickets.
3. **Integration branch**: \`dev\` / the repository's default branch / another branch. Every ticket branch starts from it and every PR merges into it.
4. **Reviews**: routed by risk (${routed}) / always ${deepReview} / fast allowed for none risk.

When the user chose to create the missing tickets, have the scribe create them, sized, labelled and related as the \`${KANEO_SKILL}\` skill says, and put their identifiers in the queue.

The brief's review routing, from answer 4:

- Routed by risk: "${routed}."
- Always deep: "${deepReview} for every risk."
- Fast allowed for none risk: "none: ${agent(FAST_REVIEWER)}, with the line \`${FAST_REVIEW_APPROVAL}\` under the phase line; low: ${agent(BALANCED_REVIEWER)}; medium and high: ${deepReview}."

## 3. Write the brief and copy it

1. Write the brief to \`${briefDir}/<EPIC-ID>.md\` (create the folder) from the template below. Replace every \`<…>\` and keep the rest as written: the loop, routing and stop sections are what the new session runs on.
2. Then copy it to the clipboard with a command of its own (nothing else in it), using the first tool that exists: \`pbcopy < <file>\` (macOS), \`wl-copy < <file>\`, \`xclip -selection clipboard < <file>\`, \`xsel --clipboard --input < <file>\` or \`clip.exe < <file>\`. When none exists, say so and give the path.
3. Report the path, whether the brief is on the clipboard, one line per wave, and: open a fresh session in this repository and paste it.

## Brief template

The first line is the command alone: \`${cont}\` for one ticket at a time, \`${cont} parallel <N>\` for waves.

\`\`\`\`markdown
${cont} parallel <N>

# Brief: <EPIC-ID> <epic title>

## Epic

- Ticket: [<EPIC-ID> <title>](<url>) (a store ticket: \`<EPIC-ID> <title>\` in \`<absolute store path>\`)
- Goal: <one sentence>
- Done when: <each acceptance criterion of the epic, one per line>
- State: <done>/<total> tickets done, <open> open, <created> created by the brief run.
- Integration branch: \`<branch>\`. Every ticket branch starts from \`origin/<branch>\` and every PR merges into it.

## Queue

Work only these tickets, in this order. Tickets in one wave do not depend on each other and may run in parallel; a wave starts once the previous one merged.

### Wave 1

- \`<ID>\` <title>: <why now and the context the ticket needs, one or two lines>. Depends on: <IDs or none>. Done when: <criteria>. Touches: <areas or paths>.

## Gaps

- <gap>: <what to do: create the ticket first, ask the user, or note it in the PR>.

## Loop per ticket

Agents run through ${CALL[runtime]("<name>")}. Every delegated handoff starts with its phase line, such as \`${phase("plan")}\`, so the run can be checked. In parallel waves each ticket goes to one ${agent(ORCHESTRATOR)} worker in its own worktree, which runs steps 2 to ${deliver} there and hands every read and write to the ladder.

1. **Pick.** Have ${agent(SCRIBE)} re-read the ticket and its blockers. Still blocked: skip it, say why and take the next. Otherwise move it to In Progress and branch \`<ID>/<short-kebab-description>\` from \`origin/<branch>\`.
   A store ticket: re-read it and its blockers from the store at the absolute path in \`## Epic\`, then run \`${setStatus("in_progress")}\` and \`${START_SESSION}\` with this session's id.
${phases}
${deliver}. **Deliver.** Run the project's checks and leave them passing. Commit with the \`${COMMIT_SKILL}\` skill (titles from ${agent(COMMIT_WRITER)}), push, and open the PR into \`<branch>\`: its body starts with the Kaneo ticket link and has no AI attribution. Have the scribe comment the PR URL on the ticket. Wait for CI; read failures through ${fastRead} and fix them through Plan, Edit and Review. Merge, have the scribe move the ticket to Done, then delete the branch and its worktree.
   A store ticket follows these PR rules instead of the Kaneo link and the scribe's comment. A store ticket stays in_progress after the merge; a later \`${cont}\` marks it done:
${indent(prDelivery())}
${deliver + 1}. **Next.** Back to Pick. After each wave, have the scribe re-read the epic: tickets added since go to the end of the queue in dependency order.

## Model routing

${modelRouting(runtime, models, REVIEW_PLACEHOLDER)}

## Stop and report

Stop and ask the user when a ticket stays blocked, the review still has findings after 3 rounds, CI fails twice after fixes, a merge conflict cannot be resolved with confidence, a PR cannot merge (required review, branch protection), or the epic's criteria are ambiguous.

When the queue is empty, have ${deepReview} check the epic's "Done when" list against the merged code (\`${phase("review")}\`). Move the epic to Done only when every criterion is met; otherwise add what is missing to the queue and continue. Report a table: ticket, PR, risk, review rounds, status (merged / open / blocked), and what is left.
\`\`\`\`
`;
}
