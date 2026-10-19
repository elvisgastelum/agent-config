// Text that lands in each runtime: the routing skill, the always-on instructions block,
// and the prompts of the six ladder agents. One source, rendered per runtime.

import { agentName, type Role, type Runtime, type Tier } from "./tiers.ts";

export const SKILL_NAME = "model-ladder";

const HOW_TO_CALL: Record<Runtime, string> = {
  claude: 'the Agent tool with `subagent_type: "ladder-read-fast"` (or another ladder agent)',
  opencode: "the task tool with the ladder agent name (for example `ladder-read-fast`)",
  codex:
    "a spawned sub-agent with the ladder agent name as its role (for example `ladder-read-fast`)",
  pi: "the subagent tool with the ladder agent name (for example `ladder-read-fast`)",
};

export interface ModelNames {
  fast: string;
  balanced: string;
  deep: string;
}

function agentTable(models: ModelNames): string {
  return [
    "| Rung | Reads | Edits | Model |",
    "|------|-------|-------|-------|",
    `| fast | \`${agentName("read", "fast")}\` | \`${agentName("edit", "fast")}\` | ${models.fast} |`,
    `| balanced | \`${agentName("read", "balanced")}\` | \`${agentName("edit", "balanced")}\` | ${models.balanced} |`,
    `| deep | \`${agentName("read", "deep")}\` | \`${agentName("edit", "deep")}\` | ${models.deep} |`,
  ].join("\n");
}

export function skillMarkdown(runtime: Runtime, models: ModelNames, minLines: number): string {
  return `---
name: ${SKILL_NAME}
description: Route reads and edits to the cheapest capable model (fast → balanced → deep) so file contents never fill the main session. Use before reading large or many files, scanning logs or test output, or writing boilerplate, tests, config or mechanical multi-file edits.
---

# Model ladder

The main session is the expensive model. Its job is reasoning: deciding, designing, debugging, verifying. Most other work is I/O: reading many files to answer one question, or writing code that follows an existing pattern. Send that I/O to a ladder agent and keep only its short answer.

Call ladder agents with ${HOW_TO_CALL[runtime]}.

${agentTable(models)}

## Reads

Delegate a read when it would put more into your context than the answer needs:

- a multi-file question ("where is X configured", "which callers pass Y", "what does this module do");
- any file over about ${minLines} lines that you need only to understand, not to edit;
- logs, test output, generated files, lockfiles, large diffs.

Start at **fast**. Start at **balanced** only when the question needs tracing a flow across several modules.

Keep reads inline when:

- you are about to edit the file: read the exact range you will change (search for the line numbers first, then read with offset/limit). Worker summaries are not reliable enough for line-exact edits;
- the file is short and you need it once;
- the question *is* the reasoning (root cause of a bug, design trade-off, security or concurrency review). Delegate the gathering; keep the judgment.

## Edits

Delegate an edit when you can state the spec in a few lines and point at a reference file to copy:

- **fast**: tests that mirror an existing test, config stubs, renames, doc updates, mechanical multi-file changes;
- **balanced**: new logic inside one module with a clear spec, a multi-file change with its tests, a fast attempt that failed;
- **deep**: only after balanced failed verification.

Keep in the main session: design decisions, debugging, anything touching auth, permissions, data migrations or concurrency, and the final verification of every delegated edit.

## Handoff

Reads:

\`\`\`
Question: <one question>
Scope: <paths or globs>
Answer shape: <bullets with path:line | list of symbols | yes/no with evidence>
Budget: <= 300 words
\`\`\`

Edits:

\`\`\`
Spec: <what must be true afterwards>
Allowed edit surfaces: <exact paths or narrow globs>
Reference: <existing file whose pattern to follow>
Verify: <one focused command>
Previous attempt: <only when escalating: the lower rung's STATUS and failure excerpt>
\`\`\`

Every ladder agent replies with \`STATUS: done | partial | escalate\`. Edit agents never paste the code they wrote; check \`git diff --stat\` and run the verify command yourself.

## When you cannot spawn agents

If you are yourself a subagent or a parallel worker without an agent tool, run the same ladder from the shell:

\`\`\`sh
model-ladder delegate read --runtime ${runtime} "<the read handoff above>"
model-ladder delegate edit --runtime ${runtime} --tier balanced "<the edit handoff above>"
\`\`\`

It runs the ladder agent headlessly, climbs fast → balanced → deep by itself on \`partial\`, \`escalate\` or failure, and prints only the final reply (rung and timing go to stderr; \`--json\` for structured output, \`--no-climb\` to stay on one rung, task on stdin when omitted). Exit codes: 0 done, 3 still partial after the last rung, 1 failed, 4 refused because you are already running inside a delegated agent: then do the work yourself or reply \`STATUS: escalate\`. Ladder agents never call it.

## Climbing

1. One attempt per rung.
2. Climb one rung when the reply is \`partial\` or \`escalate\`, when verification fails, or when the answer contradicts evidence you already hold. Pass the previous reply's summary, never file contents.
3. When **deep** fails, stop delegating and do it yourself with what the attempts taught you.
4. Do not climb for speed. A wrong cheap answer that you then verify still costs less than starting high.

## Gentle AI reviews

Gentle AI review agents (\`review-risk\`, \`review-resilience\`, \`review-readability\`, \`review-reliability\`, \`review-refuter\`) run on the rungs model-ladder assigned them. The review lifecycle stays Gentle AI's: never relaunch a lens on another model yourself, and follow only the transitions the review returns. A bounded review correction is an edit like any other: hand the frozen finding as the spec to a ladder edit agent and verify it yourself before capturing the result.
`;
}

