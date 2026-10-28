#!/usr/bin/env node
// agent-config planning guard: a Claude Code PreToolUse hook (Write, Edit, MultiEdit,
// NotebookEdit, Bash, Agent, Task).
//
// Holds a /planning session to planning: once the transcript shows /planning was started, tool
// calls run through the rules in RULES and the first rule that objects denies the call. This file
// holds the activation detection, the shared deny message, the rule pipeline, the file-write
// rule (with planning active, file edits are denied unless they land under .plans/ at the
// repository root) and the writer-agent rule (sub-agents on the WRITER_AGENTS denylist, or
// started without subagent_type, are denied).
//
// Unexpected hook input or an error outside a rule lets the call through: the guard never breaks
// a session. Inside a rule, a malformed call it guards (no file path, no subagent_type) fails
// closed and is denied. The
// transcript is scanned from its first line, so an earlier /planning keeps the guard on after a
// compact summary, a later /continue or a resume.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

// ---------------------------------------------------------------- file writes

/** The tools that write files. */
export const FILE_WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** The only folder, relative to the repository root, planning may write in. */
export const PLANS_DIR = ".plans";

/** The detail the file-write rule denies with. */
export const FILE_WRITE_DETAIL =
  "file writes are allowed only under .plans/ at the repository root.";

const NOTEBOOK_TOOL = "NotebookEdit";
const NOTEBOOK_PATH_FIELD = "notebook_path";
const FILE_PATH_FIELD = "file_path";
const GIT_COMMAND = "git";
const GIT_ROOT_ARGS = ["rev-parse", "--show-toplevel"];
const PARENT_SEGMENT = "..";
const HOME_PREFIX = "~";
const GIT_ENV_PREFIX = "GIT_";

/** The environment without GIT_* variables, so GIT_DIR or GIT_WORK_TREE cannot move the root. */
function cleanGitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith(GIT_ENV_PREFIX)),
  );
}

/** The repository root containing `cwd`, or `cwd` itself when git cannot tell. */
export function repoRoot(cwd) {
  try {
    const root = execFileSync(GIT_COMMAND, GIT_ROOT_ARGS, {
      cwd,
      env: cleanGitEnv(),
      encoding: TRANSCRIPT_ENCODING,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root === "" ? cwd : root;
  } catch {
    return cwd;
  }
}

/**
 * The real location of `path`: the deepest existing ancestor is resolved through symlinks and the
 * missing tail is re-joined onto it. Undefined when an entry exists but cannot be resolved.
 */
function realOf(path) {
  let candidate = path;
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(candidate), ...tail);
    } catch {
      try {
        lstatSync(candidate);
        return undefined;
      } catch {
        // the entry does not exist: try its parent
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    tail.unshift(basename(candidate));
    candidate = parent;
  }
}

/** True when `path` really lands strictly inside `.plans/` at the repository root of `cwd`. */
export function underPlans(path, cwd) {
  // Claude Code file tools may expand a leading ~ to the home folder, so fail closed.
  if (path.startsWith(HOME_PREFIX)) return false;
  const target = realOf(resolve(cwd, path));
  const root = realOf(repoRoot(cwd));
  if (target === undefined || root === undefined) return false;
  const rel = relative(join(root, PLANS_DIR), target);
  return (
    rel !== "" &&
    rel !== PARENT_SEGMENT &&
    !rel.startsWith(PARENT_SEGMENT + sep) &&
    !isAbsolute(rel)
  );
}

/** Denies a file write unless it lands under .plans/; fails closed on any error. */
export function fileWriteRule(input) {
  if (!FILE_WRITE_TOOLS.has(input?.tool_name)) return undefined;
  try {
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const field = input.tool_name === NOTEBOOK_TOOL ? NOTEBOOK_PATH_FIELD : FILE_PATH_FIELD;
    const path = input.tool_input?.[field];
    if (typeof path !== "string" || path === "") return FILE_WRITE_DETAIL;
    return underPlans(path, cwd) ? undefined : FILE_WRITE_DETAIL;
  } catch {
    return FILE_WRITE_DETAIL;
  }
}

// ---------------------------------------------------------------- writer sub-agents

/** The tools that start a sub-agent. */
export const AGENT_TOOLS = new Set(["Agent", "Task"]);

/** Marks a WRITER_AGENTS entry as a prefix: "ladder-edit-*" matches every ladder-edit rung. */
export const AGENT_WILDCARD = "*";

/**
 * The denylist of sub-agents that can write. Every other agent passes. Add a new writer agent
 * here. A call without subagent_type starts general-purpose, so it is denied too.
 */
export const WRITER_AGENTS = ["ladder-edit-*", "ladder-orchestrator", "general-purpose"];

/** How the denial names a call that has no subagent_type. */
export const MISSING_AGENT_TYPE = "general-purpose (no subagent_type)";

const SUBAGENT_TYPE_FIELD = "subagent_type";
const NAMESPACE_SEPARATOR = ":";

/** The detail the writer-agent rule denies with; `type` is the agent named in the call. */
export function writerAgentDetail(type) {
  return `the sub-agent ${type} can write files, so it cannot start; read-only agents such as planners, readers, explorers, researchers and reviewers still run.`;
}

/** The bare, lower-case agent name: a plugin namespace ("plugin:agent") is dropped. */
function agentName(type) {
  const name = type.trim().toLowerCase();
  return name.slice(name.lastIndexOf(NAMESPACE_SEPARATOR) + 1);
}

function isWriterAgent(name) {
  return WRITER_AGENTS.some((entry) =>
    entry.endsWith(AGENT_WILDCARD)
      ? name.startsWith(entry.slice(0, -AGENT_WILDCARD.length))
      : name === entry,
  );
}

/** Denies starting a sub-agent on the WRITER_AGENTS denylist or without subagent_type. */
export function writerAgentRule(input) {
  if (!AGENT_TOOLS.has(input?.tool_name)) return undefined;
  try {
    const type = input.tool_input?.[SUBAGENT_TYPE_FIELD];
    if (typeof type !== "string" || type.trim() === "")
      return writerAgentDetail(MISSING_AGENT_TYPE);
    return isWriterAgent(agentName(type)) ? writerAgentDetail(type) : undefined;
  } catch {
    return writerAgentDetail(MISSING_AGENT_TYPE);
  }
}

// ---------------------------------------------------------------- rules

/**
 * Each rule is `(input) => string | undefined`: a detail sentence to deny the call, or undefined
 * to pass. PSR-5 and PSR-6 add the shell and git rules here.
 */
export const RULES = [fileWriteRule, writerAgentRule];

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
