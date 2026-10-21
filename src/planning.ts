// The planning catalog item's text: a manual-only action that turns a request into a complete,
// parallel-ready ticket plan. It interviews the user in rounds, finds gaps and red flags on the
// deep rung, keeps the plan in a SQLite store under .plans, and writes Kaneo epics and stories when
// the kaneo item is installed and its MCP answers.

import { CALL, CONTINUE, actionCommand, actionFrontmatter } from "./continue.ts";
import {
  EPIC_TITLE_PREFIX,
  KANEO_ITEM,
  KANEO_SKILL,
  SCRIBE,
  TOUCHES_LINE,
  WAVE_RULE,
} from "./kaneo.ts";
import { KICK_OFF, PHASE_PREFIX } from "./kickoff.ts";
import { LADDER_ITEM } from "./ops.ts";
import { agentName, type Runtime } from "./tiers.ts";

export const PLANNING = "planning";

const DESCRIPTION =
  "Plan a project, epic, feature, fix or ticket with you: ask only the questions that matter, each with a recommended answer, find gaps and red flags, then write ready-to-run tickets (Kaneo epics in parallel waves when installed).";

/** The plan kinds and how many sub-agents may run at once for each. */
export const PLAN_KINDS = { fix: 1, ticket: 1, feat: 2, epic: 3, project: 5 } as const;
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
 * safe. The `waves` view layers open tickets by their unfinished blockers.
 */
export const PLAN_SCHEMA = `PRAGMA foreign_keys = ON;
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
CREATE VIEW IF NOT EXISTS waves AS
WITH RECURSIVE layer(ticket_id, wave) AS (
  SELECT t.id, 1 FROM tickets t
  WHERE t.status <> 'done' AND NOT EXISTS (
    SELECT 1 FROM blocks b JOIN tickets p ON p.id = b.blocker
    WHERE b.blocked = t.id AND p.status <> 'done')
  UNION
  SELECT b.blocked, layer.wave + 1 FROM layer
  JOIN blocks b ON b.blocker = layer.ticket_id
  JOIN tickets t ON t.id = b.blocked
  WHERE t.status <> 'done' AND layer.wave < (SELECT COUNT(*) FROM tickets)
)
SELECT t.epic_id, layer.ticket_id, MAX(layer.wave) AS wave
FROM layer JOIN tickets t ON t.id = layer.ticket_id
GROUP BY layer.ticket_id;`;

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

const DEEP_READER = agentName("read", "deep");
const FAST_READER = agentName("read", "fast");

/** Models the action names, one per rung. */
export interface PlanningModels {
  fast: string;
  deep: string;
}

const code = (text: string): string => `\`${text}\``;
const phase = (name: string): string => `${PHASE_PREFIX} ${name}`;

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
  const deep = code(DEEP_READER);
  const fast = code(FAST_READER);
  const caps = KIND_NAMES.map((k) => `${k} ${PLAN_KINDS[k]}`).join(", ");
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

- **Reasoning**: classification, gap reviews, ticket drafting and the final review run on ${deep} (${models.deep}). Each handoff starts with its phase line: ${code(phase("plan"))} to classify or draft, ${code(phase("review"))} to review.
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
| ${code(CONTINUE)} | Stories are cut to run in parallel waves; the report names ${code(`${cont} parallel-wave`)}. |
| ${code(KICK_OFF)} | The report offers ${code(`${kickOff} <EPIC-ID>`)} to prepare a brief for a fresh session. |
| ${code(LADDER_ITEM)} | Reasoning and reads run on the ladder agents above. |

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

## 5. Draft the tickets

Hand the store to ${deep} (${code(phase("plan"))}, task: draft the tickets) and record its draft:

- A project splits into epics; every epic splits into stories; a feat, fix or ticket that fits ${code(MAX_STORY_SIZE)} stays one story.
- Every story has a specific title, its outcome, "done when" criteria, a size (${STORY_SIZES.map(code).join(", ")}) and its ${code(TOUCHES_LINE)} areas or paths.
- Cut for parallel work: shared foundations (schemas, contracts, scaffolding, design tokens) come first; after them, stories in separate areas that do not wait on each other. Add a \`blocks\` edge only where one story needs another's result.
- ${WAVE_RULE} Check the waves with the store's \`waves\` view: tickets missing from it sit in a dependency cycle, which the draft breaks.

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

- ${code(`${cont} parallel-wave`)} builds the next wave of an epic in parallel;
- ${code(`${cont} parallel <N>`)} works up to N tickets at once, ${code(cont)} one at a time;
- ${code(`${kickOff} <EPIC-ID>`)} prepares a brief that works a whole epic in a fresh session.

With none installed, say how to work the tickets by hand from the store.

## Plan store

Path: ${code(PLAN_STORE_PATH)} under the repository root, where \`<MM-yyyy>\` is the current month (\`10-2026\`). Create it with \`sqlite3\` (or \`python3 -m sqlite3\` when \`sqlite3\` is missing) from this schema:

\`\`\`sql
${PLAN_SCHEMA}
\`\`\`

Query it with small selects (\`sqlite3 -box <path> "SELECT …"\`), never a full dump. \`SELECT * FROM waves ORDER BY wave\` lists the open tickets with the wave each can start in.

## Design system standard

Applies to every plan with a UI and a design system; each rule becomes "done when" criteria of the stories that build it.

- **4-point grid**: every spacing, size, radius, icon, font size, line height and breakpoint token is a multiple of 4 px. Ask whether 1 px hairline borders are the one exception.
- **Accessibility**: WCAG 2.2 AA. Text contrast 4.5:1 (3:1 for large text and UI parts), a visible focus ring, everything reachable by keyboard, semantic roles and labels, targets of at least 24 px (44 px recommended for touch), color never the only signal, and automated accessibility checks in CI.
- **Motion**: scroll-driven animations ship as first-party design-system components (reveal on scroll, scroll progress, sticky and parallax sections, staggered lists) with motion tokens for durations and easing. A proven library is welcome when it meets this bar: only \`transform\` and \`opacity\` animate, no layout shift, a steady 60 fps on a mid-range phone, no scroll hijacking, cleanup on unmount, safe under server rendering, and \`prefers-reduced-motion\` honored with a still or fade fallback. Every motion component ships tests for its reduced-motion path and its cleanup.
- Ask the stack-specific choices (component library, styling, motion library) with a recommendation for the chosen stack.
`;
}
