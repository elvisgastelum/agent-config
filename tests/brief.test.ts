import { describe, expect, test } from "vite-plus/test";
import { EPIC_BRANCH_LINE, briefMarkdown } from "../src/brief.ts";
import { EPIC_BASE_RULE, EPIC_PR_COMMENT, epicClosingStep, prDelivery } from "../src/loop.ts";
import { STORE_WRITE_PREFIX } from "../src/planning.ts";
import { START_SESSION, setStatus, storeAccess } from "../src/store.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };
/** A git command that reads or changes branches; the shared store discovery's `git worktree list` is not one. */
const BRANCH_GIT_COMMAND =
  /`git (?:fetch|merge|branch|checkout|switch|push|pull|ls-remote|rev-parse|remote)\b/;
const STORE_SECTION = "## Plan store fallback";

const text = briefMarkdown("claude", MODELS, "~/state/briefs");
const section = text.split(STORE_SECTION)[1]!.split("\n## ")[0]!;
const steps = text.split("## Brief template")[0]!;
const q3 = text.split("\n").find((line) => line.startsWith("3. **Integration branch**"))!;
const template = text.split("````markdown\n")[1]!.split("\n````")[0]!;

describe("briefMarkdown store mode", () => {
  test("resolves Kaneo first, then a store, through the shared module", () => {
    expect(text).toContain("or an ID from a plan store");
    expect(section).toContain(storeAccess('the Agent tool with `subagent_type: "kaneo-scribe"`'));
  });

  test("treats a store ticket with no epic as its own root", () => {
    expect(section).toContain(
      "A ticket whose `epic_id` is NULL is its own root: the brief's `## Epic` section describes the ticket itself.",
    );
  });

  test("inserts missing stories into the same store under the shared prefix", () => {
    expect(section).toContain(
      "insert them into the same store's `tickets` and `blocks`, every write starting with",
    );
    expect(section).toContain(`\`${STORE_WRITE_PREFIX}\``);
    expect(section).toContain(
      "IDs continue the plan's prefix (after `BCS-9` comes `BCS-10`); each has a non-empty `touches`, its outcome, `done_when` from the diagnosis findings, and a size",
    );
    expect(section).toContain(
      "`SELECT * FROM waves ORDER BY wave` must then list every open ticket: one missing sits in a dependency cycle, so fix its blocks",
    );
    expect(section).not.toContain(".timeout");
  });

  test("sets the ticket in progress at pick and leaves it there", () => {
    expect(template).toContain(`\`${setStatus("in_progress")}\``);
    expect(template).toContain(`\`${START_SESSION}\``);
    expect(template).toContain(
      "A store ticket stays in_progress after the merge; a later `/continue` marks it done",
    );
  });

  test("delivers store tickets through the shared PR rules", () => {
    expect(template).toContain(prDelivery().replace(/^/gm, "   "));
  });

  test("keeps the Kaneo brief flow", () => {
    expect(text).toContain("Load the `kaneo-work-tracking` skill. Have the scribe resolve");
    expect(template).toContain("Merge, have the scribe move the ticket to Done");
  });
});

describe("epic branch", () => {
  test("offers the epic branch first, then dev, the default branch and another", () => {
    const epic = q3.indexOf("the epic branch `<EPIC-ID>/<kebab-epic-title>`");
    const dev = q3.indexOf("/ `dev` /");
    const def = q3.indexOf("the repository's default branch");
    const other = q3.indexOf("another branch");
    expect(epic).toBeGreaterThanOrEqual(0);
    expect(dev).toBeGreaterThan(epic);
    expect(def).toBeGreaterThan(dev);
    expect(other).toBeGreaterThan(def);
    expect(q3).toContain("(recommended;");
    expect(q3).toContain("without its `Epic: ` prefix");
    expect(q3).toContain("a store epic with no Kaneo ID uses its store ID");
  });

  test("drops the epic branch option for a single ticket", () => {
    expect(text).toContain(
      "one ticket in total (no parent epic, or an epic with exactly one ticket)",
    );
    expect(q3).toContain(
      "then the options are `dev` / the repository's default branch / another branch",
    );
  });

  test("writes the epic branch line in the template", () => {
    const lines = template.split("\n");
    expect(lines).toContain(`- ${EPIC_BRANCH_LINE} <epic-branch> off ${EPIC_BASE_RULE}`);
    expect(lines).toContain(
      "- Epic branch: <epic-branch> off `dev` when `origin/dev` exists, else the default branch",
    );
    expect(lines).toContain("- Epic branch: none");
  });

  test("runs no git command in /brief's own steps", () => {
    expect(steps).not.toMatch(BRANCH_GIT_COMMAND);
    expect(template).toMatch(BRANCH_GIT_COMMAND);
    expect(steps).toContain("the new session resolves it, so this step runs no git command");
  });

  test("resolves the base once and keeps the epic branch current", () => {
    expect(template).toContain(
      "The parent resolves `<base>` from that rule once (after `git fetch origin`: `dev` when `origin/dev` exists, else the default branch) when it creates the epic branch, or on its first use in a run when the branch already exists, says which base it took, and uses that result for every later step of the run.",
    );
    expect(template).toContain(
      "The parent creates and pushes `origin/<epic-branch>` from `origin/<base>` once, before the first worktree, when it is missing, and reuses it otherwise.",
    );
    expect(template).toContain(
      "`<branch>` is the epic branch: Pick branches from it, Deliver opens the PR into it and Risk diffs against it.",
    );
    expect(template).toContain(
      "After every wave and before the epic PR, the parent merges the base into the epic branch with a plain `git merge origin/<base>` (no rebase, no force-push)",
    );
    expect(template).toContain("a conflict it cannot resolve with confidence hits the stop rule");
    expect(template).toContain("A ticket is Done when its PR merged into the epic branch.");
    expect(template).toContain(
      "The loop moves the epic to Done only after merging the epic PR the user approved in the chat (or seeing it MERGED), never before.",
    );
    expect(template).not.toMatch(/git rebase|--force/);
  });

  test("closes the epic with one PR the human merges", () => {
    expect(template).toContain(
      `When the queue is empty and the brief has an epic branch: ${epicClosingStep("`ladder-reviewer-deep`")}`,
    );
    expect(template).toContain("(In Review)");
    expect(template).toContain(`${EPIC_PR_COMMENT} <epic-pr-url>`);
    expect(text).toContain(
      "Elsewhere `<epic-branch>`, `<base>` and `<epic-pr-url>` stay as written: the new session fills them in.",
    );
    expect(template).toContain("`awaiting human merge`");
  });

  test("exempts the epic PR from the cannot-merge stop rule", () => {
    expect(template).toContain('The epic PR is exempt from the "a PR cannot merge" rule');
  });

  test("keeps the integration branch rules", () => {
    expect(template).toContain(
      "- Integration branch: `<branch>`. Every ticket branch starts from `origin/<branch>` and every PR merges into it.",
    );
    expect(template).toContain("from `origin/<branch>`");
    expect(template).toContain("open the PR into `<branch>`");
    expect(template).toContain("Move the epic to Done only when every criterion is met");
    expect(template).toContain("When the queue is empty and the `Epic branch:` line is `none`");
  });
});
