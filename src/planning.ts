// The planning catalog item's text: a manual-only action that turns a request into a complete,
// parallel-ready ticket plan. It interviews the user in rounds, finds gaps and red flags with its
// own planner agents (one per rung, drafts climbing like the model ladder), keeps the plan in a
// SQLite store under .plans, and writes Kaneo epics and stories when the kaneo item is installed
// and its MCP answers.

import { CALL, CONTINUE, PARALLEL_WAVE, actionCommand, actionFrontmatter } from "./continue.ts";
import {
  EPIC_TITLE_PREFIX,
  KANEO_ITEM,
  KANEO_SKILL,
  SCRIBE,
  TOUCHES_LINE,
  WAVE_RULE,
} from "./kaneo.ts";
import { KICK_OFF } from "./kickoff.ts";
import { phase } from "./loop.ts";
import { LADDER_ITEM } from "./ops.ts";
import { agentName, type Runtime, type Tier } from "./tiers.ts";

export const PLANNING = "planning";

const DESCRIPTION =
  "Plan a project, epic, feature, fix or ticket with you: ask only the questions that matter, each with a recommended answer, find gaps and red flags, then write ready-to-run tickets (Kaneo epics in parallel waves when installed).";

/** The plan kinds: how many sub-agents may run at once, and the planner rung a draft starts on. */
export const PLAN_KINDS = {
  fix: { fanOut: 1, start: "fast" },
  ticket: { fanOut: 1, start: "fast" },
  feat: { fanOut: 2, start: "balanced" },
  epic: { fanOut: 3, start: "balanced" },
  project: { fanOut: 5, start: "deep" },
} as const satisfies Record<string, { fanOut: number; start: Tier }>;
export type PlanKind = keyof typeof PLAN_KINDS;
const KIND_NAMES = Object.keys(PLAN_KINDS) as PlanKind[];

export const PLANNING_HINT = `[${KIND_NAMES.join(" | ")}] <what to plan>`;

/** The plan store: one folder per month and per plan, in the repository root. */
export const PLANS_DIR = ".plans";
export const PLAN_DB = "plan.sqlite";
export const PLAN_STORE_PATH = `${PLANS_DIR}/<MM-yyyy>/<plan-title>/${PLAN_DB}`;

/** A gap still open when the user asks to write the tickets becomes a ticket with this title. */
export const GAP_TITLE_PREFIX = "Gap: ";
export const GAP_LABEL = "gap";
const GAP_LABEL_COLOR = "#EC4899";

/** Story sizes on the kaneo-work-tracking point scale: anything larger is split first. */
const GAP_SIZE = "P1";
const MAX_STORY_SIZE = "P5";
const STORY_SIZES = [GAP_SIZE, "P2", "P3", MAX_STORY_SIZE] as const;

/**
 * The plan store's schema. Every statement is idempotent, so running it on an existing store is
 * safe. The `waves` view layers open tickets by their unfinished blockers and leaves out every
 * ticket in a dependency cycle or behind one (`stuck`), since none of them can start. It is dropped
 * and created again, so a store from an older schema gets the current view. It selects only
 * grouped or aggregated columns: DuckDB (harlequin's default adapter) cannot bind a bare column,
 * and its SQLite fallback prepares a rewritten query that SQLite cannot parse.
 */
/** SQLite checks `REFERENCES` only on a connection that asks, so every write starts with this. */
export const STORE_WRITE_PREFIX = "PRAGMA foreign_keys = ON;";

