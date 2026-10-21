#!/usr/bin/env node
// agent-config kick-off guard: a Claude Code PreToolUse hook (Agent, Task, Bash, Write).
//
// Holds a /kick-off run to its structure:
// - A delegated handoff whose prompt starts with `Phase: <phase>` runs on the rung that phase
//   allows: diagnose, plan and risk on deep; review on deep or balanced, and on fast only when the
//   line right under the phase line is `Fast review: approved by the user`. Edit and fix handoffs
//   are not checked.
// - A kick-off brief (`agent-config/kick-off/<ID>.md`) must start with /continue and have every
//   section and phase the loop needs. A Write of a brief is checked before it lands. A Bash
//   pipeline that copies briefs to the clipboard is checked against each brief on disk, and is
//   denied when a brief is missing or written by the same command (the guard runs before it).
//
// Any unexpected input or error lets the call through: the guard never breaks a session. Brief
// paths resolve `$VAR` from the hook's environment, so a variable set inside the same command is
// not seen and that copy goes through unchecked.

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const GUARD = "kick-off-guard";

// ---------------------------------------------------------------- handoffs

/** Claude tools that start a delegated agent; their prompt is the handoff. */
const HANDOFF_TOOLS = new Set(["Agent", "Task"]);

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

/** Ladder agents carry their rung in their name: ladder-read-deep, ladder-edit-fast. */
const LADDER_AGENT = /^ladder-(?:read|edit)-(fast|balanced|deep)$/;
const READ_AGENT_PREFIX = "ladder-read-";

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

/** Briefs live in <state dir>/agent-config/kick-off; the skill's own kick-off folder does not match. */
const BRIEF_PATH = /(^|\/)agent-config\/kick-off\/[^/]+\.md$/;

/** The command a brief opens with: `/continue` or `/continue parallel <n>`. */
const CONTINUE_COMMAND = /^\/continue(\s|$)/;

export const BRIEF_SECTIONS = [
  "# Kick-off:",
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
/** A command that writes its input to every file it names. */
const TEE = "tee";
/** `NAME=value` before a command sets its environment; it is not the command's name. */
const ASSIGNMENT = /^\w+=/;
/** readFileSync's error code for a path that does not exist. */
const MISSING_FILE = "ENOENT";

// Shell syntax the command reader resolves.
const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';
const ESCAPE = "\\";
const VARIABLE_SIGIL = "$";
/** `$NAME` or `${NAME}`. */
const SHELL_VARIABLE = /^\$(?:\{(\w+)\}|(\w+))/;
/** Operators that end a pipeline (`&&` and `||` before `&` and `|`, which they start with). */
const LIST_OPERATORS = ["&&", "||", ";", "&", "\n"];
/** Joins the commands of one pipeline. */
const PIPE = "|";
const OUTPUT_REDIRECT = ">";
const INPUT_REDIRECT = "<";
/** Characters that end a word without other meaning here: whitespace and subshell parentheses. */
const WORD_BREAK = /[\s()]/;
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
 * The rung a handoff runs on: its model override's family, else its ladder agent's rung. An
 * override with no known family (fable) defers to the ladder agent; on any other agent it is denied.
 */
function rungOf(type, model) {
  const name = typeof model === "string" ? model.toLowerCase() : "";
  const family = MODEL_FAMILY_RUNGS.find(([f]) => name.includes(f));
  return family?.[1] ?? LADDER_AGENT.exec(type ?? "")?.[1];
}

function handoff({ prompt, subagent_type: type, model }) {
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
  const agents = allowed.map((r) => `${READ_AGENT_PREFIX}${r}`).join(" or ");
  const fast = review
    ? ` A fast review needs the line "${FAST_REVIEW_APPROVAL}" right under the phase line, and only when the user asked for it.`
    : "";
  return `${GUARD}: a \`Phase: ${phase}\` handoff runs on the ${allowed.join(" or ")} rung, not ${ran}.\nUse ${agents} without a model override.${fast}`;
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
  return `${GUARD}: the brief ${path} is not ready: ${problems.join("; ")}.\nFix it from the template in the kick-off skill.`;
}

function write({ file_path: path, content }) {
  if (!BRIEF_PATH.test(path) || typeof content !== "string") return undefined;
  const problems = briefProblems(content);
  return problems.length === 0 ? undefined : notReady(path, problems);
}

/**
 * Splits a command line the way the shell does: pipelines of commands of words, with quotes
 * removed, escapes and variables resolved, and each output redirect's target marked.
 */
function parse(command) {
  const pipelines = [[[]]];
  let word = "";
  let quote = "";
  let redirect = "";
  const end = () => {
    if (word)
      pipelines
        .at(-1)
        .at(-1)
        .push({ text: word, output: redirect === OUTPUT_REDIRECT });
    if (word) redirect = "";
    word = "";
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const expands = quote !== SINGLE_QUOTE;
    const variable = expands && c === VARIABLE_SIGIL ? SHELL_VARIABLE.exec(command.slice(i)) : null;
    const list = quote ? undefined : LIST_OPERATORS.find((op) => command.startsWith(op, i));
    if (variable) {
      word += process.env[variable[1] ?? variable[2]] ?? "";
      i += variable[0].length - 1;
    } else if (expands && c === ESCAPE && i + 1 < command.length) {
      word += command[++i];
    } else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === SINGLE_QUOTE || c === DOUBLE_QUOTE) {
      quote = c;
    } else if (list) {
      end();
      pipelines.push([[]]);
      i += list.length - 1;
    } else if (c === PIPE) {
      end();
      pipelines.at(-1).push([]);
    } else if (c === OUTPUT_REDIRECT || c === INPUT_REDIRECT) {
      end();
      redirect = c;
    } else if (WORD_BREAK.test(c)) {
      end();
    } else {
      word += c;
    }
  }
  end();
  return pipelines;
}

/** A command's name: its first word that is not an environment assignment. */
function commandName(words) {
  return words.find((w) => !ASSIGNMENT.test(w.text))?.text ?? "";
}

/** A brief word's path, resolved against `cwd`; undefined for other words. */
function briefPath(text, cwd) {
  if (!BRIEF_PATH.test(text)) return undefined;
  const path = text.replace(HOME_TILDE, homedir());
  if (isAbsolute(path)) return path;
  return typeof cwd === "string" ? join(cwd, path) : undefined;
}

function copy(command, cwd) {
  const pipelines = parse(command);
  const commands = pipelines.flat();
  const written = new Set(
    commands.flatMap((words) =>
      words
        .filter((w) => w.output || commandName(words) === TEE)
        .map((w) => briefPath(w.text, cwd))
        .filter(Boolean),
    ),
  );
  const copied = pipelines.filter((p) =>
    p.some((words) => CLIPBOARD_TOOLS.has(basename(commandName(words)))),
  );
  const read = new Set(
    copied
      .flat(2)
      .filter((w) => !w.output)
      .map((w) => briefPath(w.text, cwd))
      .filter(Boolean),
  );
  const rewritten = [...read].filter((path) => written.has(path));
  if (rewritten.length > 0) {
    return `${GUARD}: write the brief and copy it in separate commands (${rewritten.join(", ")}): the guard checks the brief on disk before this command runs.\nWrite it with the Write tool, then copy it.`;
  }
  for (const path of read) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (error?.code === MISSING_FILE) {
        return `${GUARD}: the brief ${path} does not exist yet.\nWrite it with the Write tool, then copy it.`;
      }
      continue;
    }
    const problems = briefProblems(text);
    if (problems.length > 0) return notReady(path, problems);
  }
  return undefined;
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
