import { describe, expect, test } from "vite-plus/test";
import { briefMarkdown } from "../src/brief.ts";
import { prDelivery } from "../src/loop.ts";
import { STORE_WRITE_PREFIX } from "../src/planning.ts";
import { START_SESSION, setStatus, storeAccess } from "../src/store.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };
const STORE_SECTION = "## Plan store fallback";

const text = briefMarkdown("claude", MODELS, "~/state/briefs");
const section = text.split(STORE_SECTION)[1]!.split("\n## ")[0]!;
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
