import { describe, expect, test } from "vite-plus/test";
import {
  KANEO_PR_LINE,
  ROUTED_REVIEW,
  modelRouting,
  prDelivery,
  storePrLine,
} from "../src/loop.ts";
import { STORE_WRITE_PREFIX } from "../src/planning.ts";
import { RUNTIMES } from "../src/tiers.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };

describe("modelRouting", () => {
  test("names the store writer, its absolute path and the write prefix", () => {
    const table = modelRouting("claude", MODELS, ROUTED_REVIEW);
    expect(table).toContain(
      `| Store reads and writes | the session or orchestrator working the ticket, at the absolute store path it was given; every write starts with \`${STORE_WRITE_PREFIX}\` |`,
    );
    expect(STORE_WRITE_PREFIX).toBe("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    expect(table).not.toContain(".timeout");
  });

  test("keeps the Kaneo row", () => {
    expect(modelRouting("claude", MODELS, ROUTED_REVIEW)).toContain(
      "| Kaneo reads and writes | `kaneo-scribe` (fast-model) |",
    );
  });

  test("every runtime has the store row", () => {
    for (const runtime of RUNTIMES)
      expect(modelRouting(runtime, MODELS, ROUTED_REVIEW)).toContain("| Store reads and writes |");
  });
});

describe("prDelivery", () => {
  const text = prDelivery();

  test("starts a store PR with the Plan: line and no Kaneo link line", () => {
    expect(storePrLine()).toBe("Plan: <ID> — <title> (.plans/<MM-yyyy>/<slug>/plan.sqlite)");
    const store = text.split("\n").find((line) => line.includes("store ticket"))!;
    expect(store).toContain(`starts with \`${storePrLine()}\``);
    expect(store).toContain("and has no Kaneo link line");
    expect(store).not.toContain("Kaneo: [");
  });

  test("records the PR URL and ends the session as the store writer", () => {
    expect(text).toContain(
      "the session or orchestrator that opened it writes the PR URL to `tickets.pr_url` and sets `ended_at` on its `ticket_sessions` row",
    );
  });

  test("keeps the Kaneo link line in Kaneo mode", () => {
    expect(KANEO_PR_LINE).toBe("Kaneo: [<IDENTIFIER> — <ticket title>](<ticket URL>)");
    const kaneo = text.split("\n").find((line) => line.includes("Kaneo ticket"))!;
    expect(kaneo).toContain(`starts with \`${KANEO_PR_LINE}\``);
  });
});
