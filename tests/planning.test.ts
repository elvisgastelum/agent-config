import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";
import { WAVE_RULE } from "../src/kaneo.ts";
import { PHASE_PREFIX } from "../src/loop.ts";
import {
  DRAFT_PHASE,
  DRAFT_STATUS,
  PLAN_KINDS,
  PLAN_SCHEMA,
  PLAN_STORE_PATH,
  PLAN_TOOLS,
  REVIEW_VERDICT,
  STORE_WRITE_PREFIX,
  plannerBody,
  plannerDescription,
  plannerName,
  planningMarkdown,
} from "../src/planning.ts";
import { TIERS } from "../src/tiers.ts";

const MODELS = { fast: "fast-model", balanced: "balanced-model", deep: "deep-model" };

function store(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(PLAN_SCHEMA);
  return db;
}

function addTicket(db: DatabaseSync, id: string, status = "todo", size = "P3"): void {
  db.prepare(
    "INSERT INTO tickets (id, title, outcome, done_when, size, touches, status) VALUES (?, ?, 'outcome', 'criteria', ?, 'area', ?)",
  ).run(id, id, size, status);
}

function block(db: DatabaseSync, blocker: string, blocked: string): void {
  db.prepare("INSERT INTO blocks (blocker, blocked) VALUES (?, ?)").run(blocker, blocked);
}

function waves(db: DatabaseSync): { ticket_id: string; wave: number }[] {
  return db
    .prepare("SELECT ticket_id, wave FROM waves ORDER BY wave, ticket_id")
    .all()
    .map((row) => ({ ticket_id: String(row.ticket_id), wave: Number(row.wave) }));
}

describe("PLAN_SCHEMA", () => {
  test("runs again on an existing store", () => {
    const db = store();
    expect(() => db.exec(PLAN_SCHEMA)).not.toThrow();
  });

  test("replaces the waves view of a store from an older schema", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIEW waves AS SELECT 'stale' AS ticket_id, 0 AS wave");
    db.exec(PLAN_SCHEMA);
    addTicket(db, "T1");
    expect(waves(db)).toEqual([{ ticket_id: "T1", wave: 1 }]);
  });

  test("layers open tickets into waves by their unfinished blockers", () => {
    const db = store();
    addTicket(db, "A", "done");
    for (const id of ["B", "C", "D", "E"]) addTicket(db, id);
    block(db, "A", "C");
    block(db, "B", "C");
    block(db, "C", "D");
    expect(waves(db)).toEqual([
      { ticket_id: "B", wave: 1 },
      { ticket_id: "E", wave: 1 },
      { ticket_id: "C", wave: 2 },
      { ticket_id: "D", wave: 3 },
    ]);
  });

  test("leaves tickets in a dependency cycle out of the waves", () => {
    const db = store();
    addTicket(db, "X");
    addTicket(db, "Y");
    block(db, "X", "Y");
    block(db, "Y", "X");
    expect(waves(db)).toEqual([]);
  });

  test("leaves tickets behind a cycle out even when an open ticket also leads to them", () => {
    const db = store();
    for (const id of ["A", "C", "Y", "D", "E"]) addTicket(db, id);
    block(db, "A", "C");
    block(db, "C", "Y");
    block(db, "Y", "C");
    block(db, "C", "D");
    expect(waves(db)).toEqual([
      { ticket_id: "A", wave: 1 },
      { ticket_id: "E", wave: 1 },
    ]);
  });

  test("refuses a blocker that names no ticket when a write starts with the prefix", () => {
    const db = store();
    addTicket(db, "A");
    // A new sqlite3 call starts with the checks off, as every connection does.
    db.exec("PRAGMA foreign_keys = OFF;");
    expect(() =>
      db.exec("INSERT INTO blocks (blocker, blocked) VALUES ('UNCHECKED', 'A');"),
    ).not.toThrow();
    expect(() =>
      db.exec(`${STORE_WRITE_PREFIX} INSERT INTO blocks (blocker, blocked) VALUES ('GHOST', 'A');`),
    ).toThrow();
  });

  test("rejects a story larger than P5", () => {
    expect(() => addTicket(store(), "BIG", "todo", "P8")).toThrow();
  });
});

