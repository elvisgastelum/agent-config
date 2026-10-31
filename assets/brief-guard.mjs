#!/usr/bin/env node
// agent-config brief guard: a Claude Code PreToolUse hook (Agent, Task, Bash, Write and T3 Code's
// delegate_task, whose `task` is checked as a handoff and `target.model` as its model; t3_thread_launch
// and create_threads are checked the same way through their first prompt and model).
//
// Holds a /brief run to its structure:
// - A delegated handoff whose prompt starts with `Phase: <phase>` runs on the rung that phase
//   allows: diagnose, plan and risk on deep; review on deep or balanced, and on fast only when the
//   line right under the phase line is `Fast review: approved by the user`. Edit and fix handoffs
//   are not checked.
// - A brief (`agent-config/briefs/<ID>.md`) must start with /continue and have every
//   section and phase the loop needs. A Write of a brief is checked before it lands. A Bash
//   command that copies to the clipboard and names a brief must be the copy alone
//   (`pbcopy < <brief>` or `cat <brief> | pbcopy`), since the guard runs before the command and
//   anything beside the copy could rewrite the brief; the brief on disk must exist and be complete.
//
// Any unexpected input or error lets the call through: the guard never breaks a session. Brief
// paths resolve `$VAR` from the hook's environment, so a variable set inside the same command is
// not seen and that copy goes through unchecked.

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ASSIGNMENT, WRAPPERS, commandName, parse } from "./shell-split.mjs";

const GUARD = "brief-guard";

// ---------------------------------------------------------------- handoffs

/** Claude tools that start a delegated agent; their prompt is the handoff. */
const HANDOFF_TOOLS = new Set(["Agent", "Task"]);
/** T3 Code's child-agent tool: its `task` is the handoff and `target.model` its model. */
const T3_DELEGATE_TOOL = "mcp__t3-code__delegate_task";
/** T3 Code's thread tools: the first prompt is the handoff (`message`, or each thread's `prompt`). */
const T3_THREAD_LAUNCH_TOOL = "mcp__t3-code__t3_thread_launch";
const T3_CREATE_THREADS_TOOL = "mcp__t3-code__create_threads";

/** How a denial tells each T3 tool to set its model. */
const DELEGATE_MODEL_FIX = "In delegate_task, set `target.model`";
const LAUNCH_MODEL_FIX = "In t3_thread_launch, set `modelSelection.model`";
const CREATE_MODEL_FIX = "In create_threads, set each thread's `target.model`";

/** A handoff's first non-empty line names its phase, e.g. `Phase: plan`. */
const PHASE_LINE = /^Phase:\s*([a-z]+)/i;

/** The rungs each checked phase may run on; edit and fix are absent, so they are not checked. */
const PHASE_RUNGS = new Map([
  ["diagnose", ["deep"]],
  ["plan", ["deep"]],
  ["risk", ["deep"]],
  ["review", ["deep", "balanced"]],
]);
const REVIEW_PHASE = "review";
const FAST_RUNG = "fast";

/** The exact line, right under the phase line, that lets a review run on the fast rung. */
export const FAST_REVIEW_APPROVAL = "Fast review: approved by the user";

/**
 * Ladder and planner agents carry their rung in their name: ladder-read-deep, ladder-edit-fast,
 * ladder-reviewer-balanced, planner-balanced.
 */
const LADDER_AGENT =
  /^(?:ladder-(?:read|explorer|researcher|designer|user-experience|edit|reviewer)|planner)-(fast|balanced|deep)$/;
/** The orchestrator has no rung in its name: it always runs on the deep rung. */
const ORCHESTRATOR = "ladder-orchestrator";
const DEEP_RUNG = "deep";
const READ_AGENT_PREFIX = "ladder-read-";
const REVIEW_AGENT_PREFIX = "ladder-reviewer-";

/** Model families and their rung; an alias (haiku) or a full ID (claude-haiku-5-5) names one. */
const MODEL_FAMILY_RUNGS = [
  ["haiku", "fast"],
  ["sonnet", "balanced"],
  ["opus", "deep"],
];

// ---------------------------------------------------------------- briefs

const SHELL_TOOL = "Bash";
/** Claude's file-writing tool; a brief written with it is checked before it lands. */
const WRITE_TOOL = "Write";

/** Briefs live in <state dir>/agent-config/briefs; the skill's own brief folder does not match. */
const BRIEF_PATH = /(^|\/)agent-config\/briefs\/[^/]+\.md$/;

