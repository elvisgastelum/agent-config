#!/usr/bin/env node
// agent-config planning guard: a Claude Code PreToolUse hook (Write, Edit, MultiEdit,
// NotebookEdit, Bash, Agent, Task).
//
// Holds a /planning session to planning: once the transcript shows /planning was started, tool
// calls run through the rules in RULES and the first rule that objects denies the call. This file
// holds the activation detection, the shared deny message and the rule pipeline; it ships no rules
// yet.
//
// Any unexpected input or error lets the call through: the guard never breaks a session. The
// transcript is scanned from its first line, so an earlier /planning keeps the guard on after a
// compact summary, a later /continue or a resume.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- activation

/** The skill and slash command that start a planning session. */
export const PLANNING_SKILL = "planning";

/** The tag Claude Code writes into the transcript when the user types /planning. */
export const PLANNING_COMMAND_TAG = "<command-name>/planning</command-name>";

const USER_ENTRY = "user";
const ASSISTANT_ENTRY = "assistant";
const TOOL_USE = "tool_use";
const SKILL_TOOL = "Skill";
const TRANSCRIPT_ENCODING = "utf8";
const LINE_BREAK = "\n";

function startsPlanning(entry) {
  const content = entry?.message?.content;
  if (entry?.type === USER_ENTRY) {
    return typeof content === "string" && content.includes(PLANNING_COMMAND_TAG);
  }
  if (entry?.type === ASSISTANT_ENTRY && Array.isArray(content)) {
    return content.some(
      (item) =>
        item?.type === TOOL_USE &&
        item?.name === SKILL_TOOL &&
        item?.input?.skill === PLANNING_SKILL,
    );
  }
  return false;
}

/** True when the JSONL transcript holds a /planning command or a planning Skill call. */
export function planningActive(text) {
  for (const line of text.split(LINE_BREAK)) {
    if (!line.includes(PLANNING_SKILL)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (startsPlanning(entry)) return true;
  }
  return false;
}

function readTranscript(path) {
  if (typeof path !== "string" || path === "") return "";
  try {
    return readFileSync(path, TRANSCRIPT_ENCODING);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- deny message

const BLOCK_PREFIX = "This session is in planning mode:";
const BLOCK_SUFFIX =
  "Planning only writes the plan in .plans/. To do this work, start a fresh session (/clear or a new session) and run /brief or /continue there.";

/** The deny message every rule shares; `detail` is one sentence saying what was refused. */
export function blockMessage(detail) {
  return `${BLOCK_PREFIX} ${detail} ${BLOCK_SUFFIX}`;
}

// ---------------------------------------------------------------- rules

/**
 * Each rule is `(input) => string | undefined`: a detail sentence to deny the call, or undefined
 * to pass. PSR-4 to PSR-7 add the file-write, shell, git and writer-agent rules here.
 */
export const RULES = [];

/** Returns the reason to deny a tool call, or undefined to let it through. */
export function decide(input, rules = RULES) {
  if (rules.length === 0) return undefined;
  if (!planningActive(readTranscript(input?.transcript_path))) return undefined;
  for (const rule of rules) {
    const detail = rule(input);
    if (detail !== undefined) return blockMessage(detail);
  }
  return undefined;
}

// ---------------------------------------------------------------- hook protocol

const HOOK_EVENT = "PreToolUse";
const DENY = "deny";

function main() {
  let reason;
  try {
    reason = decide(JSON.parse(readFileSync(0, TRANSCRIPT_ENCODING)));
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
