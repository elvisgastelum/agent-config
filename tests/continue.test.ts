import { describe, expect, test } from "vite-plus/test";
import {
  GH_STATE,
  PARALLEL_WAVE,
  continueMarkdown,
  epicPrQuery,
  kaneoEpicCloseStep,
} from "../src/continue.ts";
import { WAVE_RULE } from "../src/kaneo.ts";
import { briefMarkdown } from "../src/brief.ts";
import {
  AWAITING_HUMAN_MERGE,
  EPIC_BASE_RESOLVE,
  EPIC_BASE_RULE,
  EPIC_BRANCH_CREATE,
  EPIC_BRANCH_LINE,
  EPIC_BRANCH_MERGE_OVERRIDE,
  EPIC_MERGE_RULE,
  EPIC_PR_COMMENT,
  NO_EPIC_BRANCH,
  epicClosingStep,
  ROUTED_REVIEW,
  prDelivery,
  ticketPhases,
} from "../src/loop.ts";
import { STORE_WRITE_PREFIX } from "../src/planning.ts";
import {
  EPIC_MERGED_AT_COLUMN,
  EPIC_PR_URL_COLUMN,
  setEpicMerged,
  storeAccess,
} from "../src/store.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };
const BRIEF_DIR = "~/state/briefs";
const WAVE_SECTION = "## Parallel-wave mode";

function waveSection(text: string): string {
  return text.split(WAVE_SECTION)[1]!;
}

describe("continueMarkdown", () => {
  test("accepts parallel-wave as a mode and keeps every other argument invalid", () => {
    const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
    expect(text).toContain(
      `| \`/continue ${PARALLEL_WAVE}\` | Parallel wave | The size of the epic's next wave |`,
    );
    expect(text).toContain(`or \`${PARALLEL_WAVE}\`, stop and say the argument is invalid`);
    expect(text).toContain(`argument-hint: "[<ID> | parallel [n] | ${PARALLEL_WAVE}]"`);
  });

  test("builds the wave with the brief phases, routing and brief", () => {
    const section = waveSection(continueMarkdown("claude", MODELS, BRIEF_DIR));
    expect(section).toContain(WAVE_RULE);
    expect(section).toContain(ROUTED_REVIEW);
    expect(section).toContain(`\`${BRIEF_DIR}/<EPIC-ID>.md\``);
    for (const step of ticketPhases("<integration branch>", "the review routing above"))
      expect(section).toContain(step);
    expect(section).toContain("`ladder-read-deep` (deep-model)");
    expect(section).toContain("--runtime claude --tier <rung>");
  });

  test("asks which epic only when several can start, and falls back to the recommendation", () => {
    const section = waveSection(continueMarkdown("claude", MODELS, BRIEF_DIR));
    expect(section).toContain("Several can start in any order: ask the user which one");
    expect(section).toContain("or the run cannot ask, take the recommendation and say so");
  });

  test("names the rerun in each runtime's form", () => {
    expect(waveSection(continueMarkdown("codex", MODELS, BRIEF_DIR))).toContain(
      `\`$continue ${PARALLEL_WAVE}\` builds it`,
    );
    expect(waveSection(continueMarkdown("pi", MODELS, BRIEF_DIR))).toContain(
      `\`/continue ${PARALLEL_WAVE}\` builds it`,
    );
  });
});

const STORE_SECTION = "## Plan store fallback";

function storeSection(text: string): string {
  return text.split(STORE_SECTION)[1]!.split("\n## ")[0]!;
}