/** The command a brief opens with: `/continue` or `/continue parallel <n>`. */
const CONTINUE_COMMAND = /^\/continue(\s|$)/;

export const BRIEF_SECTIONS = [
  "# Brief:",
  "## Epic",
  "## Queue",
  "## Loop per ticket",
  "## Model routing",
  "## Stop and report",
];
export const BRIEF_PHASES = ["Phase: plan", "Phase: risk", "Phase: review"];

/** Commands that put their input on the clipboard, matched on the command's name. */
const CLIPBOARD_TOOLS = new Set([
  "pbcopy",
  "wl-copy",
  "xclip",
  "xsel",
  "clip",
  "clip.exe",
  "Set-Clipboard",
]);
/** The reader allowed in front of a clipboard tool: `cat <brief> | pbcopy`. */
const CAT = "cat";
/** How a brief may be copied: alone, so nothing in the same command writes it after the check. */
const COPY_FORMS = "`pbcopy < <brief>` or `cat <brief> | pbcopy` (or another clipboard tool)";
/** Commands whose arguments are text they print, not files they read: a brief path there is text. */
const TEXT_COMMANDS = new Set(["echo", "printf"]);
/** readFileSync's error code for a path that does not exist. */
const MISSING_FILE = "ENOENT";

/** A leading `~/`, which the shell expands to the home directory. */
const HOME_TILDE = /^~(?=\/)/;

// ---------------------------------------------------------------- hook protocol

const HOOK_EVENT = "PreToolUse";
const DENY = "deny";

/** Returns the reason to deny a tool call, or undefined to let it through. */
export function decide(input) {
  const tool = input?.tool_name;
  const args = input?.tool_input;
  if (HANDOFF_TOOLS.has(tool) && typeof args?.prompt === "string") return handoff(args);
  if (tool === T3_DELEGATE_TOOL && typeof args?.task === "string") {
    return handoff({ prompt: args.task, model: args.target?.model, modelFix: DELEGATE_MODEL_FIX });
  }
  if (tool === T3_THREAD_LAUNCH_TOOL && typeof args?.message === "string") {
    return handoff({
      prompt: args.message,
      model: args.modelSelection?.model,
      modelFix: LAUNCH_MODEL_FIX,
    });
  }
  if (tool === T3_CREATE_THREADS_TOOL && Array.isArray(args?.threads)) {
    for (const thread of args.threads) {
      if (typeof thread?.prompt !== "string") continue;
      const denied = handoff({
        prompt: thread.prompt,
        model: thread.target?.model,
        modelFix: CREATE_MODEL_FIX,
      });
      if (denied) return denied;
    }
    return undefined;
  }
  if (tool === SHELL_TOOL && typeof args?.command === "string") {
    return copy(args.command, input.cwd);
  }
  if (tool === WRITE_TOOL && typeof args?.file_path === "string") return write(args);
  return undefined;
}

function nonEmptyLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * The rung a handoff runs on: its model override's family, else the rung in its ladder or planner
 * agent's name. An override with no known family (fable) defers to that agent; on any other agent it
 * is denied.
 */
function rungOf(type, model) {
  const name = typeof model === "string" ? model.toLowerCase() : "";
  const family = MODEL_FAMILY_RUNGS.find(([f]) => name.includes(f));
  if (family) return family[1];
  if (type === ORCHESTRATOR) return DEEP_RUNG;
  return LADDER_AGENT.exec(type ?? "")?.[1];
}

function handoff({ prompt, subagent_type: type, model, modelFix }) {
  const [first = "", second = ""] = nonEmptyLines(prompt);
  const phase = PHASE_LINE.exec(first)?.[1]?.toLowerCase();
  const allowed = PHASE_RUNGS.get(phase);
  if (!allowed) return undefined;
  const rung = rungOf(type, model);
  if (rung && allowed.includes(rung)) return undefined;
  const review = phase === REVIEW_PHASE;
  if (review && rung === FAST_RUNG && second === FAST_REVIEW_APPROVAL) return undefined;
  const ran = rung
    ? `the ${rung} rung`
    : `\`${type ?? "the default agent"}\`${model ? ` with model "${model}"` : ""}`;
  const prefix = review ? REVIEW_AGENT_PREFIX : READ_AGENT_PREFIX;
  const agents = allowed.map((r) => `${prefix}${r}`).join(" or ");
  const fast = review
    ? ` A fast review needs the line "${FAST_REVIEW_APPROVAL}" right under the phase line, and only when the user asked for it.`
    : "";
  const fix = modelFix
    ? `${modelFix} to a ${allowed.join(" or ")} model.`
    : `Use ${agents} without a model override.`;
  return `${GUARD}: a \`Phase: ${phase}\` handoff runs on the ${allowed.join(" or ")} rung, not ${ran}.\n${fix}${fast}`;
}