describe("planningMarkdown", () => {
  test("names every planner with its model, reviews on planner-deep and caps the fan-out", () => {
    const text = planningMarkdown("claude", MODELS);
    expect(text).toContain(`${PHASE_PREFIX} plan`);
    expect(text).toContain(`${PHASE_PREFIX} ${DRAFT_PHASE}`);
    expect(text).toContain(`${PHASE_PREFIX} review`);
    for (const tier of TIERS) expect(text).toContain(`\`${plannerName(tier)}\` (${MODELS[tier]})`);
    expect(text).toContain("Classification, gap reviews and every review run on `planner-deep`");
    for (const [kind, { fanOut }] of Object.entries(PLAN_KINDS))
      expect(text).toContain(`${kind} ${fanOut}`);
    expect(text).toContain(PLAN_STORE_PATH);
    expect(text).toContain(`\`${STORE_WRITE_PREFIX}\``);
  });

  test("prefers the plans MCP tools and names how to add the server", () => {
    const text = planningMarkdown("claude", MODELS);
    expect(text).toContain("agent-config configure plans-mcp");
    for (const tool of [PLAN_TOOLS.draft_replace, PLAN_TOOLS.plan_create, PLAN_TOOLS.ticket_save])
      expect(text).toContain(tool);
  });

  test("starts each kind's draft on its planner and climbs one rung on a failed review", () => {
    const section = planningMarkdown("claude", MODELS).split("## 5. ")[1]!.split("\n## ")[0]!;
    for (const [kind, { start }] of Object.entries(PLAN_KINDS))
      expect(section).toContain(`${kind} \`${plannerName(start)}\``);
    expect(section).toContain(`on \`${REVIEW_VERDICT.revise}\` or \`${DRAFT_STATUS.escalate}\``);
    expect(section).toContain("every finding earlier reviews of a draft raised");
    expect(section).toContain(
      "When the deep planner's draft still fails its review, stop climbing",
    );
  });

  test("asks with the question tool on Claude and in a numbered message elsewhere", () => {
    expect(planningMarkdown("claude", MODELS)).toContain("AskUserQuestion");
    expect(planningMarkdown("opencode", MODELS)).not.toContain("AskUserQuestion");
  });

  test("names the next commands in each runtime's form", () => {
    expect(planningMarkdown("codex", MODELS)).toContain("`$continue parallel-wave`");
    expect(planningMarkdown("pi", MODELS)).toContain("`/kick-off <EPIC-ID>`");
  });
});

describe("planner agents", () => {
  test("share the draft rules and differ only in their rung note", () => {
    const [fast, balanced, deep] = TIERS.map(plannerBody);
    for (const body of [fast!, balanced!, deep!]) {
      expect(body).toContain(WAVE_RULE);
      expect(body).toContain(`\`${STORE_WRITE_PREFIX}\``);
      expect(body).toContain(`\`${PHASE_PREFIX} ${DRAFT_PHASE}\``);
      expect(body).toContain(REVIEW_VERDICT.revise);
    }
    for (const body of [fast!, balanced!, deep!]) expect(body).toContain(PLAN_TOOLS.draft_replace);
    expect(fast).toContain(`reply \`${DRAFT_STATUS.escalate}\` early`);
    expect(deep).toContain("the last rung");
    expect(new Set([fast, balanced, deep]).size).toBe(3);
  });

  test("describe their model and when each rung runs", () => {
    expect(plannerDescription("fast", "haiku")).toContain("(haiku)");
    expect(plannerDescription("fast", "")).toContain("(session model)");
    expect(plannerDescription("deep", "opus")).toContain("reviews every plan");
  });
});