export const PLAN_SCHEMA = `${STORE_WRITE_PREFIX}
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (${KIND_NAMES.map((k) => `'${k}'`).join(", ")})),
  request TEXT NOT NULL,
  outcome TEXT,
  status TEXT NOT NULL DEFAULT 'interview' CHECK (status IN ('interview', 'review', 'written')),
  tracker TEXT NOT NULL DEFAULT 'store' CHECK (tracker IN ('store', 'kaneo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  fact TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  why TEXT,
  decided_by TEXT NOT NULL CHECK (decided_by IN ('user', 'recommendation'))
);
CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  done_when TEXT NOT NULL,
  position INTEGER NOT NULL,
  tracker_id TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  epic_id TEXT REFERENCES epics(id),
  kind TEXT NOT NULL DEFAULT 'story' CHECK (kind IN ('story', 'gap')),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  done_when TEXT NOT NULL,
  size TEXT NOT NULL CHECK (size IN (${STORY_SIZES.map((s) => `'${s}'`).join(", ")})),
  touches TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  tracker_id TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker TEXT NOT NULL REFERENCES tickets(id),
  blocked TEXT NOT NULL REFERENCES tickets(id),
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gap', 'red_flag', 'smell', 'risk')),
  lens TEXT NOT NULL,
  detail TEXT NOT NULL,
  why TEXT NOT NULL,
  recommendation TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'ticketed')),
  resolution TEXT,
  ticket_id TEXT REFERENCES tickets(id)
);
DROP VIEW IF EXISTS waves;
CREATE VIEW waves AS
WITH RECURSIVE
open_blocks(blocker, blocked) AS (
  SELECT b.blocker, b.blocked FROM blocks b
  JOIN tickets p ON p.id = b.blocker
  JOIN tickets t ON t.id = b.blocked
  WHERE p.status <> 'done' AND t.status <> 'done'
),
reach(src, dst) AS (
  SELECT blocker, blocked FROM open_blocks
  UNION
  SELECT reach.src, o.blocked FROM reach JOIN open_blocks o ON o.blocker = reach.dst
),
stuck(id) AS (
  SELECT DISTINCT r.dst FROM reach r JOIN reach c ON c.src = r.src AND c.dst = c.src
),
layer(ticket_id, wave) AS (
  SELECT t.id, 1 FROM tickets t
  WHERE t.status <> 'done'
    AND NOT EXISTS (SELECT 1 FROM open_blocks o WHERE o.blocked = t.id)
  UNION
  SELECT o.blocked, layer.wave + 1 FROM layer
  JOIN open_blocks o ON o.blocker = layer.ticket_id
  WHERE o.blocked NOT IN (SELECT id FROM stuck)
)
SELECT t.epic_id, layer.ticket_id, MAX(layer.wave) AS wave
FROM layer JOIN tickets t ON t.id = layer.ticket_id
GROUP BY layer.ticket_id, t.epic_id;`;

/** What the gap reviewers look at; a capped fan-out gives one reviewer several lenses. */
const LENSES: [name: string, focus: string][] = [
  [
    "scope",
    "the outcome, who it is for, what is in and out, criteria a test or a person can check",
  ],
  [
    "design",
    "architecture, data model, the layer each change belongs to, coupling, code smells in the code it touches, migrations",
  ],
  ["risk", "security, permissions, privacy, data loss, money, concurrency, public contracts"],
  [
    "delivery",
    "tests, CI, rollout and feature flags, rollback, observability, ticket sizes, dependency cycles",
  ],
  ["experience", "UI, the design system, accessibility, motion, performance as users feel it"],
];

/** Claude's tool for asking the user a question with options. */
const CLAUDE_QUESTION_TOOL = "AskUserQuestion";
/** The most questions one round asks, which is also what one AskUserQuestion call holds. */
const ROUND_SIZE = 4;

const FAST_READER = agentName("read", "fast");

/** Models the action names, one per rung. */
export interface PlanningModels {
  fast: string;
  balanced: string;
  deep: string;
}

/** The planner sub-agents this action installs, one per rung: `planner-fast` and so on. */
export const PLANNER_PREFIX = "planner-";
export const plannerName = (tier: Tier): string => `${PLANNER_PREFIX}${tier}`;

/** Drafting handoffs open with this phase: any rung may draft, so the kick-off guard allows it. */
export const DRAFT_PHASE = "draft";

/** The first line of a planner's draft reply, and of a review's. */
export const DRAFT_STATUS = { done: "STATUS: done", escalate: "STATUS: escalate" } as const;
export const REVIEW_VERDICT = { pass: "Verdict: pass", revise: "Verdict: revise" } as const;

/** Review findings about a draft are recorded under this lens. */
const DRAFT_LENS = "draft";

