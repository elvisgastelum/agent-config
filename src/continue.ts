// The continue catalog item's text: a manual-only action that picks up the next Kaneo ticket, or
// several independent ones in parallel worktrees, and hands reads, edits, ticket writes and commit
// titles to cheap agents. Moved here from elvisgastelum/claude-continue-skill.

import { COMMIT_SKILL, COMMIT_WRITER } from "./commit.ts";
import { KANEO_SKILL, SCRIBE } from "./kaneo.ts";
import type { Runtime } from "./tiers.ts";

export const CONTINUE = "continue";

/** How each runtime's skill text tells the model to start a named sub-agent. */
export const CALL: Record<Runtime, (agent: string) => string> = {
  claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
  opencode: (agent) => `the task tool with the \`${agent}\` agent`,
  codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
  pi: (agent) => `the subagent tool with the \`${agent}\` agent`,
};

/** How the user runs a manual action: a slash command, or Codex's explicit `$skill` mention. */
export function actionCommand(runtime: Runtime, name: string): string {
  return runtime === "codex" ? `$${name}` : `/${name}`;
}

export function continueCommand(runtime: Runtime): string {
  return actionCommand(runtime, CONTINUE);
}

const DESCRIPTION =
  "Continue the next Kaneo ticket, move it to in progress, then commit and open the merge request. With `parallel [n]`, work up to n independent tickets in separate worktrees and merge them one by one.";

export const ARGUMENT_HINT = "[parallel [n]]";

/** Models the action names: the fast rung for cheap agents, the balanced rung for workers. */
export interface ContinueModels {
  fast: string;
  balanced: string;
}

/** Frontmatter for the file each runtime reads; every one keeps the action manual-only. */
export function actionFrontmatter(
  runtime: Runtime,
  name: string,
  summary: string,
  argumentHint: string,
): string {
  const description = JSON.stringify(
    `${summary} Manual action only, run with ${actionCommand(runtime, name)}.`,
  );
  const hint = `argument-hint: ${JSON.stringify(argumentHint)}`;
  switch (runtime) {
    case "claude":
      return `---\nname: ${name}\ndescription: ${description}\n${hint}\ndisable-model-invocation: true\n---`;
    case "codex":
      // Implicit invocation is turned off in agents/openai.yaml beside this file.
      return `---\nname: ${name}\ndescription: ${description}\n---`;
    case "opencode":
      return `---\ndescription: ${description}\n---`;
    case "pi":
      return `---\ndescription: ${description}\n${hint}\n---`;
  }
}

/** Codex: an explicit `$continue` still works; Codex never picks the skill on its own. */
export const CODEX_POLICY = `policy:\n  allow_implicit_invocation: false\n`;