/** What a brief is missing; empty when it is complete. */
export function briefProblems(text) {
  const lines = text.split("\n");
  const [first = ""] = nonEmptyLines(text);
  const problems = [];
  if (!CONTINUE_COMMAND.test(first)) {
    problems.push("its first line must be `/continue` or `/continue parallel <n>`");
  }
  const sections = BRIEF_SECTIONS.filter((s) => !lines.some((line) => line.startsWith(s)));
  if (sections.length > 0) problems.push(`missing sections: ${sections.join(", ")}`);
  const phases = BRIEF_PHASES.filter((p) => !text.includes(p));
  if (phases.length > 0) problems.push(`the loop never names ${phases.join(", ")}`);
  return problems;
}

function notReady(path, problems) {
  return `${GUARD}: the brief ${path} is not ready: ${problems.join("; ")}.\nFix it from the template in the brief skill.`;
}

function write({ file_path: path, content }) {
  if (!BRIEF_PATH.test(path) || typeof content !== "string") return undefined;
  const problems = briefProblems(content);
  return problems.length === 0 ? undefined : notReady(path, problems);
}

/**
 * Whether a command runs a clipboard tool. Behind a wrapper, any later word counts, because a
 * wrapper's options may take values (`sudo -u root pbcopy`) that `commandName` cannot tell apart.
 */
function isClipboard(words) {
  if (CLIPBOARD_TOOLS.has(commandName(words))) return true;
  const first = words.find((w) => !ASSIGNMENT.test(w.text));
  return (
    first !== undefined &&
    WRAPPERS.has(basename(first.text)) &&
    words.some((w) => CLIPBOARD_TOOLS.has(basename(w.text)))
  );
}

/** Whether the command is only `<clipboard tool> < <brief>` or `cat <brief> | <clipboard tool>`. */
function isCopyForm(pipelines, briefs) {
  if (pipelines.length !== 1 || briefs.length !== 1) return false;
  const [brief] = briefs;
  const [first, second, ...rest] = pipelines[0];
  if (rest.length > 0) return false;
  if (!second) return isClipboard(first) && brief.input && first.includes(brief);
  const reads = first.filter((w) => !w.output);
  return (
    commandName(first) === CAT && reads.length === 2 && reads[1] === brief && isClipboard(second)
  );
}

/** A brief word's path, resolved against `cwd`; undefined for other words. */
function briefPath(text, cwd) {
  if (!BRIEF_PATH.test(text)) return undefined;
  const path = text.replace(HOME_TILDE, homedir());
  if (isAbsolute(path)) return path;
  return typeof cwd === "string" ? join(cwd, path) : undefined;
}

/**
 * A command that copies to the clipboard and names a brief must be the copy alone, so nothing in
 * it can write the brief after this check; the brief on disk must then exist and be complete.
 */
function copy(command, cwd) {
  const pipelines = parse(command).filter((p) => p.some((words) => words.length > 0));
  const commands = pipelines.flat();
  if (!commands.some(isClipboard)) return undefined;
  const briefs = commands.flatMap((words) => {
    const prints = TEXT_COMMANDS.has(commandName(words));
    return words.filter((w) => BRIEF_PATH.test(w.text) && (w.input || !prints));
  });
  if (briefs.length === 0) return undefined;
  if (!isCopyForm(pipelines, briefs)) {
    const named = briefs.map((w) => w.text).join(", ");
    return `${GUARD}: copy a brief with a command of its own, one brief at a time: ${COPY_FORMS} (${named}).\nThe guard checks the brief on disk before the command runs, so nothing else may run beside the copy.`;
  }
  const path = briefPath(briefs[0].text, cwd);
  if (!path) return undefined;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code !== MISSING_FILE) return undefined;
    return `${GUARD}: the brief ${path} does not exist yet.\nWrite it with the Write tool, then copy it.`;
  }
  const problems = briefProblems(text);
  return problems.length === 0 ? undefined : notReady(path, problems);
}

function main() {
  let reason;
  try {
    reason = decide(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    return;
  }
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: HOOK_EVENT,
        permissionDecision: DENY,
        permissionDecisionReason: reason,
      },
    }),
  );
}

function isEntry() {
  try {
    return pathToFileURL(realpathSync(process.argv[1] ?? "")).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntry()) main();