const PLANNER_ROLE: Record<Tier, string> = {
  fast: "First rung for fix and ticket plans.",
  balanced:
    "First rung for feat and epic plans; second after the fast planner's draft failed review.",
  deep: "Classifies requests and reviews every plan; drafts projects, and other plans after the balanced planner's draft failed review.",
};

const PLANNER_TIER_NOTE: Record<Tier, string> = {
  fast: `You are the fast planner. When the plan needs more reasoning than a small change, reply \`${DRAFT_STATUS.escalate}\` early: that costs less than a weak draft.`,
  balanced:
    "You are the balanced planner. When the handoff lists issues from an earlier draft, fix each one and avoid repeating its cause.",
  deep: "You are the deep planner, the last rung: cheaper planners may already have failed this draft. Read every issue the handoff lists, be thorough, and still keep the reply short.",
};

export function plannerDescription(tier: Tier, model: string): string {
  return `Planning specialist for the ${PLANNING} action (${model || "session model"}). Drafts ticket plans into the plan store and reviews them. ${PLANNER_ROLE[tier]}`;
}

export function plannerBody(tier: Tier): string {
  return `You are a planner, a sub-agent of the \`${PLANNING}\` action. The parent session runs the interview with the user and keeps every decision; you do the reasoning it hands you and reply briefly.

Every handoff opens with a phase line and names the plan store, a SQLite file. Read it with small \`sqlite3\` selects (or \`python3 -m sqlite3\`) and the code with bounded reads (line ranges, \`grep\`); never dump a whole table or file.

## Phases

- \`${phase("plan")}\`: answer what the handoff asks (such as classifying a request) in its answer shape. Change nothing.
- \`${phase(DRAFT_PHASE)}\`: write the draft into the store yourself, following the draft rules. Start every write with \`${STORE_WRITE_PREFIX}\`, and first delete any earlier draft (its blocks, tickets and epics). When the handoff lists issues from earlier drafts, fix every one.
- \`${phase("review")}\`: check what the handoff names against its lenses, the decisions in the store and the draft rules. Change nothing.

## Draft rules

- A project splits into epics; every epic splits into stories; a feat, fix or ticket that fits \`${MAX_STORY_SIZE}\` stays one story.
- Every story has a specific title, its outcome, "done when" criteria a test or a person can check, a size (${STORY_SIZES.map(code).join(", ")}) and \`touches\`: the areas or paths it changes.
- Every decision and every "done when" criterion in the store is covered by a story.
- Shared foundations (schemas, contracts, scaffolding, design tokens) come first; after them, stories in separate areas that do not wait on each other. A \`blocks\` row only where one story needs another's result.
- ${WAVE_RULE} \`SELECT * FROM waves ORDER BY wave\` shows them; an open ticket missing from it sits in a dependency cycle or behind one, so break that cycle.

## Reply

- **plan**: the answer, within the handoff's budget.
- **draft**: first line \`${DRAFT_STATUS.done}\`, or \`${DRAFT_STATUS.escalate}\` with the reason when the plan needs more than you can settle. Then the epics, the ticket count, one line per wave (wave: ticket IDs), how each listed issue was fixed, and what you could not settle.
- **review**: first line \`${REVIEW_VERDICT.pass}\` or \`${REVIEW_VERDICT.revise}\`, then one line per finding: kind (gap / red_flag / smell / risk), lens, what, why it matters in plain words, recommended fix. Only findings tied to the plan or to code (path:line). A draft passes when no finding would leave a story unbuildable, unverifiable or in the wrong order.

${PLANNER_TIER_NOTE[tier]}
`;
}

const code = (text: string): string => `\`${text}\``;