export function continueMarkdown(runtime: Runtime, models: ContinueModels): string {
  const cmd = continueCommand(runtime);
  const args =
    runtime === "codex"
      ? `Arguments passed to this run: the user's message after \`${cmd}\` (none means no arguments).`
      : "Arguments passed to this run: `$ARGUMENTS` (empty means no arguments).";
  const scribe = CALL[runtime](SCRIBE);
  return `${actionFrontmatter(runtime, CONTINUE, DESCRIPTION, ARGUMENT_HINT)}

## Arguments

${args} Read them before doing anything else. Only their first line picks the mode; every line after it is this run's brief:

| Invocation | Mode | Ticket limit |
| --- | --- | --- |
| \`${cmd}\` | Single | 1 (the single-ticket flow below) |
| \`${cmd} parallel\` | Parallel | 4 |
| \`${cmd} parallel <n>\` | Parallel | \`<n>\` (a positive integer, e.g. \`${cmd} parallel 10\`) |

If the first line holds anything other than \`parallel\`, optionally followed by a positive integer, stop and say the argument is invalid. With an empty first line, run only the single-ticket flow and ignore the parallel mode section.

A brief (such as the one the kick-off action copies) scopes the run: take tickets only from its queue, in its order, and follow its steps wherever they differ from the flows below. Keep working through its queue until it says to stop.

## Save context: cheap agents do the reading and the clerical work

This session keeps the decisions (which ticket, the design, conflict resolution, whether checks really pass). Everything bulky goes to an agent on a cheaper model, so its output never fills this session:

- **Kaneo**: read the board and every ticket write (status moves, comments) through ${scribe} (${models.fast}). Ask it for a short summary, never raw Kaneo JSON.
- **Reads and edits**: follow the \`model-ladder\` skill. Large or many files, logs, CI and test output go to ${CALL[runtime]("ladder-read-fast")}; boilerplate, tests and mechanical edits to ${CALL[runtime]("ladder-edit-fast")} (${CALL[runtime]("ladder-edit-balanced")} for new logic). Climb a rung only when a reply is partial or fails verification.
- **Commit titles**: the \`${COMMIT_SKILL}\` skill hands the staged diff to ${CALL[runtime](COMMIT_WRITER)}, which replies with one title.
- **Parallel workers** run on the balanced rung (${models.balanced}), not this session's model, whenever the sub-agent tool lets you choose a model.

When one of these agents is not installed, do the step yourself with bounded reads (line ranges, \`--stat\`, \`tail\`).

## Single-ticket flow

Continue the next Kaneo ticket's work, move it to in progress, then commit and create the merge request:

1. Load the \`${KANEO_SKILL}\` skill. Ask ${scribe} for the open tickets of the current project (To Do / Backlog) in priority order with their blocking relations, and pick the first one that is not blocked by an unfinished ticket.
2. Have the scribe move it to In Progress.
3. \`git fetch origin\` and create the branch \`<IDENTIFIER>/<short-kebab-description>\` (e.g. \`FEX-2/some-feature-getting-done\`) from the up-to-date default branch.
4. Implement the ticket with tests and docs alongside the change, delegating reads and edits as above.
5. Run the project's checks and leave them passing; read long output through the ladder read agent.
6. Commit with the \`${COMMIT_SKILL}\` skill, push the branch and open the PR (body starts with the Kaneo ticket link, no AI attribution).
7. Have the scribe comment the PR URL on the ticket.
8. Report the ticket, branch, PR URL and the checks run with their results.

## Parallel mode

Goal: take up to N Kaneo tickets that can be worked at the same time, build each in its own worktree until it is ready to merge, then merge them one by one, bringing each next branch up to date with the latest default branch before it merges.

### 1. Pick tickets that can run in parallel

1. Load the \`${KANEO_SKILL}\` skill.
2. Ask ${scribe} for the open tickets of the current project (To Do / Backlog) in priority order, each with its relations.
3. Drop any ticket that is blocked by an unfinished ticket, or that depends on another candidate.
4. Drop tickets that would clearly change the same files or the same feature area as a ticket already picked; conflicts are allowed but should be rare.
5. Pick up to N tickets. If fewer qualify, take what qualifies and say why the rest were skipped. If only one qualifies, run the single-ticket flow.
6. Show the picked tickets (identifier, title) and the planned merge order before creating anything.

### 2. Create one worktree per ticket

For each picked ticket:

1. \`git fetch origin\` and use the up-to-date default branch as the base.
2. Branch name: \`<IDENTIFIER>/<short-kebab-description>\` (e.g. \`FEX-2/some-feature-getting-done\`).
3. Worktree path: \`<repo-parent>/<repo-name>-worktrees/<IDENTIFIER>-<short-kebab-description>\`. Never under \`/tmp\`.
4. \`git worktree add -b <branch> <path> origin/<default-branch>\`
5. Have the scribe move the ticket to In Progress.

### 3. Build every ticket until it is ready to merge

Launch one sub-agent per worktree, all at once so they run concurrently, each on the balanced rung (${models.balanced}). Each sub-agent:

- works only inside its own worktree path, and never touches another worktree or the main checkout;
- implements its ticket, with tests and docs alongside the change;
- keeps its own context small: bounded reads (line ranges, \`--stat\`, \`tail\`), and the ladder, scribe and commit-writer agents when it can delegate;
- runs the project's checks and leaves them passing;
- commits with the \`${COMMIT_SKILL}\` skill, pushes its branch, and opens the PR (body starts with the Kaneo ticket link, no AI attribution);
- comments the PR URL on its Kaneo ticket;
- reports back in at most ten lines: ticket, branch, worktree path, PR URL, checks run and their results, or why it is blocked.

Wait for all of them. A ticket that comes back blocked or with failing checks is left out of the merge loop and listed in the final report.

### 4. Merge loop, one PR at a time

Merge the ready PRs in the planned order. For each PR:

1. \`git fetch origin\`.
2. In that ticket's worktree, merge the latest default branch into its branch: \`git merge origin/<default-branch>\`.
3. If there are conflicts, resolve them locally (load the \`resolving-merge-conflicts\` skill when it is available), keeping the intent of both sides.
4. Re-run the project's checks. Do not continue if they fail; fix them first.
5. Commit the merge if needed and push the branch.
6. Wait for the PR's CI checks to pass; read failing logs through the ladder read agent.
7. Merge the PR.
8. Have the scribe move the Kaneo ticket to Done.
9. Go to the next PR. Its step 2 now picks up the PR that was just merged.

Stop the loop and report when a conflict cannot be resolved with confidence, checks keep failing after a fix attempt, or a PR cannot be merged (review required, branch protection). Leave the remaining PRs open and untouched.

### 5. Clean up and report

1. After a PR is merged, remove its worktree: \`git worktree remove <path>\`. Keep the worktree of any ticket that was not merged.
2. Update the main checkout: \`git checkout <default-branch> && git pull\`.
3. Report a table: ticket, PR URL, status (merged / open / blocked), and what is left for anything not merged.
`;
}
