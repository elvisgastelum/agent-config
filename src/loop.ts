// How one ticket is built between its branch and its PR, shared by the brief action and the
// /continue parallel modes: cheap maps and edits, deep plans and risk calls, reviewers routed by
// risk, and a final check by whoever owns the ticket (a deep ladder-orchestrator in parallel).

import { COMMIT_WRITER } from "./commit.ts";
import { SCRIBE } from "./kaneo.ts";
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