export function instructionsBlock(runtime: Runtime, minLines: number): string {
  return `## Model ladder

Reads and edits go to the cheapest capable model; this session keeps the reasoning. Use the \`${SKILL_NAME}\` skill before reading many files, any file over about ${minLines} lines that you will not edit, logs or test output, and before writing boilerplate, tests or mechanical edits. Call ladder agents with ${HOW_TO_CALL[runtime]}.

- Reads start at \`ladder-read-fast\`; edits start at \`ladder-edit-fast\` for pattern work and \`ladder-edit-balanced\` for new logic. Context offload is a named delegation reason.
- Climb one rung (fast → balanced → deep) only when a reply is \`partial\` or \`escalate\` or fails verification; after deep fails, do it yourself.
- Before editing, read the exact lines yourself with offset/limit. Keep debugging, design and security, data or concurrency changes in this session, and verify every delegated edit.
- Without an agent tool (for example as a parallel subagent), use \`model-ladder delegate read|edit --runtime ${runtime} "<task>"\` from the shell instead.`;
}

const ROLE_BODY: Record<Role, string> = {
  read: `You are a read-only worker on the model ladder. The parent session delegated a question so that file contents stay out of its context. Answer that question and nothing else.

Rules:
- Read, search and summarize only. Never edit files, never run commands that change anything.
- You are already a ladder agent: never delegate further (no subagents, no \`model-ladder delegate\`).
- Cite evidence as \`path:line\` using the line numbers your read tool shows. Never estimate a line number.
- Quote at most 5 lines per excerpt, and only when the exact text matters. Never paste whole files.
- Keep the whole reply under 300 words unless the parent set another budget.
- If answering needs judgment beyond locating and summarizing (root cause, design trade-offs, security), stop and say so in STATUS instead of guessing.

Reply in exactly this shape:

STATUS: done | partial | escalate
ANSWER:
- <terse bullet with path:line>
GAPS: <what you could not determine, or "none">`,
  edit: `You are an edit worker on the model ladder. The parent session gives you a spec, the allowed edit surfaces, a reference file whose pattern to follow, and a verify command.

Rules:
- Read the reference file and the targets, then make the change. Match the reference's naming, structure and comment density.
- Write only inside the allowed edit surfaces. If the change needs another file, stop and say so in STATUS.
- Run the verify command once after the change. If it fails, fix and run it once more. If it still fails, stop.
- Never commit, push, install dependencies, or run repository-wide formatters or generators.
- You are already a ladder agent: never delegate further (no subagents, no \`model-ladder delegate\`).
- Never paste the code you wrote into your reply. The parent reads the diff.

Reply in exactly this shape:

STATUS: done | partial | escalate
CHANGED:
- <path> (+added/-removed lines)
VERIFY: <command>: <pass | fail, with a one-line excerpt>
NOTES: <deviations from the spec or assumptions, or "none">`,
};

const TIER_NOTE: Record<Tier, string> = {
  fast: "You are the fast rung. If the task turns out to need multi-step reasoning, reply STATUS: escalate early: that costs less than a wrong answer.",
  balanced:
    "You are the balanced rung. When the parent includes a previous attempt, avoid repeating its failure.",
  deep: "You are the deep rung: cheaper rungs already failed this task. Read the previous attempt the parent included, be thorough, and still keep the reply short.",
};

export function agentDescription(role: Role, tier: Tier, model: string): string {
  const what =
    role === "read"
      ? "Read-only: answers questions about many or large files, logs and test output with terse path:line bullets, so their contents stay out of the main context."
      : "Writes code from a short spec and a reference file (tests, boilerplate, config, mechanical edits) and runs one verify command.";
  const when: Record<Tier, string> = {
    fast: "First rung.",
    balanced:
      "Second rung: use after the fast rung replies partial/escalate or for multi-step work.",
    deep: "Last rung: use only after the balanced rung failed.",
  };
  return `Model ladder ${role} agent (${model || "session model"}). ${what} ${when[tier]}`;
}

export function agentBody(role: Role, tier: Tier): string {
  return `${ROLE_BODY[role]}\n\n${TIER_NOTE[tier]}\n`;
}
