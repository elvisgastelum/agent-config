import { describe, expect, test } from "vite-plus/test";
import { PARALLEL_WAVE, continueMarkdown } from "../src/continue.ts";
import { WAVE_RULE } from "../src/kaneo.ts";
import { kickOffMarkdown } from "../src/kickoff.ts";
import { ROUTED_REVIEW, ticketPhases } from "../src/loop.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };
const BRIEF_DIR = "~/state/kick-off";
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
    expect(text).toContain(`argument-hint: "[parallel [n] | ${PARALLEL_WAVE}]"`);
  });

  test("builds the wave with the kick-off phases, routing and brief", () => {
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

describe("kickOffMarkdown", () => {
  test("numbers the shared ticket phases inside the brief's loop", () => {
    const text = kickOffMarkdown("claude", MODELS, BRIEF_DIR);
    ticketPhases("<branch>", "<review routing>").forEach((step, i) =>
      expect(text).toContain(`${i + 2}. ${step}`),
    );
  });
});