describe("continueMarkdown store mode", () => {
  const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
  const section = storeSection(text);

  test("accepts a ticket ID and takes the store wording from the shared module", () => {
    expect(text).toContain("| `/continue <ID>` | Single, that ticket | 1 |");
    expect(section).toContain(storeAccess('the Agent tool with `subagent_type: "kaneo-scribe"`'));
  });

  test("picks todo tickets from the waves view and sets them in progress", () => {
    expect(section).toContain(
      "SELECT w.wave, t.id, t.title FROM waves w JOIN tickets t ON t.id = w.ticket_id WHERE t.status = 'todo' ORDER BY w.wave, t.id",
    );
    expect(section).toContain(
      `\`${STORE_WRITE_PREFIX} UPDATE tickets SET status = 'in_progress' WHERE id = '<ID>';\``,
    );
  });

  test("lists in-progress tickets with their non-ended sessions and lets the user decide", () => {
    expect(section).toContain(
      "SELECT t.id, t.title, s.session_id, s.last_seen_at FROM tickets t LEFT JOIN ticket_sessions s ON s.ticket_id = t.id AND s.ended_at IS NULL WHERE t.status = 'in_progress' ORDER BY t.id",
    );
    expect(section).toContain("No timer decides it: the user decides whether to take one over");
  });

  test("appends a session row when taking a ticket, and keeps the earlier rows", () => {
    expect(section).toContain(
      "INSERT INTO ticket_sessions (ticket_id, session_id, started_at, last_seen_at) VALUES ('<ID>', '<session id>', datetime('now'), datetime('now'));",
    );
    expect(section).toContain("Taking over an in_progress ticket appends a new row");
    expect(section).toContain("updates `last_seen_at` on each of its store writes");
    expect(section).toContain("sets `ended_at` when the PR is opened, it stops or it fails");
    expect(section).toContain("Ended sessions never count as active");
  });

  test("marks merged PRs done at pick, or prints the manual update without gh", () => {
    expect(section).toContain(
      "each in_progress ticket with a `pr_url`: run `gh pr view <pr_url> --json state`; when its state is `MERGED`",
    );
    expect(section).toContain(
      `\`${STORE_WRITE_PREFIX} UPDATE tickets SET status = 'done' WHERE id = '<ID>';\``,
    );
    expect(section).toContain("Without `gh`, print that UPDATE line for the user to run");
  });

  test("leaves the ticket in progress after a single run and delivers through the PR rules", () => {
    expect(section).toContain("A single run leaves the ticket in_progress");
    expect(section).toContain(prDelivery());
    expect(section).not.toContain(".timeout");
  });

  test("keeps the Kaneo single-ticket flow", () => {
    expect(text).toContain("Have the scribe move it to In Progress.");
    expect(text).toContain("Have the scribe comment the PR URL on the ticket.");
  });
});

describe("continueMarkdown parallel modes on a store", () => {
  const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
  const parallel = text.split("### Parallel modes on a store")[1]!.split("\n## ")[0]!;

  test("the parent passes the main checkout's absolute store path to every orchestrator", () => {
    expect(parallel).toContain(
      "The parent resolves the main checkout's store to its absolute path and passes that path to every orchestrator",
    );
  });

  test("each orchestrator writes the store itself and owns its session row", () => {
    expect(parallel).toContain(
      `writes that path directly, every write starting with \`${STORE_WRITE_PREFIX}\``,
    );
    expect(parallel).toContain("inserts its own `ticket_sessions` row when it starts");
    expect(parallel).toContain("updates its `last_seen_at` on each of its writes");
    expect(parallel).toContain(
      "writes the PR URL to `tickets.pr_url` after opening the PR, and sets its `ended_at` when the PR is opened, it stops or it fails",
    );
    expect(parallel).toContain("The parent never writes `pr_url` or `ended_at`");
  });

  test("takes the next wave of todo tickets from the waves view and the epic by its id", () => {
    expect(parallel).toContain("`SELECT * FROM waves ORDER BY wave`");
    expect(parallel).toContain("keeping only tickets whose status is `todo`");
    expect(parallel).toContain("picks a store epic by `epics.id`");
    expect(parallel).toContain("Two tickets whose `touches` overlap never share a wave");
  });

  test("the parent sets the ticket done after merge in both parallel modes", () => {
    expect(parallel).toContain(
      `In both parallel modes, after a PR merges, the parent runs \`${STORE_WRITE_PREFIX} UPDATE tickets SET status = 'done' WHERE id = '<ID>';\``,
    );
    expect(parallel).not.toContain(".timeout");
  });

  test("keeps the Kaneo parallel flow", () => {
    expect(text).toContain("Have the scribe move the Kaneo ticket to Done.");
    expect(text).toContain("comments the PR URL on its Kaneo ticket;");
  });
});

