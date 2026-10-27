import { describe, expect, test } from "vite-plus/test";
import { PARALLEL_WAVE, continueMarkdown } from "../src/continue.ts";
import { WAVE_RULE } from "../src/kaneo.ts";
import { briefMarkdown } from "../src/brief.ts";
import { ROUTED_REVIEW, prDelivery, ticketPhases } from "../src/loop.ts";
import { STORE_WRITE_PREFIX } from "../src/planning.ts";
import { storeAccess } from "../src/store.ts";

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
    expect(text).toContain(`argument-hint: "[parallel [n] | ${PARALLEL_WAVE}]"`);
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
