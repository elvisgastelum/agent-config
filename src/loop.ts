// How one ticket is built between its branch and its PR, shared by the brief action and the
// /continue parallel modes: cheap maps and edits, deep plans and risk calls, reviewers routed by
// risk, and a final check by whoever owns the ticket (a deep ladder-orchestrator in parallel).

import { COMMIT_WRITER } from "./commit.ts";
import { SCRIBE } from "./kaneo.ts";
import { PLAN_DB, PLANS_DIR, STORE_WRITE_PREFIX } from "./planning.ts";
import { EPIC_PR_URL_COLUMN } from "./store.ts";
import { ORCHESTRATOR, agentName, type Runtime } from "./tiers.ts";

/** Models the loop names, one per rung. */
export interface LoopModels {
  fast: string;
  balanced: string;
  deep: string;
}

/** The line that opens every delegated handoff, so the guard and the user can check its phase. */
export const PHASE_PREFIX = "Phase:";

export const phase = (name: string): string => `${PHASE_PREFIX} ${name}`;

const agent = (name: string): string => `\`${name}\``;

const DEEP_READER = agentName("read", "deep");
const FAST_EXPLORER = agentName("explore", "fast");
const BALANCED_EXPLORER = agentName("explore", "balanced");
const FAST_RESEARCHER = agentName("research", "fast");
const FAST_EDITOR = agentName("edit", "fast");
const BALANCED_EDITOR = agentName("edit", "balanced");
const DEEP_EDITOR = agentName("edit", "deep");
const BALANCED_REVIEWER = agentName("review", "balanced");
const DEEP_REVIEWER = agentName("review", "deep");

/** The first line of a PR body for a Kaneo ticket, linking its Kaneo page. */
export const KANEO_PR_LINE = "Kaneo: [<IDENTIFIER> — <ticket title>](<ticket URL>)";

/** The first line of a PR body for a store ticket. Built on call: planning.ts imports this file. */
export const storePrLine = (): string =>
  `Plan: <ID> — <title> (${PLANS_DIR}/<MM-yyyy>/<slug>/${PLAN_DB})`;

/** How a ticket's PR body starts, and what its owner records after opening it. */
export function prDelivery(): string {
  return `- For a Kaneo ticket, the PR body starts with \`${KANEO_PR_LINE}\`, and the scribe comments the PR URL on the ticket.
- For a store ticket, the PR body starts with \`${storePrLine()}\` and has no Kaneo link line; \`${PLANS_DIR}\` is untracked, so the path points into the main checkout. After opening the PR, the session or orchestrator that opened it writes the PR URL to \`tickets.pr_url\` and sets \`ended_at\` on its \`ticket_sessions\` row.`;
}

/** The brief's `## Epic` line that names the epic branch, or `none`; /continue reads it too. */
export const EPIC_BRANCH_LINE = "Epic branch:";

/** The epic branch line's value when a brief has no epic branch. */
export const NO_EPIC_BRANCH = "none";

/** How the loop picks the epic branch's base. A brief carries it as text and never resolves it. */
export const EPIC_BASE_RULE = "`dev` when `origin/dev` exists, else the default branch";

/** Placeholders the brief keeps as written in its loop: the run fills them in. */
export const EPIC_BRANCH_PLACEHOLDER = "<epic-branch>";
export const BASE_PLACEHOLDER = "<base>";
export const EPIC_PR_URL_PLACEHOLDER = "<epic-pr-url>";

/** How an epic-branch run resolves the base once: /brief's loop and /continue parallel-wave both follow it. */
export const EPIC_BASE_RESOLVE = `The parent resolves \`${BASE_PLACEHOLDER}\` from the line's base rule once per run (after \`git fetch origin\`: ${EPIC_BASE_RULE}) when it creates the epic branch, or on its first use in a run when the branch already exists, says which base it took, and uses that result for every later step of the run.`;

