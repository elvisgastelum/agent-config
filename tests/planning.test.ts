import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";
import { WAVE_RULE } from "../src/kaneo.ts";
import { PHASE_PREFIX } from "../src/loop.ts";
import { PLAN_KINDS, PLAN_SCHEMA, PLAN_STORE_PATH, planningMarkdown } from "../src/planning.ts";

const MODELS = { fast: "fast-model", deep: "deep-model" };

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

  test("rejects a story larger than P5", () => {
    expect(() => addTicket(store(), "BIG", "todo", "P8")).toThrow();
  });
});

describe("planningMarkdown", () => {
  test("keeps reasoning on the deep rung with phase lines and caps the fan-out by kind", () => {
    const text = planningMarkdown("claude", MODELS);
    expect(text).toContain(`${PHASE_PREFIX} plan`);
    expect(text).toContain(`${PHASE_PREFIX} review`);
    expect(text).toContain("`ladder-read-deep` (deep-model)");
    for (const [kind, cap] of Object.entries(PLAN_KINDS)) expect(text).toContain(`${kind} ${cap}`);
    expect(text).toContain(PLAN_STORE_PATH);
    expect(text).toContain(WAVE_RULE);
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
