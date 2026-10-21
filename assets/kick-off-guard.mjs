#!/usr/bin/env node
// agent-config kick-off guard: a Claude Code PreToolUse hook (Agent, Task, Bash).
//
// Holds a /kick-off run to its structure:
// - A delegated handoff whose prompt starts with `Phase: <phase>` runs on the rung that phase
//   allows: diagnose, plan and risk on deep; review on deep or balanced, and on fast only when the
//   handoff carries `Fast review: approved by the user`. Edit and fix handoffs are not checked.
// - A Bash command that copies a kick-off brief (`agent-config/kick-off/<ID>.md`) to the clipboard is denied
//   until the brief starts with /continue and has every section and phase the loop needs.
//
// Any unexpected input or error lets the call through: the guard never breaks a session.

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const PHASE = /^Phase:\s*([a-z]+)/i;
const PHASE_RUNGS = {
  diagnose: ["deep"],
  plan: ["deep"],
  risk: ["deep"],
  review: ["deep", "balanced"],
};
const FAST_REVIEW = /^\s*Fast review:\s*approved by the user\b/im;
const LADDER = /^ladder-(?:read|edit)-(fast|balanced|deep)$/;
const MODEL_RUNGS = [
  ["haiku", "fast"],
  ["sonnet", "balanced"],
  ["opus", "deep"],
];
const VARIABLE = /^\$(?:\{(\w+)\}|(\w+))/;

// The brief folder is <state dir>/agent-config/kick-off; the skill's own kick-off folder is not.
const BRIEF_PATH = /(^|\/)agent-config\/kick-off\/[^/]+\.md$/;
const CLIPBOARD =
  /(^|[\s|;&(])(pbcopy|wl-copy|xclip|xsel|clip(\.exe)?|Set-Clipboard)(?=[\s;&|<>)]|$)/;
export const BRIEF_SECTIONS = [
  "# Kick-off:",
  "## Epic",
  "## Queue",
  "## Loop per ticket",
  "## Model routing",
  "## Stop and report",
];
export const BRIEF_PHASES = ["Phase: plan", "Phase: risk", "Phase: review"];

/** Returns the reason to deny a tool call, or undefined to let it through. */
export function decide(input) {
  const tool = input?.tool_name;
  const args = input?.tool_input;
  if ((tool === "Agent" || tool === "Task") && typeof args?.prompt === "string") {
    return handoff(args);
  }
  if (tool === "Bash" && typeof args?.command === "string") return copy(args.command, input.cwd);
  return undefined;
}

/**
 * The rung a handoff runs on: its model override's family (an alias or a full ID), else its ladder
 * agent's rung. An override with no known family (fable) defers to the ladder agent; on any other
 * agent it is denied.
 */
function rungOf(type, model) {
  const name = typeof model === "string" ? model.toLowerCase() : "";
  const family = MODEL_RUNGS.find(([f]) => name.includes(f));
  return family?.[1] ?? LADDER.exec(type ?? "")?.[1];
}

function handoff({ prompt, subagent_type: type, model }) {
  const first = prompt.split("\n").find((line) => line.trim() !== "") ?? "";
  const phase = PHASE.exec(first.trim())?.[1]?.toLowerCase();
  const allowed = PHASE_RUNGS[phase];
  if (!allowed) return undefined;
  const rung = rungOf(type, model);
  if (rung && allowed.includes(rung)) return undefined;
  if (phase === "review" && rung === "fast" && FAST_REVIEW.test(prompt)) return undefined;
  const ran = rung
    ? `the ${rung} rung`
    : `\`${type ?? "the default agent"}\`${model ? ` with model "${model}"` : ""}`;
  const fast =
    phase === "review"
      ? ' A fast review needs the line "Fast review: approved by the user", and only when the user asked for it.'
      : "";
  return `kick-off-guard: a \`Phase: ${phase}\` handoff runs on the ${allowed.join(" or ")} rung, not ${ran}.\nUse ${allowed.map((r) => `ladder-read-${r}`).join(" or ")} without a model override.${fast}`;
}

/** The command's words as the shell passes them: quotes removed, escapes and variables resolved. */
function words(command) {
  const out = [];
  let word = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const variable = c === "$" && quote !== "'" ? VARIABLE.exec(command.slice(i)) : null;
    if (variable) {
      word += process.env[variable[1] ?? variable[2]] ?? "";
      i += variable[0].length - 1;
    } else if (c === "\\" && quote !== "'" && i + 1 < command.length) {
      word += command[++i];
    } else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (/[\s<>|;&()]/.test(c)) {
      if (word) out.push(word);
      word = "";
    } else {
      word += c;
    }
  }
  if (word) out.push(word);
  return out;
}

/** The brief a clipboard command reads, resolved against `cwd`. */
function briefPath(command, cwd) {
  const word = words(command).find((w) => BRIEF_PATH.test(w));
  if (!word) return undefined;
  const path = word.replace(/^~(?=\/)/, homedir());
  if (isAbsolute(path)) return path;
  return typeof cwd === "string" ? join(cwd, path) : undefined;
}

/** What a brief is missing; empty when it is complete. */
export function briefProblems(text) {
  const lines = text.split("\n");
  const first = lines.find((line) => line.trim() !== "")?.trim() ?? "";
  const problems = [];
  if (!/^\/continue(\s|$)/.test(first)) {
    problems.push("its first line must be `/continue` or `/continue parallel <n>`");
  }
  const sections = BRIEF_SECTIONS.filter((s) => !lines.some((line) => line.startsWith(s)));
  if (sections.length > 0) problems.push(`missing sections: ${sections.join(", ")}`);
  const phases = BRIEF_PHASES.filter((p) => !text.includes(p));
  if (phases.length > 0) problems.push(`the loop never names ${phases.join(", ")}`);
  return problems;
}

function copy(command, cwd) {
  if (!CLIPBOARD.test(command)) return undefined;
  const path = briefPath(command, cwd);
  if (!path) return undefined;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const problems = briefProblems(text);
  if (problems.length === 0) return undefined;
  return `kick-off-guard: the brief ${path} is not ready to copy: ${problems.join("; ")}.\nFix it from the template in the kick-off skill, then copy it again.`;
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
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
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
