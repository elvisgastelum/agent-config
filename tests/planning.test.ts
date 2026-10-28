import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { entryKey, upsertEntry, type CatalogEntry } from "../src/catalog.ts";
import { buildPlan } from "../src/commands.ts";
import { defaultConfig, type Config } from "../src/config.ts";
import { BLOCK_BEGIN, BLOCK_END, applyPlan, uninstall } from "../src/ops.ts";
import { claudeDir, codexDir, opencodeDir, piDir } from "../src/paths.ts";
import { read, sandbox } from "./helpers.ts";
import { WAVE_RULE } from "../src/kaneo.ts";
import { PHASE_PREFIX } from "../src/loop.ts";
import {
  DRAFT_PHASE,
  DRAFT_STATUS,
  PLAN_KINDS,
  PLAN_SCHEMA,
  NOT_AUTHORIZATION_SENTENCE,
  PLANNING_INSTRUCTIONS_BLOCK,
  PLAN_STORE_PATH,
  READ_ONLY_SENTENCE,
  PYTHON_FALLBACK,
  REVIEW_VERDICT,
  STORE_MIGRATION,
  STORE_WRITE_PREFIX,
  plannerBody,
  plannerDescription,
  plannerName,
  planningMarkdown,
  stopLines,
} from "../src/planning.ts";
import { TIERS, type Runtime } from "../src/tiers.ts";

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

/** The schema before tickets.pr_url and ticket_sessions, as stores written by 0.18.0 have it. */
const OLD_SCHEMA = `
CREATE TABLE plan (id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT NOT NULL, kind TEXT NOT NULL, request TEXT NOT NULL, outcome TEXT, status TEXT NOT NULL DEFAULT 'interview', tracker TEXT NOT NULL DEFAULT 'store', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE epics (id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL, done_when TEXT NOT NULL, position INTEGER NOT NULL, tracker_id TEXT);
CREATE TABLE tickets (id TEXT PRIMARY KEY, epic_id TEXT REFERENCES epics(id), kind TEXT NOT NULL DEFAULT 'story', title TEXT NOT NULL, outcome TEXT NOT NULL, done_when TEXT NOT NULL, size TEXT NOT NULL, touches TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', tracker_id TEXT);
CREATE TABLE blocks (blocker TEXT NOT NULL REFERENCES tickets(id), blocked TEXT NOT NULL REFERENCES tickets(id), PRIMARY KEY (blocker, blocked));
`;

/** Runs the migration the way an agent does with sqlite3: check, then add what is missing. */
function migrate(db: DatabaseSync): void {
  const hasPrUrl = db.prepare(STORE_MIGRATION.check).get();
  if (!hasPrUrl) db.exec(`${STORE_WRITE_PREFIX} ${STORE_MIGRATION.addPrUrl}`);
  db.exec(`${STORE_WRITE_PREFIX} ${STORE_MIGRATION.sessions}`);
}