describe("continueMarkdown parallel-wave on an epic branch", () => {
  const section = waveSection(continueMarkdown("claude", MODELS, BRIEF_DIR));

  test("reads the brief's epic branch line and makes it the wave branch", () => {
    expect(section).toContain(
      `- When the brief has a \`${EPIC_BRANCH_LINE}\` line that is not \`${NO_EPIC_BRANCH}\`, the integration branch (\`<integration branch>\` above) is the epic branch it names, \`<epic-branch>\`, and \`<base>\` is read from the line the same way /brief's loop reads it:`,
    );
  });

  test("resolves the base once per run with the shared rule", () => {
    expect(section).toContain(`  - ${EPIC_BASE_RESOLVE}`);
    expect(section).toContain(EPIC_BASE_RULE);
  });

  test("creates the epic branch before the first worktree and uses it in every parallel step", () => {
    expect(section).toContain(`  - ${EPIC_BRANCH_CREATE}`);
    expect(section).toContain(
      "  - In place of `origin/<default-branch>`: parallel mode step 2.1 takes `origin/<epic-branch>` as the base, step 2.4 runs `git worktree add -b <branch> <path> origin/<epic-branch>`, and merge loop step 4.2 runs `git merge origin/<epic-branch>`.",
    );
    expect(section).toContain(
      "  - A wave of one story runs the single-ticket flow with its branch cut from `origin/<epic-branch>` instead of the default branch and its PR opened into `<epic-branch>`.",
    );
    expect(section).toContain(
      "  - Cleanup step 5.2 runs `git checkout <epic-branch> && git pull`, so the epic branch stays checked out.",
    );
  });

  test("merges the base into the epic branch after the wave", () => {
    expect(section).toContain(
      "  - After the wave's cleanup, in the main checkout on `<epic-branch>`, the parent merges the base with a plain `git merge origin/<base>` (no rebase, no force-push) and pushes it; a conflict it cannot resolve with confidence stops the run and is reported, as the merge loop's stop rule says.",
    );
  });

  test("never moves the epic to Done on an epic branch, and keeps the rule without one", () => {
    expect(section).toContain(
      "and have the scribe move the epic to Done only when every criterion is met.",
    );
    expect(section).toContain(
      `With an epic branch (a \`${EPIC_BRANCH_LINE}\` line that is not \`${NO_EPIC_BRANCH}\`), no wave moves the epic to Done, the last one included: the epic still has to merge its epic branch into the base.`,
    );
  });

  test("keeps the single and parallel mode steps and the no-brief fallback", () => {
    const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
    for (const line of [
      "3. `git fetch origin` and create the branch `<IDENTIFIER>/<short-kebab-description>` (e.g. `FEX-2/some-feature-getting-done`) from the up-to-date default branch.",
      "1. `git fetch origin` and use the up-to-date default branch as the base.",
      "4. `git worktree add -b <branch> <path> origin/<default-branch>`",
      "2. In that ticket's worktree, merge the latest default branch into its branch: `git merge origin/<default-branch>`.",
      "Without one, the integration branch is `dev` when `origin/dev` exists and the default branch otherwise",
    ])
      expect(text).toContain(line);
  });
});

describe("continueMarkdown without a brief", () => {
  test("keeps parallel mode on the default branch without a brief", () => {
    const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
    for (const line of [
      "1. `git fetch origin` and use the up-to-date default branch as the base.",
      "4. `git worktree add -b <branch> <path> origin/<default-branch>`",
      "2. In that ticket's worktree, merge the latest default branch into its branch: `git merge origin/<default-branch>`.",
      "2. Update the main checkout: `git checkout <default-branch> && git pull`.",
    ]) {
      expect(text).toContain(line);
    }
    expect(text).not.toContain(EPIC_BRANCH_MERGE_OVERRIDE);
  });
});

describe("ticketPhases", () => {
  test("explores before planning, routes reviews to reviewers and ends with the owner's check", () => {
    const steps = ticketPhases("dev", ROUTED_REVIEW);
    expect(steps[0]).toContain("`Phase: explore`, `ladder-explorer-fast`");
    expect(steps[0]).toContain("`ladder-researcher-fast`");
    expect(steps.find((s) => s.includes("Phase: review"))).toContain(
      "medium and high: `ladder-reviewer-deep`",
    );
    expect(steps.at(-1)).toContain("You are the top-level reviewer");
  });
});

describe("briefMarkdown", () => {
  test("numbers the shared ticket phases inside the brief's loop", () => {
    const text = briefMarkdown("claude", MODELS, BRIEF_DIR);
    const steps = ticketPhases("<branch>", "<review routing>");
    steps.forEach((step, i) => expect(text).toContain(`${i + 2}. ${step}`));
    expect(text).toContain(`${steps.length + 2}. **Deliver.**`);
    expect(text).toContain(`${steps.length + 3}. **Next.**`);
    expect(text).toContain(
      `each ticket goes to one \`ladder-orchestrator\` worker in its own worktree, which runs steps 2 to ${steps.length + 2}`,
    );
  });

  test("offers reviewer agents in every review routing", () => {
    const text = briefMarkdown("claude", MODELS, BRIEF_DIR);
    expect(text).toContain('Always deep: "`ladder-reviewer-deep` for every risk."');
    expect(text).toContain("none: `ladder-reviewer-fast`, with the line");
    expect(text).toContain(
      "| parallel workers, one per ticket | `ladder-orchestrator` (deep-model) |",
    );
  });
});

const SCRIBE_CALL = 'the Agent tool with `subagent_type: "kaneo-scribe"`';
const KANEO_PICK = "for the project's open epics";