export function planningMarkdown(runtime: Runtime, models: PlanningModels): string {
  const cmd = actionCommand(runtime, PLANNING);
  const cont = actionCommand(runtime, CONTINUE);
  const kickOff = actionCommand(runtime, KICK_OFF);
  const args =
    runtime === "codex"
      ? `Argument: the user's message after ${code(cmd)}.`
      : "Argument: `$ARGUMENTS`.";
  const ask =
    runtime === "claude"
      ? `with the ${CLAUDE_QUESTION_TOOL} tool`
      : "in one message, numbered, with lettered options";
  const deep = code(plannerName("deep"));
  const fast = code(FAST_READER);
  const planners = (["fast", "balanced", "deep"] as const)
    .map((tier) => `${code(plannerName(tier))} (${models[tier]})`)
    .join(", ");
  const caps = KIND_NAMES.map((k) => `${k} ${PLAN_KINDS[k].fanOut}`).join(", ");
  const starts = KIND_NAMES.map((k) => `${k} ${code(plannerName(PLAN_KINDS[k].start))}`).join(", ");
  const lenses = LENSES.map(([name, focus]) => `   - **${name}**: ${focus}.`).join("\n");
  return `${actionFrontmatter(runtime, PLANNING, DESCRIPTION, PLANNING_HINT)}

## Arguments

${args} Its first word may name the kind of plan: ${KIND_NAMES.map(code).join(", ")}; the rest says what to plan, as free text, a Kaneo URL or a ticket identifier. When it is empty, ask what to plan and wait.

## Ground rules

- **Facts are yours, decisions are the user's.** Look up whatever the code, the board or the tools can answer; ask the user only what they alone can decide.
- **Plain words.** Write every question and summary so someone new to the field can answer it: name the concept, say in one line why it matters, and give the trade-off of each option. Match the user's vocabulary when they use technical terms.
- **Recommend.** Every question carries your recommended answer and why. When the user skips a question or says to choose, take the recommendation and record it as decided by recommendation.
- **The store is the memory.** Record every fact, decision, finding and ticket in the plan store the moment it settles. Read it back with small queries instead of scrolling the conversation, and hand sub-agents the store path instead of the plan.

## Save context

This session runs the interview and keeps the decisions. Reasoning over the whole plan and bulky reads run on agents through ${CALL[runtime]("<name>")} and come back as short answers.

- **Planners**: this action installs one planning specialist per rung: ${planners}. Classification, gap reviews and every review run on ${deep}; drafting climbs the planner ladder (step 5). Each handoff starts with its phase line: ${code(phase("plan"))} to classify, ${code(phase(DRAFT_PHASE))} to draft, ${code(phase("review"))} to review.
- **Code facts**: ${fast} (${models.fast}) answers with \`path:line\` bullets.
- **Kaneo**: every read and write goes through ${code(SCRIBE)} (${models.fast}).
- **Fan-out**: at most this many sub-agents run at once, by kind: ${caps}.

When one of these agents is not installed, do the step yourself with bounded reads.

## 1. Know what is installed

1. Run \`agent-config catalog --json\`. An item counts when it has an entry at user scope or for this repository's path. When the command is missing, count only the skills and tools this session shows.
2. When ${code(KANEO_ITEM)} is installed, have the scribe call the Kaneo MCP \`whoami\`. A reply means the tickets go to Kaneo; anything else means they stay in the store, and the report says why.
3. Shape the plan by what is there:

| Installed | Effect on the plan |
| --- | --- |
| ${code(KANEO_ITEM)} with a working MCP | Tickets become Kaneo epics and stories, as the ${code(KANEO_SKILL)} skill says. |
| ${code(CONTINUE)} | Stories are cut to run in parallel waves; the report names ${code(`${cont} ${PARALLEL_WAVE}`)}. |
| ${code(KICK_OFF)} | The report offers ${code(`${kickOff} <EPIC-ID>`)} to prepare a brief for a fresh session. |
| ${code(LADDER_ITEM)} | Code facts come from ${fast}. |

A missing item costs nothing: say in one line what it would add, then go on.

## 2. Classify the request

1. Create the plan store (see "Plan store" below) and insert the plan row with the request and a short kebab-case title.
2. Hand the request to ${deep}:

   \`\`\`
   ${phase("plan")}
   Task: classify a planning request
   Request: <the argument>
   Store: <store path>
   Scope: this repository
   Answer shape: kind (${KIND_NAMES.join(" / ")}) and why; the outcome in one sentence; a size guess; facts found (stack, existing design system, test runner, CI, code the request touches as path:line); unknowns that block planning.
   Budget: <= 400 words
   \`\`\`

   A project is a new product or several epics; an epic is one outcome too big for one ticket (over ${code(MAX_STORY_SIZE)}); a feat is one new behavior; a fix corrects existing behavior; a ticket is one change already scoped.
3. Record the kind, the outcome and the facts. A kind named in the argument stands unless the analysis contradicts it; then ask. The kind sets the fan-out cap and the branches the interview covers.

## 3. Interview in rounds

Map the plan as a **design tree**: every decision branches into the decisions that hang off it. The **frontier** is every open decision whose prerequisites are settled.

Each round asks the frontier's ${ROUND_SIZE} most consequential questions ${ask}, each with its options, the recommended one first, and one line on why it matters. A question that depends on another still open waits for a later round. Record every answer in \`decisions\`, recompute the frontier, and ask the next round. When a question needs a fact, send ${fast} for it and ask the rest of the frontier meanwhile.

Branches the tree visits, by kind:

- **Every kind**: the outcome and who it is for; "done when" criteria a test or a person can check; what is out of scope.
- **fix**: how to reproduce it, expected versus actual behavior, where the behavior lives and the suspected cause, the regression test.
- **feat**: the behavior and its edge cases, the interfaces it changes (API, UI, data), rollout or feature flag, tests.
- **epic**: everything a feat covers, plus the areas of code it touches, data migrations, delivery order, and dependencies on other epics.
- **project**: the users and their problem, the stack (language, framework, data store, hosting), whether it has a UI and a design system (then the "Design system standard" below), authentication and data handling, testing, CI and deployment, observability, and the epics in order.

The interview is done when the frontier is empty: every branch visited, nothing silently assumed.

## 4. Find gaps and red flags

1. Hand the store to reviewers on ${deep}, up to the fan-out cap at once. Each takes one or more lenses (with fewer reviewers than lenses, a reviewer takes several; skip **experience** without a UI):
${lenses}

   \`\`\`
   ${phase("review")}
   Task: find gaps, red flags and code smells in a plan
   Store: <store path> (query it with sqlite3; change nothing)
   Lenses: <lenses>
   Scope: this repository
   Answer shape: one line per finding: kind (gap / red_flag / smell / risk), lens, what, why it matters in plain words, recommended fix. Only findings tied to the plan or to code (path:line).
   Budget: <= 500 words
   \`\`\`

2. For an epic or a project, review the findings before asking about them: one more ${deep} reviewer (${code(phase("review"))}) drops duplicates and findings the store already answers, checks each remaining one against the code, and ranks them by impact.
3. Record the findings. Each open gap joins the frontier as a question; each red flag and smell is shown in plain words with its recommended fix, and the user's call on it is recorded.
4. Go back to step 3. The loop ends when a review finds nothing new.

## 5. Draft the tickets on the planner ladder

The draft starts on the kind's planner: ${starts}. The planners know the draft rules (stories of ${code(MAX_STORY_SIZE)} or less, checkable criteria, ${code(TOUCHES_LINE)} areas, foundations first, waves). Each attempt is one draft and one review:

1. **Draft**: hand the planner \`${phase(DRAFT_PHASE)}\`, the store path, the task "draft the tickets", and every finding earlier reviews of a draft raised, so it learns from them. It writes the draft into the store and replies \`${DRAFT_STATUS.done}\` with a summary, or \`${DRAFT_STATUS.escalate}\` with the reason.
2. **Review**: after \`${DRAFT_STATUS.done}\`, hand ${deep} \`${phase("review")}\`, the store path and the task "check the draft's quality". It replies \`${REVIEW_VERDICT.pass}\` or \`${REVIEW_VERDICT.revise}\` with its findings; record them in \`findings\` with the lens \`${DRAFT_LENS}\`, and mark resolved the earlier ones this draft fixed.
3. **Climb**: on \`${REVIEW_VERDICT.revise}\` or \`${DRAFT_STATUS.escalate}\`, go back to 1 one rung up (fast, then balanced, then deep), one attempt per rung.
4. When the deep planner's draft still fails its review, stop climbing: its open findings go to the user in step 6.

Climb on a failed review, never for speed: a cheap draft that the review checks still costs less than starting high.

## 6. Final review

1. Hand the whole store to ${deep} (${code(phase("review"))}, every lens) for one last pass: open gaps, red flags, smells, criteria nobody can check, stories over ${code(MAX_STORY_SIZE)}, cycles, waves with overlapping areas, decisions that contradict each other.
2. Show the user the plan in plain words: the outcome, the epics, a table of waves (wave, ticket, size, touches), the decisions taken on recommendation, and the open findings.
3. Ask about every open gap in step 3's format, update the plan, and repeat this step until the review finds nothing open.
4. When the user asks to write the tickets while gaps are still open, write them: each open gap becomes a ticket titled ${code(`${GAP_TITLE_PREFIX}<question>`)} with the question, why it matters, the options and the recommended answer, sized ${code(GAP_SIZE)}, labelled ${code(GAP_LABEL)} (color ${code(GAP_LABEL_COLOR)}), and blocking the tickets whose work depends on its answer.

## 7. Write the tickets

- **Kaneo**: load the ${code(KANEO_SKILL)} skill and follow its "Plan an epic" section; epics are titled ${code(`${EPIC_TITLE_PREFIX}<outcome>`)}. Have the scribe create each epic, then its stories and gap tickets with their labels and relations, in batches. Check each reply against the store, record every Kaneo identifier in \`tracker_id\`, and set the plan's tracker to \`kaneo\`.
- **Store only**: the tickets already live in the store.

Set the plan's status to \`written\`.

## 8. Report

In plain words: what will be built, the epics, the waves and the widest wave's size, the decisions taken on recommendation, the gap tickets, the store path, and what to run next, naming only commands whose item is installed:

- ${code(`${cont} ${PARALLEL_WAVE}`)} builds the next wave of an epic in parallel;
- ${code(`${cont} parallel <N>`)} works up to N tickets at once, ${code(cont)} one at a time;
- ${code(`${kickOff} <EPIC-ID>`)} prepares a brief that works a whole epic in a fresh session.

With none installed, say how to work the tickets by hand from the store.

## Plan store

Path: ${code(PLAN_STORE_PATH)} under the repository root, where \`<MM-yyyy>\` is the current month (\`10-2026\`). Create it with \`sqlite3\` (or \`python3 -m sqlite3\` when \`sqlite3\` is missing) from this schema:

\`\`\`sql
${PLAN_SCHEMA}
\`\`\`

Start every write with ${code(STORE_WRITE_PREFIX)}: SQLite checks the links between tables only when a connection asks, and then refuses a ticket, epic or blocker that does not exist. Query it with small selects (\`sqlite3 -box <path> "SELECT …"\`), never a full dump. \`SELECT * FROM waves ORDER BY wave\` lists the open tickets with the wave each can start in.

## Design system standard

Applies to every plan with a UI and a design system; each rule becomes "done when" criteria of the stories that build it.

- **4-point grid**: every spacing, size, radius, icon, font size, line height and breakpoint token is a multiple of 4 px. Ask whether 1 px hairline borders are the one exception.
- **Accessibility**: WCAG 2.2 AA. Text contrast 4.5:1 (3:1 for large text and UI parts), a visible focus ring, everything reachable by keyboard, semantic roles and labels, targets of at least 24 px (44 px recommended for touch), color never the only signal, and automated accessibility checks in CI.
- **Motion**: scroll-driven animations ship as first-party design-system components (reveal on scroll, scroll progress, sticky and parallax sections, staggered lists) with motion tokens for durations and easing. A proven library is welcome when it meets this bar: only \`transform\` and \`opacity\` animate, no layout shift, a steady 60 fps on a mid-range phone, no scroll hijacking, cleanup on unmount, safe under server rendering, and \`prefers-reduced-motion\` honored with a still or fade fallback. Every motion component ships tests for its reduced-motion path and its cleanup.
- Ask the stack-specific choices (component library, styling, motion library) with a recommendation for the chosen stack.
`;
}