/** How an epic-branch run creates the epic branch: the same sentence in /brief's loop and in /continue. */
export const EPIC_BRANCH_CREATE = `The parent creates and pushes \`origin/${EPIC_BRANCH_PLACEHOLDER}\` from \`origin/${BASE_PLACEHOLDER}\` once, before the first worktree, when it is missing, and reuses it otherwise.`;

/** What an epic-branch brief overrides in the /continue parallel mode it runs: every default-branch merge and checkout. */
export const EPIC_BRANCH_MERGE_OVERRIDE = `Every step of the run's parallel mode that merges or checks out the default branch uses \`origin/${EPIC_BRANCH_PLACEHOLDER}\` instead: each worktree is added from \`origin/${EPIC_BRANCH_PLACEHOLDER}\`, the merge loop runs \`git merge origin/${EPIC_BRANCH_PLACEHOLDER}\` in each ticket's worktree, and the cleanup runs \`git checkout ${EPIC_BRANCH_PLACEHOLDER} && git pull\`, so the epic branch stays checked out.`;

/** How a scribe comment that gives a Kaneo epic its epic PR URL starts. */
export const EPIC_PR_COMMENT = "Epic PR:";

/** The epic's status while its epic PR waits for the user. */
export const AWAITING_HUMAN_MERGE = "awaiting human merge";

/** Who merges the epic PR, and when. */
export const EPIC_MERGE_RULE = `The agent merges the epic PR only after the user approves it in the chat; until then its status is \`${AWAITING_HUMAN_MERGE}\`. After the approved merge, the Kaneo epic moves to Done and a store epic is reported merged.`;

/**
 * What the loop does when the queue of an epic-branch brief is empty: the deep Done-when review over
 * the whole epic branch, then one epic PR into the base that waits for the user. Built on call:
 * store.ts imports planning.ts, which imports this file.
 */
export function epicClosingStep(reviewer: string): string {
  const epic = EPIC_BRANCH_PLACEHOLDER;
  const base = BASE_PLACEHOLDER;
  return `Merge \`origin/${base}\` into the epic branch as after every wave, then have ${reviewer} check the epic's "Done when" list over \`origin/${base}...origin/${epic}\` (\`${phase("review")}\`); when a criterion is not met, add what is missing to the queue and continue. When it passes, open one PR \`${epic}\` -> \`${base}\` whose body links every ticket, and do not merge it on its own. ${EPIC_MERGE_RULE} A store epic: write the PR URL to \`${EPIC_PR_URL_COLUMN}\`. A Kaneo epic: have the scribe comment \`${EPIC_PR_COMMENT} ${EPIC_PR_URL_PLACEHOLDER}\` on the epic and move it to the project's review column (In Review) when one exists; otherwise it stays In Progress and the report says so. The report gives the epic the status \`${AWAITING_HUMAN_MERGE}\` and leaves deleting the epic branch to the human.`;
}

/** The brief's recommended review routing: the reviewer's rung follows the diff's risk. */
export const ROUTED_REVIEW = `none and low risk: ${agent(BALANCED_REVIEWER)}; medium and high: ${agent(DEEP_REVIEWER)}`;

/**
 * The phases one ticket goes through between its branch and its PR: explore, plan, edit, risk,
 * review, fix and the final check. The brief numbers them inside its loop; /continue parallel
 * modes hand them to every worker, a `ladder-orchestrator`.
 */