describe("continueMarkdown closes an epic-branch epic", () => {
  const text = continueMarkdown("claude", MODELS, BRIEF_DIR);
  const closeStep = kaneoEpicCloseStep(SCRIBE_CALL);

  test("runs the shared closing step after the last wave of an epic-branch brief", () => {
    const section = waveSection(text);
    const closing = epicClosingStep("`ladder-reviewer-deep` (deep-model)");
    expect(section).toContain(closing);
    expect(section.indexOf(closing)).toBeGreaterThan(section.indexOf("**What is next**"));
    expect(closing).toContain(EPIC_MERGE_RULE);
    expect(section).toContain(
      `${closing} In this mode, the missing work is added to the epic as open stories (through the scribe on Kaneo, as todo tickets with that \`epic_id\` in a store) and the run stops; the next \`/continue ${PARALLEL_WAVE}\` builds them.`,
    );
  });

  test("checks store epic PRs in store flow step 3 and reports them merged or awaiting", () => {
    const section = storeSection(text);
    const step3 = section.split("3. **Close merged tickets.**")[1]!.split("\n4. ")[0]!;
    expect(epicPrQuery()).toBe(
      `SELECT id, ${EPIC_PR_URL_COLUMN} FROM epics WHERE ${EPIC_PR_URL_COLUMN} IS NOT NULL AND ${EPIC_MERGED_AT_COLUMN} IS NULL`,
    );
    expect(step3).toContain(`run \`${epicPrQuery()}\``);
    expect(step3).toContain(`for each epic with a PR URL, run \`${GH_STATE}\` on that URL`);
    expect(step3).toContain(
      "when its state is `MERGED`, report the epic `merged`, whatever the status of its tickets",
    );
    expect(step3).toContain(`and run \`${setEpicMerged()}\` so no later run lists it again`);
    expect(step3).toContain(`otherwise report it \`${AWAITING_HUMAN_MERGE}\``);
    expect(step3).toContain("Without `gh`, print that command for the user to run instead.");
    expect(step3).toContain(
      "An epic without a PR URL, or one already marked merged, is not reported.",
    );
    expect(step3).toContain(EPIC_MERGE_RULE);
    expect(text.split("epics WHERE").length - 1).toBe(1);
  });

  test("keeps the existing ticket close step", () => {
    expect(storeSection(text)).toContain(
      "3. **Close merged tickets.** Run `SELECT id, pr_url FROM tickets WHERE status = 'in_progress' AND pr_url IS NOT NULL`, then for each in_progress ticket with a `pr_url`: run `gh pr view <pr_url> --json state`; when its state is `MERGED`, run `",
    );
  });

  test("the Kaneo epic close step reads the epic PR comment, checks it and moves merged epics to Done", () => {
    expect(closeStep).toContain(`\`${EPIC_PR_COMMENT} <url>\``);
    expect(closeStep).toContain(`run \`${GH_STATE}\` on its URL`);
    expect(closeStep).toContain(
      "when its state is `MERGED`, have the scribe move the epic to Done",
    );
    expect(closeStep).toContain(
      `otherwise it stays in its column with the status \`${AWAITING_HUMAN_MERGE}\``,
    );
    expect(closeStep).toContain("Without `gh`, print that command for the user to run");
    expect(closeStep).toContain(
      "When the user approves an epic PR in the chat, merge it, then have the scribe move the epic to Done.",
    );
    expect(closeStep).toContain(EPIC_MERGE_RULE);
    expect(closeStep).toContain("An epic without that comment is left as it is.");
    expect(closeStep).toContain("or In Progress when the project has no review column");
    expect(closeStep).toContain("Run it once per run: skip it when this run already did.");
  });

  test("renders the Kaneo epic close step before the single-ticket pick", () => {
    const flow = text.split("## Single-ticket flow")[1]!.split("\n## ")[0]!;
    const pick = flow.indexOf("(To Do / Backlog) in priority order with their blocking relations");
    expect(flow.indexOf(closeStep)).toBeGreaterThan(-1);
    expect(flow.indexOf(closeStep)).toBeLessThan(pick);
  });

  test("renders the Kaneo epic close step before parallel-wave step 1.1", () => {
    const pickEpic = waveSection(text).split("### 1. Pick the epic")[1]!.split("### 2.")[0]!;
    expect(pickEpic.indexOf(closeStep)).toBeGreaterThan(-1);
    expect(pickEpic.indexOf(closeStep)).toBeLessThan(pickEpic.indexOf("1. Load the"));
    expect(pickEpic.indexOf(closeStep)).toBeLessThan(pickEpic.indexOf(KANEO_PICK));
  });

  test("renders the Kaneo epic close step before plain parallel mode step 1.1", () => {
    const parallel = text.split("\n## Parallel mode\n")[1]!.split("### 2.")[0]!;
    expect(parallel.indexOf(closeStep)).toBeGreaterThan(-1);
    expect(parallel.indexOf(closeStep)).toBeLessThan(parallel.indexOf("1. Load the"));
  });
});
