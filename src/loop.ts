// How one ticket is built between its branch and its PR, shared by the kick-off brief and the
// /continue parallel-wave mode: deep plans and risk calls, cheap edits, risk-routed reviews.

import { COMMIT_WRITER } from "./commit.ts";
import { SCRIBE } from "./kaneo.ts";
import { agentName, type Runtime } from "./tiers.ts";

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
const BALANCED_READER = agentName("read", "balanced");
const FAST_EDITOR = agentName("edit", "fast");
const BALANCED_EDITOR = agentName("edit", "balanced");
const DEEP_EDITOR = agentName("edit", "deep");

/** Kick-off's recommended review routing: the rung follows the diff's risk. */
export const ROUTED_REVIEW = `none and low risk: ${agent(BALANCED_READER)}; medium and high: ${agent(DEEP_READER)}`;

/**
 * The phases one ticket goes through between its branch and its PR: plan, edit, risk, review and
 * fix. The kick-off brief numbers them inside its loop; /continue parallel-wave hands them to
 * every worker.
 */
export function ticketPhases(branch: string, review: string): string[] {
  const deepRead = agent(DEEP_READER);
  return [
    `**Plan** (\`${phase("plan")}\`, ${deepRead}). Diagnose every change the ticket needs. Return a task list; each task has a spec, its allowed paths, a reference file, a verify command and its edit rung: fast for pattern work (tests, boilerplate, config, mechanical edits), balanced for new logic. Prefer fast.`,
    `**Edit** (\`${phase("edit")}\`). Run each task on its rung, ${agent(FAST_EDITOR)} or ${agent(BALANCED_EDITOR)}. Climb one rung on a partial or escalate reply or a failed verify; ${agent(DEEP_EDITOR)} only after balanced failed. Run every verify command yourself.`,
    `**Risk** (\`${phase("risk")}\`, ${deepRead}). Classify the diff (\`git diff origin/${branch}...HEAD\`) as none, low, medium or high per area, one reason each: none for docs and comments; low for tests and isolated internals; medium for behavior other code calls; high for auth, permissions, data, money, migrations, concurrency, public contracts and deletions. The ticket takes the highest.`,
    `**Review** (\`${phase("review")}\`): ${review}. Give the reviewer the diff, the ticket's criteria and the risk notes; it returns findings (path:line, severity, fix, and the fix's edit rung) or none. A review never runs on a fast agent unless the review routing allows it.`,
    `**Fix** (\`${phase("fix")}\`). Hand each finding to an edit agent on its rung and verify it. Go back to Risk when a fix changed what the diff touches, otherwise to Review. Repeat until the review has no findings.`,
  ];
}

/** Which agent runs each phase, and how parallel workers reach a rung without an agent tool. */
export function modelRouting(runtime: Runtime, models: LoopModels, review: string): string {
  return `| Phase | Agent |
| --- | --- |
| Kaneo reads and writes | ${agent(SCRIBE)} (${models.fast}) |
| plan, risk | ${agent(DEEP_READER)} (${models.deep}) |
| edit, fix | ${agent(FAST_EDITOR)} (${models.fast}) for pattern work, ${agent(BALANCED_EDITOR)} (${models.balanced}) for new logic, ${agent(DEEP_EDITOR)} only after balanced failed |
| review | ${review} |
| commit titles | ${agent(COMMIT_WRITER)} |

Parallel workers cannot start agents: they run each phase on its rung with \`agent-config delegate read|edit --runtime ${runtime} --tier <rung> --no-climb "<handoff>"\`.`;
}