describe("store migration", () => {
  test("old-schema store migrates then accepts write", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(OLD_SCHEMA);
    db.exec(
      "INSERT INTO epics VALUES ('E1', 'Epic', 'goal', 'done', 1, NULL); INSERT INTO tickets (id, epic_id, title, outcome, done_when, size, touches, status) VALUES ('T-1', 'E1', 'One', 'o', 'd', 'P2', 'src', 'in_progress'), ('T-2', 'E1', 'Two', 'o', 'd', 'P1', 'src', 'todo'); INSERT INTO blocks VALUES ('T-1', 'T-2');",
    );
    const before = db.prepare("SELECT * FROM tickets ORDER BY id").all();
    migrate(db);
    const after = db.prepare("SELECT * FROM tickets ORDER BY id").all();
    expect(after).toEqual(before.map((row) => ({ ...row, pr_url: null })));
    expect(db.prepare("SELECT count(*) AS n FROM blocks").get()).toEqual({ n: 1 });
    db.exec(
      `${STORE_WRITE_PREFIX} UPDATE tickets SET pr_url = 'https://example.test/pr/1' WHERE id = 'T-1'; INSERT INTO ticket_sessions (ticket_id, session_id, started_at, last_seen_at) VALUES ('T-1', 's1', datetime('now'), datetime('now'));`,
    );
    expect(db.prepare("SELECT pr_url FROM tickets WHERE id = 'T-1'").get()).toEqual({
      pr_url: "https://example.test/pr/1",
    });
    expect(db.prepare("SELECT ticket_id, session_id, ended_at FROM ticket_sessions").all()).toEqual(
      [{ ticket_id: "T-1", session_id: "s1", ended_at: null }],
    );
  });

  test("migration is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(OLD_SCHEMA);
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(() => migrate(store())).not.toThrow();
  });

  test("new store has pr_url and ticket_sessions", () => {
    const db = store();
    addTicket(db, "A");
    db.exec(`${STORE_WRITE_PREFIX} UPDATE tickets SET pr_url = 'u' WHERE id = 'A';`);
    expect(db.prepare(STORE_MIGRATION.check).get()).toBeTruthy();
    expect(() =>
      db.exec(
        `${STORE_WRITE_PREFIX} INSERT INTO ticket_sessions (ticket_id, session_id, started_at, last_seen_at) VALUES ('GHOST', 's', 'now', 'now');`,
      ),
    ).toThrow();
  });

  test("deleting a ticket deletes its sessions", () => {
    const db = store();
    addTicket(db, "A");
    addTicket(db, "B");
    db.exec(
      `${STORE_WRITE_PREFIX} INSERT INTO ticket_sessions (ticket_id, session_id, started_at, last_seen_at) VALUES ('A', 's1', 'now', 'now'), ('B', 's2', 'now', 'now');`,
    );
    db.exec(`${STORE_WRITE_PREFIX} DELETE FROM tickets WHERE id = 'A';`);
    expect(db.prepare("SELECT ticket_id FROM ticket_sessions").all()).toEqual([{ ticket_id: "B" }]);
  });

  test("the write prefix is two PRAGMAs and never the CLI-only .timeout", () => {
    expect(STORE_WRITE_PREFIX).toBe("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    expect(STORE_WRITE_PREFIX).not.toContain(".timeout");
  });

  test("the waves view still layers a migrated store", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(OLD_SCHEMA);
    migrate(db);
    db.exec(PLAN_SCHEMA);
    addTicket(db, "A");
    addTicket(db, "B");
    block(db, "A", "B");
    expect(waves(db)).toEqual([
      { ticket_id: "A", wave: 1 },
      { ticket_id: "B", wave: 2 },
    ]);
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

  test("explains the busy timeout as waiting for a store another session is writing", () => {
    const text = planningMarkdown("claude", MODELS);
    expect(text).toContain(
      "`busy_timeout` makes a write wait up to 5 seconds while another session is writing the store",
    );
    expect(text).toContain(STORE_MIGRATION.addPrUrl);
    expect(text).toContain(PYTHON_FALLBACK);
    expect(PYTHON_FALLBACK).toContain("never two statements on one line");
    expect(text).not.toContain(".timeout");
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
    expect(planningMarkdown("pi", MODELS)).toContain("`/brief <EPIC-ID>`");
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
      expect(body).toContain(
        "first delete any earlier draft (its ticket_sessions, blocks, tickets and epics)",
      );
    }
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

describe("read-only rule and stop line", () => {
  const RUNTIMES = ["claude", "opencode", "codex", "pi"] as const;
  const report = (rt: (typeof RUNTIMES)[number]): string =>
    planningMarkdown(rt, MODELS).split("## 8. Report")[1]!.split("\n## ")[0]!;
  const forms = (rt: (typeof RUNTIMES)[number]) =>
    rt === "codex"
      ? { b: "$brief", c: "$continue", otherB: "/brief", otherC: "/continue" }
      : { b: "/brief", c: "/continue", otherB: "$brief", otherC: "$continue" };
  const READ_ONLY =
    "This run is read-only: it changes no file outside .plans/ and no tracker item except this plan's own epics and stories.";

  test("skill states the read-only rule", () => {
    expect(READ_ONLY_SENTENCE).toBe(READ_ONLY);
    for (const rt of RUNTIMES) expect(planningMarkdown(rt, MODELS)).toContain(READ_ONLY);
  });

  const variants = [
    ["stop line with brief and continue installed", "both", "`brief` and `continue`"],
    ["stop line with only brief installed", "brief", "only `brief`"],
    ["stop line with only continue installed", "continue", "only `continue`"],
    ["stop line with none installed", "none", "none"],
  ] as const;
  for (const [name, key, cond] of variants) {
    test(name, () => {
      for (const rt of RUNTIMES) {
        const { b, c, otherB, otherC } = forms(rt);
        const expected = {
          both: `Planning done. Start the work in a fresh session: ${b} <EPIC-ID> or ${c}.`,
          brief: `Planning done. Start the work in a fresh session: ${b} <EPIC-ID>.`,
          continue: `Planning done. Start the work in a fresh session: ${c}.`,
          none: "Planning done. Work the tickets by hand from the store in a fresh session.",
        }[key];
        expect(stopLines(rt)[key]).toBe(expected);
        const prefix = key === "none" ? "With none" : `With ${cond}`;
        expect(report(rt)).toContain(
          `- ${prefix} installed: \`${expected}\``.replace("installed installed", "installed"),
        );
        expect(report(rt)).not.toContain(otherB);
        expect(report(rt)).not.toContain(otherC);
      }
    });
  }

  test("report step ends with the stop line rule", () => {
    for (const rt of RUNTIMES) {
      const blocks = report(rt).trim().split("\n\n");
      const last = blocks[blocks.length - 1]!;
      expect(last.startsWith("End the report with exactly the matching stop line")).toBe(true);
      expect(last.split("\n").pop()).toBe(`- With none installed: \`${stopLines(rt).none}\``);
    }
  });

  test("NOT_AUTHORIZATION_SENTENCE text", () => {
    expect(NOT_AUTHORIZATION_SENTENCE).toBe(
      "A planning report is not authorization to implement; its next command belongs to a fresh session.",
    );
    expect(NOT_AUTHORIZATION_SENTENCE).not.toContain("/");
    expect(NOT_AUTHORIZATION_SENTENCE).not.toContain("$");
  });

  test("skill states the tracker exception", () => {
    expect(READ_ONLY_SENTENCE).toContain(
      "no tracker item except this plan's own epics and stories",
    );
    expect(READ_ONLY_SENTENCE).not.toContain("gap");
    expect(READ_ONLY_SENTENCE.endsWith("except this plan's own epics and stories.")).toBe(true);
  });
});

describe("planning instructions block", () => {
  const ALL: Runtime[] = ["claude", "opencode", "codex", "pi"];
  const PLANNING_BEGIN_PREFIX = "<!-- BEGIN agent-config:planning:";
  const PLANNING_END = "<!-- END agent-config:planning -->";
  const NOT_AUTHORIZATION =
    "A planning report is not authorization to implement; its next command belongs to a fresh session.";

  let box: ReturnType<typeof sandbox>;
  let project: string | undefined;
  beforeEach(() => {
    box = sandbox();
  });
  afterEach(() => {
    box.restore();
    if (project) rmSync(project, { recursive: true, force: true });
    project = undefined;
  });

  const userInstructions = (): Record<Runtime, string> => ({
    claude: join(claudeDir(), "CLAUDE.md"),
    opencode: join(opencodeDir(), "AGENTS.md"),
    codex: join(codexDir(), "AGENTS.md"),
    pi: join(piDir(), "AGENTS.md"),
  });

  const planningEntry = (runtimes: Runtime[], dir?: string): CatalogEntry => ({
    item: "planning",
    ...(dir ? { project: dir } : {}),
    runtimes,
    settings: {},
  });

  function installEntry(entry: CatalogEntry): void {
    const config: Config = defaultConfig();
    upsertEntry(config, entry);
    const result = applyPlan(buildPlan(config, [entryKey(entry)]));
    expect(result.errors).toEqual([]);
  }

  function installLadder(): void {
    const config: Config = {
      ...defaultConfig(),
      components: ["instructions"],
      catalog: [{ item: "model-ladder", runtimes: ALL, settings: {} }],
    };
    expect(applyPlan(buildPlan(config)).errors).toEqual([]);
  }

  const ladderBlock = (text: string): string => {
    const start = text.indexOf(BLOCK_BEGIN);
    const end = text.indexOf(BLOCK_END);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end + BLOCK_END.length);
  };

  const count = (text: string, needle: string): number => text.split(needle).length - 1;

  test("planning block is installed in each runtime's instructions file", () => {
    const configs = [
      join(codexDir(), "config.toml"),
      join(piDir(), "config.json"),
      join(piDir(), "settings.json"),
    ];
    const before = configs.map((p) => (existsSync(p) ? read(p) : undefined));
    installEntry(planningEntry(ALL));
    for (const path of Object.values(userInstructions())) {
      const text = read(path);
      const start = text.indexOf(PLANNING_BEGIN_PREFIX);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(text).toContain(PLANNING_INSTRUCTIONS_BLOCK);
      expect(text.indexOf(PLANNING_END)).toBeGreaterThan(start);
    }
    const after = configs.map((p) => (existsSync(p) ? read(p) : undefined));
    expect(after).toEqual(before);
  });

  test("project scope AGENTS.md gets exactly one planning block", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    installEntry(planningEntry(ALL, project));
    const agents = read(join(project, "AGENTS.md"));
    expect(count(agents, PLANNING_BEGIN_PREFIX)).toBe(1);
    expect(count(agents, PLANNING_END)).toBe(1);
    expect(count(agents, PLANNING_INSTRUCTIONS_BLOCK)).toBe(1);
    const claude = read(join(project, "CLAUDE.md"));
    expect(count(claude, PLANNING_BEGIN_PREFIX)).toBe(1);
    expect(count(claude, PLANNING_END)).toBe(1);
  });

  test("block says a planning report does not authorize changes", () => {
    expect(PLANNING_INSTRUCTIONS_BLOCK).toContain(NOT_AUTHORIZATION);
    expect(NOT_AUTHORIZATION_SENTENCE).toBe(NOT_AUTHORIZATION);
  });

  test("block and skill share the same read-only sentence", () => {
    expect(PLANNING_INSTRUCTIONS_BLOCK).toContain(READ_ONLY_SENTENCE);
    for (const rt of ALL) expect(planningMarkdown(rt, MODELS)).toContain(READ_ONLY_SENTENCE);
  });

  test("model-ladder block is byte-identical after planning install", () => {
    installLadder();
    const before = Object.values(userInstructions()).map((p) => ladderBlock(read(p)));
    installEntry(planningEntry(ALL));
    const after = Object.values(userInstructions()).map((p) => ladderBlock(read(p)));
    expect(after).toEqual(before);
  });

  test("uninstall removes the planning block", () => {
    installLadder();
    const before = Object.values(userInstructions()).map((p) => ladderBlock(read(p)));
    installEntry(planningEntry(ALL));
    uninstall((r) => r.item === "planning@user");
    Object.values(userInstructions()).forEach((path, i) => {
      const text = read(path);
      expect(text).not.toContain(PLANNING_BEGIN_PREFIX);
      expect(text).not.toContain(PLANNING_END);
      expect(ladderBlock(text)).toBe(before[i]);
    });
  });
});