export function ticketPhases(branch: string, review: string): string[] {
  const deepRead = agent(DEEP_READER);
  const lead = agent(ORCHESTRATOR);
  return [
    `**Explore** (\`${phase("explore")}\`, ${agent(FAST_EXPLORER)}; ${agent(BALANCED_EXPLORER)} when the map crosses several modules). Map what the ticket touches: entry points, the flow, where each change goes, the tests that cover it. When the ticket needs facts from outside the repository (library docs, API behavior, versions), ask ${agent(FAST_RESEARCHER)} one exact question. Plan from these answers instead of reading the files yourself.`,
    `**Plan** (\`${phase("plan")}\`, deep: a ${lead} plans itself; anyone else hands the map to ${deepRead}). Diagnose every change the ticket needs. Return a task list; each task has a spec, its allowed paths, a reference file, a verify command and its edit rung: fast for pattern work (tests, boilerplate, config, mechanical edits), balanced for new logic. Prefer fast.`,
    `**Edit** (\`${phase("edit")}\`). Run each task on its rung, ${agent(FAST_EDITOR)} or ${agent(BALANCED_EDITOR)}. Climb one rung on a partial or escalate reply or a failed verify; ${agent(DEEP_EDITOR)} only after balanced failed. Run every verify command yourself.`,
    `**Risk** (\`${phase("risk")}\`, deep: a ${lead} classifies itself; anyone else asks ${deepRead}). Classify the diff (\`git diff origin/${branch}...HEAD\`) as none, low, medium or high per area, one reason each: none for docs and comments; low for tests and isolated internals; medium for behavior other code calls; high for auth, permissions, data, money, migrations, concurrency, public contracts and deletions. The ticket takes the highest.`,
    `**Review** (\`${phase("review")}\`): ${review}. Give the reviewer the diff range, the ticket's criteria and the risk notes; it returns findings (path:line, severity, fix, and the fix's edit rung) or none. A review never runs on a fast agent unless the review routing allows it.`,
    `**Fix** (\`${phase("fix")}\`). Hand each finding to an edit agent on its rung and verify it. Go back to Risk when a fix changed what the diff touches, otherwise to Review. Repeat until the review has no findings.`,
    `**Final check**. You are the top-level reviewer: run every verify command and the project's checks, compare \`git diff --stat\` with the ticket's criteria and allowed paths, and read the exact lines any finding or failure pointed at. The reviewer's approval informs this check; it does not replace it.`,
  ];
}

/** Which agent runs each phase, and how workers reach a rung without an agent tool. */
export function modelRouting(runtime: Runtime, models: LoopModels, review: string): string {
  return `| Phase | Agent |
| --- | --- |
| Kaneo reads and writes | ${agent(SCRIBE)} (${models.fast}) |
| Store reads and writes | the session or orchestrator working the ticket, at the absolute store path it was given; every write starts with \`${STORE_WRITE_PREFIX}\` |
| parallel workers, one per ticket | ${agent(ORCHESTRATOR)} (${models.deep}) |
| explore | ${agent(FAST_EXPLORER)} (${models.fast}), ${agent(BALANCED_EXPLORER)} (${models.balanced}) across several modules |
| research | ${agent(FAST_RESEARCHER)} (${models.fast}), climbing when sources disagree |
| design rules from Figma | ${agent(agentName("design", "balanced"))} (${models.balanced}) |
| user flows, edge cases and recovery | ${agent(agentName("ux", "balanced"))} (${models.balanced}), ${agent(agentName("ux", "deep"))} for money, data or auth |
| plan, risk | a ${agent(ORCHESTRATOR)} itself, otherwise ${agent(DEEP_READER)} (${models.deep}) |
| edit, fix | ${agent(FAST_EDITOR)} (${models.fast}) for pattern work, ${agent(BALANCED_EDITOR)} (${models.balanced}) for new logic, ${agent(DEEP_EDITOR)} only after balanced failed |
| review | ${review} |
| final check | the worker or session that owns the ticket |
| commit titles | ${agent(COMMIT_WRITER)} |

A worker that cannot start agents runs each phase on its rung from its worktree with \`agent-config delegate explore|research|design|ux|read|edit|review --runtime ${runtime} --tier <rung> --cwd <worktree> "<handoff>"\`; it climbs by itself on a partial reply (\`--no-climb\` stays on the rung).`;
}
