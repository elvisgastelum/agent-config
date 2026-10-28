#!/usr/bin/env node
// agent-config planning guard: a Claude Code PreToolUse hook (Write, Edit, MultiEdit,
// NotebookEdit, Bash, Agent, Task).
//
// Holds a /planning session to planning: once the transcript shows /planning was started, tool
// calls run through the rules in RULES and the first rule that objects denies the call. This file
// holds the activation detection, the shared deny message, the rule pipeline, the file-write
// rule (with planning active, file edits are denied unless they land under .plans/ at the
// repository root), the writer-agent rule (sub-agents on the WRITER_AGENTS denylist, or
// started without subagent_type, are denied) and the shell-write rule (Bash commands that write
// outside .plans/ are denied: redirects, known writing commands, wrapped, nested and substituted
// commands).
//
// Unexpected hook input or an error outside a rule lets the call through: the guard never breaks
// a session. Inside a rule, a malformed call it guards (no file path, no subagent_type) fails
// closed and is denied. The
// transcript is scanned from its first line, so an earlier /planning keeps the guard on after a
// compact summary, a later /continue or a resume.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ASSIGNMENT,
  DOUBLE_QUOTE,
  ESCAPE,
  HEREDOC,
  INPUT_REDIRECT,
  NEWLINE,
  OPTION_PREFIX,
  SINGLE_QUOTE,
  WRAPPERS,
  afterHeredocs,
  parse,
} from "./shell-split.mjs";

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

/** `path` itself, or its nearest ancestor that is an existing folder. */
function existingDir(path) {
  let candidate = path;
  for (;;) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // the entry does not exist: try its parent
    }
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
}

/**
 * The repository root containing `cwd`, or `cwd` itself when git cannot tell. Git runs from the
 * nearest existing folder, so a `cd` into a folder a command creates first keeps the root.
 */
export function repoRoot(cwd) {
  try {
    const root = execFileSync(GIT_COMMAND, GIT_ROOT_ARGS, {
      cwd: existingDir(cwd),
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

// ---------------------------------------------------------------- shell writes

/** The detail the shell-write rule denies with. */
export const SHELL_WRITE_DETAIL =
  "shell commands may write only under .plans/ at the repository root.";

/** The detail the shell rule denies a git history, branch or checked-out tree change with. */
export const GIT_WRITE_DETAIL =
  "git may not change history, branches or the checked-out tree; read forms such as git status, git diff, git log and git branch --list pass.";

const SHELL_TOOL = "Bash";
const COMMAND_FIELD = "command";
const MAX_DEPTH = 8;

/** Redirect targets that are not files on disk. */
const NON_FILE_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/** Commands that change the working directory for the commands after them. */
const CD_COMMANDS = new Set(["cd", "pushd"]);
/** `popd` returns to a directory the guard does not track. */
const POPD_COMMAND = "popd";
const PREVIOUS_DIR = "-";

// Command substitution syntax.
const SUBSTITUTION_OPENERS = ["$(", "<(", ">("];
const OPEN_PAREN = "(";
/** The characters that make a `(` a substitution rather than a subshell. */
const SUBSTITUTION_PREFIXES = ["$", "<", ">"];
const CLOSE_PAREN = ")";
const BACKTICK = "`";

/** Stands in for a variable reference: its value is unknown, so a path holding it is outside .plans/. */
const UNKNOWN_VALUE = "\u0000var";
/** `$NAME`, `${...}`, `$1`, `$@`, `$?`...; `$(` is a command substitution, not a variable. */
const VARIABLE_REFERENCE = /^\$(?:\{[^}]*\}|\w+|[@*#?$!-])/;

/** The delimiter word after `<<`: quoted (`'EOF'`, `"EOF"`, `\EOF`) bodies never expand. */
const HEREDOC_DELIMITER = /^[ \t]*(?:(["'])(.*?)\1|(\\)?([^\s"'();&|<>]+))/;

/** Words that only shape control flow: they are skipped before the command name. */
const RESERVED_WORDS = new Set([
  "{",
  "}",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "case",
  "esac",
  "in",
  "function",
]);
/** `for NAME in LIST` and `select NAME in LIST`: the whole command is a loop head, the list is data. */
const LOOP_HEAD_WORDS = new Set(["for", "select"]);
/** `case` arms and function bodies hide commands behind patterns and names: every word is tried. */
const CASE_WORD = "case";
const CASE_END_WORD = "esac";
const BLOCK_OPEN_WORD = "{";

/** Wrappers beyond the shared WRAPPERS that run the command after them. */
const EXTRA_WRAPPERS = new Set(["timeout", "nice", "doas", "stdbuf", "ionice", "caffeinate"]);
/** Wrapper options that take the next word as their value. */
const WRAPPER_VALUE_OPTIONS = new Map([
  ["sudo", new Set(["-u", "-g"])],
  ["env", new Set(["-u"])],
  ["nice", new Set(["-n"])],
  ["doas", new Set(["-u"])],
  ["timeout", new Set(["-s", "-k"])],
  ["stdbuf", new Set(["-i", "-o", "-e"])],
  ["ionice", new Set(["-c", "-n"])],
  ["caffeinate", new Set(["-t", "-w"])],
]);
/** Wrappers whose first operand is not the command (`timeout DURATION command`). */
const OPERAND_WRAPPERS = new Set(["timeout"]);

/** xargs options that take the next word as their value. */
const XARGS_VALUE_OPTIONS = new Set(["-I", "-n", "-P", "-L", "-d", "-s", "-E"]);

/** chmod and chown take the mode or owner first; the rest are the paths they write. */
const MODE_COMMANDS = ["chmod", "chown"];
/** A mode such as `-x` looks like an option but is the mode operand. */
const NEGATIVE_MODE = /^-[rwxXst]+$/;

/** Commands whose every non-option operand is a path they write. */
const PATH_COMMANDS = [
  "tee",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "ln",
  "install",
  "truncate",
  "unlink",
  "rsync",
];

/** `sed -i`, `-i.bak`, `-Ei`: a short-option cluster holding `i`. */
const SED_SHORT_IN_PLACE = /^-[^-]*i/;
const SED_IN_PLACE = "--in-place";
const DD_OUTPUT_PREFIX = "of=";

/** curl writes a file with `-o`, `-O`, `-sSLo` or the long forms. */
const CURL_SHORT_OUTPUT = /^-[^-]*[oO]/;
const CURL_OUTPUT_OPTIONS = new Set(["--output", "--remote-name", "--remote-name-all"]);
const CURL_OUTPUT_PREFIX = "--output=";

/** wget prints to stdout only with `-O -`, `-O-`, `-qO-` or `--output-document=-`. */
const WGET_STDOUT_CLUSTER = /^-[^-]*O-$/;
const WGET_OUTPUT_CLUSTER = /^-[^-]*O$/;
const WGET_STDOUT_LONG = "--output-document=-";
const STDOUT_DASH = "-";

/** Git global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

/** Git subcommands that write the working tree. */
export const GIT_WRITE_SUBCOMMANDS = new Set(["apply", "clean", "mv", "restore", "rm"]);

/** Git subcommands that change history, branches or the checked-out tree in every form. */
export const GIT_HISTORY_SUBCOMMANDS = new Set([
  "commit",
  "push",
  "pull",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
  "reset",
  "checkout",
  "switch",
  "update-ref",
  "symbolic-ref",
  "filter-branch",
  "replace",
]);

const GIT_BRANCH = "branch";
const GIT_TAG = "tag";
const GIT_STASH = "stash";
const GIT_WORKTREE = "worktree";
/** `git stash` and `git worktree` read with these first operands only. */
const GIT_STASH_READS = new Set(["list", "show"]);
const GIT_WORKTREE_READS = new Set(["list"]);
/** `git branch` and `git tag` list instead of creating with these options. */
const GIT_LIST_OPTIONS = new Set(["--list", "-l"]);
const GIT_LONG_PREFIX = "--";
const GIT_VALUE_SEPARATOR = "=";
/** The only long options `git branch` and `git tag` may take; any other (or a unique prefix of one) denies. */
const GIT_LISTING_LONG_OPTIONS = [
  "--list",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
  "--column",
  "--no-column",
  "--color",
  "--no-color",
  "--ignore-case",
];
const GIT_BRANCH_READ_LONG_OPTIONS = new Set([
  ...GIT_LISTING_LONG_OPTIONS,
  "--all",
  "--remotes",
  "--verbose",
  "--show-current",
  "--abbrev",
  "--no-abbrev",
]);
const GIT_TAG_READ_LONG_OPTIONS = new Set(GIT_LISTING_LONG_OPTIONS);
/** Letters a short-option word of a listing form may hold. */
const GIT_BRANCH_READ_LETTERS = /^-[arlvi]+$/;
const GIT_TAG_READ_LETTERS = /^-[lni0-9]+$/;
const GIT_LIST_LETTER = "l";
/** Listing options of `git branch` and `git tag` that take the next word as their value. */
const GIT_LIST_VALUE_OPTIONS = new Set([
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
]);

/** sqlite3 options that take the next word as their value (single- or double-dash spelling). */
const SQLITE_VALUE_OPTIONS = new Set(
  [
    "cmd",
    "init",
    "separator",
    "newline",
    "nullvalue",
    "vfs",
    "mmap",
    "maxsize",
    "lookaside",
    "pagecache",
    "heap",
  ].flatMap((name) => [`-${name}`, `--${name}`]),
);
const SQLITE_COMMANDS = ["sqlite3"];
/** Interpreter names that get the python check: python, python3, python3.12... */
const PYTHON_NAME = /^python[0-9.]*$/;
const PYTHON_COMMAND = "python";
/** A short cluster ending in `m` (`-m`, `-Im`), and one ending in `msqlite3` (`-msqlite3`). */
const PYTHON_MODULE_CLUSTER = /^-[A-Za-z]*m$/;
const PYTHON_SQLITE_CLUSTER = /^-[A-Za-z]*msqlite3$/;
/** sqlite3 opens `file:` URIs, which can name any path. */
const SQLITE_URI_PREFIX = "file:";
const SQLITE_MODULE = "sqlite3";

const PACKAGE_MANAGERS = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "vp",
  "pip",
  "pip3",
  "pipx",
  "uv",
  "brew",
  "apt",
  "apt-get",
  "dnf",
  "yum",
  "gem",
  "cargo",
  "go",
  "composer",
];
const INSTALL_SUBCOMMANDS = new Set([
  "install",
  "i",
  "add",
  "ci",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "upgrade",
  "up",
  "link",
  "sync",
]);
/** `yarn` and `bun` with no subcommand install. */
const BARE_INSTALL_MANAGERS = new Set(["yarn", "bun"]);

const SHELLS = ["sh", "bash", "zsh", "dash", "ksh"];
const SHELL_COMMAND_OPTION = /^-[^-]*c/;
const EVAL_COMMAND = "eval";
const ARGUMENT_SEPARATOR = " ";

const FIND_WRITE_ACTIONS = new Set(["-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const FIND_EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** The non-option words: the operands of a command. */
const operands = (args) => args.filter((arg) => !arg.startsWith(OPTION_PREFIX));

/** True when `path` is not under .plans/; a relative path is outside once the folder is unknown. */
function outsidePlans(path, cwd) {
  if (path.includes(UNKNOWN_VALUE)) return true;
  if (cwd === undefined) return !isAbsolute(path) || !underPlans(path, process.cwd());
  return !underPlans(path, cwd);
}

const writesPaths = (args, cwd) => operands(args).some((path) => outsidePlans(path, cwd));

/** chmod / chown: the mode or owner is not a path, so it is left out of the operands. */
function writesPathsAfterMode(args, cwd) {
  const mode = args.findIndex((arg) => NEGATIVE_MODE.test(arg) || !arg.startsWith(OPTION_PREFIX));
  return writesPaths(
    args.filter((_, i) => i !== mode),
    cwd,
  );
}

/** The index of the first word from `from` that is not an option, skipping the values of `valueOptions`; -1 when none. */
function firstOperand(words, from, valueOptions) {
  for (let i = from; i < words.length; i++) {
    if (!words[i].startsWith(OPTION_PREFIX)) return i;
    if (valueOptions?.has(words[i])) i++;
  }
  return -1;
}

function sedWrites(args) {
  return args.some(
    (arg) =>
      arg === SED_IN_PLACE || arg.startsWith(`${SED_IN_PLACE}=`) || SED_SHORT_IN_PLACE.test(arg),
  );
}

function curlWrites(args) {
  return args.some(
    (arg) =>
      CURL_OUTPUT_OPTIONS.has(arg) ||
      arg.startsWith(CURL_OUTPUT_PREFIX) ||
      CURL_SHORT_OUTPUT.test(arg),
  );
}

function wgetWrites(args) {
  const toStdout = args.some(
    (arg, i) =>
      arg === WGET_STDOUT_LONG ||
      WGET_STDOUT_CLUSTER.test(arg) ||
      (WGET_OUTPUT_CLUSTER.test(arg) && args[i + 1] === STDOUT_DASH),
  );
  return !toStdout;
}

/**
 * True when `args` (after `git branch` / `git tag`) create, change or delete: any option outside
 * the read set, an unknown word, or an operand without a list option.
 */
function gitCreates(args, readLong, readLetters) {
  let listed = false;
  let operandSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes(UNKNOWN_VALUE)) return true;
    if (arg.startsWith(GIT_LONG_PREFIX)) {
      const [name] = arg.split(GIT_VALUE_SEPARATOR);
      if (!readLong.has(name)) return true;
      if (GIT_LIST_OPTIONS.has(name)) listed = true;
      if (GIT_LIST_VALUE_OPTIONS.has(name) && !arg.includes(GIT_VALUE_SEPARATOR)) i++;
    } else if (arg.startsWith(OPTION_PREFIX)) {
      if (!readLetters.test(arg)) return true;
      if (arg.includes(GIT_LIST_LETTER)) listed = true;
    } else operandSeen = true;
  }
  return operandSeen && !listed;
}

function gitWrites(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes(UNKNOWN_VALUE)) return GIT_WRITE_DETAIL;
    if (GIT_VALUE_OPTIONS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith(OPTION_PREFIX)) continue;
    const rest = args.slice(i + 1);
    if (GIT_WRITE_SUBCOMMANDS.has(arg)) return true;
    if (GIT_HISTORY_SUBCOMMANDS.has(arg)) return GIT_WRITE_DETAIL;
    if (arg === GIT_BRANCH)
      return gitCreates(rest, GIT_BRANCH_READ_LONG_OPTIONS, GIT_BRANCH_READ_LETTERS)
        ? GIT_WRITE_DETAIL
        : false;
    if (arg === GIT_TAG)
      return gitCreates(rest, GIT_TAG_READ_LONG_OPTIONS, GIT_TAG_READ_LETTERS)
        ? GIT_WRITE_DETAIL
        : false;
    if (arg === GIT_STASH) return GIT_STASH_READS.has(rest[0]) ? false : GIT_WRITE_DETAIL;
    if (arg === GIT_WORKTREE) return GIT_WORKTREE_READS.has(rest[0]) ? false : GIT_WRITE_DETAIL;
    return false;
  }
  return false;
}

/** sqlite3 writes unless its database (the first operand) is a file under .plans/. */
function sqliteWrites(args, cwd) {
  const at = firstOperand(args, 0, SQLITE_VALUE_OPTIONS);
  return (
    at === -1 || args[at].toLowerCase().startsWith(SQLITE_URI_PREFIX) || outsidePlans(args[at], cwd)
  );
}

/** `python -m sqlite3 <db>` gets the sqlite3 database check; any other python invocation passes. */
function pythonWrites(args, cwd) {
  for (let i = 0; i < args.length; i++) {
    if (PYTHON_SQLITE_CLUSTER.test(args[i])) return sqliteWrites(args.slice(i + 1), cwd);
    if (PYTHON_MODULE_CLUSTER.test(args[i]) && args[i + 1] === SQLITE_MODULE)
      return sqliteWrites(args.slice(i + 2), cwd);
  }
  return false;
}

const managerWrites = (name) => (args) => {
  const words = operands(args);
  if (words.length === 0) return BARE_INSTALL_MANAGERS.has(name);
  return words.some((word) => INSTALL_SUBCOMMANDS.has(word));
};

function shellWrites(args, cwd, depth) {
  const at = args.findIndex((arg) => SHELL_COMMAND_OPTION.test(arg));
  const script = at === -1 ? undefined : args[at + 1];
  if (script === undefined) return false;
  return script.includes(UNKNOWN_VALUE) || commandWrites(script, cwd, depth + 1);
}

/** The verdict of the command in `words` (see SHELL_WRITE_COMMANDS); `extra` are operands the caller appends (xargs input). */
function runsWriter(words, cwd, depth, extra = []) {
  const command = commandWords(words);
  if (!command) return false;
  return writerFor(command.name)?.([...command.args, ...extra], cwd, depth);
}

/** xargs runs the first non-option word with unknown operands appended. */
function xargsWrites(args, cwd, depth) {
  const at = firstOperand(args, 0, XARGS_VALUE_OPTIONS);
  return at !== -1 && runsWriter(args.slice(at), cwd, depth, [UNKNOWN_VALUE]);
}

function findWrites(args, cwd, depth) {
  if (args.some((arg) => FIND_WRITE_ACTIONS.has(arg))) return true;
  for (let i = 0; i < args.length; i++) {
    const verdict = FIND_EXEC_ACTIONS.has(args[i]) && runsWriter(args.slice(i + 1), cwd, depth);
    if (verdict) return verdict;
  }
  return false;
}

/**
 * Each command that can write, by name: `(args, cwd, depth) => verdict`. A verdict is `true` when
 * it writes outside .plans/ (SHELL_WRITE_DETAIL), a detail string to deny with that detail, or
 * falsy to pass.
 */
export const SHELL_WRITE_COMMANDS = new Map([
  ...PATH_COMMANDS.map((name) => [name, writesPaths]),
  ...MODE_COMMANDS.map((name) => [name, writesPathsAfterMode]),
  ["patch", () => true],
  ["sed", sedWrites],
  ["dd", (args) => args.some((arg) => arg.startsWith(DD_OUTPUT_PREFIX))],
  ["curl", curlWrites],
  ["wget", wgetWrites],
  ["git", gitWrites],
  ...SQLITE_COMMANDS.map((name) => [name, sqliteWrites]),
  [PYTHON_COMMAND, pythonWrites],
  ...PACKAGE_MANAGERS.map((name) => [name, managerWrites(name)]),
  ...SHELLS.map((name) => [name, shellWrites]),
  [
    EVAL_COMMAND,
    (args, cwd, depth) => {
      const script = args.join(ARGUMENT_SEPARATOR);
      return script.includes(UNKNOWN_VALUE) || commandWrites(script, cwd, depth + 1);
    },
  ],
  ["xargs", xargsWrites],
  ["find", findWrites],
]);

/** The writer check for a command name: a python interpreter name (python3.12) resolves to the python check. */
const writerFor = (name) =>
  SHELL_WRITE_COMMANDS.get(PYTHON_NAME.test(name) ? PYTHON_COMMAND : name) ??
  SHELL_WRITE_COMMANDS.get(name);

/**
 * A command's name and arguments, past assignments, control-flow words and wrappers (with their
 * options); undefined for a loop head. The first non-option word after a wrapper is the command.
 */
function commandWords(words) {
  for (let i = 0; i < words.length; i++) {
    const text = words[i];
    const name = basename(text);
    if (ASSIGNMENT.test(text) || RESERVED_WORDS.has(text)) continue;
    if (LOOP_HEAD_WORDS.has(text)) return undefined;
    if (!WRAPPERS.has(name) && !EXTRA_WRAPPERS.has(name)) return { name, args: words.slice(i + 1) };
    const operand = firstOperand(words, i + 1, WRAPPER_VALUE_OPTIONS.get(name));
    i = (operand === -1 ? words.length : operand) - 1;
    if (OPERAND_WRAPPERS.has(name)) i++;
  }
  return undefined;
}

/** The index just past the `)` closing the `(` before `from`, or the end of the text. */
function closingParen(text, from) {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === OPEN_PAREN) depth++;
    else if (text[i] === CLOSE_PAREN && --depth === 0) return i;
  }
  return text.length;
}

/**
 * The quoting around each character: the single or double quote it sits in, ESCAPE for a
 * backslash-escaped one, "" outside quotes. Heredoc bodies count as single-quoted when the
 * delimiter is quoted (nothing expands) and as double-quoted otherwise.
 */
function quoteKinds(command) {
  const kinds = Array.from({ length: command.length }, () => "");
  const pending = [];
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    kinds[i] = quote;
    if (quote === SINGLE_QUOTE) {
      if (c === SINGLE_QUOTE) quote = "";
    } else if (c === ESCAPE) {
      if (i + 1 < command.length) kinds[++i] = ESCAPE;
    } else if (c === SINGLE_QUOTE && !quote) {
      quote = SINGLE_QUOTE;
    } else if (c === DOUBLE_QUOTE) {
      quote = quote ? "" : DOUBLE_QUOTE;
    } else if (!quote && c === INPUT_REDIRECT && HEREDOC.test(command.slice(i))) {
      const operator = HEREDOC.exec(command.slice(i))[0];
      const word = HEREDOC_DELIMITER.exec(command.slice(i + operator.length));
      if (word)
        pending.push({ delimiter: word[2] ?? word[4], quoted: Boolean(word[1] || word[3]) });
      i += operator.length - 1;
    } else if (!quote && c === NEWLINE && pending.length > 0) {
      let at = i + 1;
      for (const { delimiter, quoted } of pending.splice(0)) {
        const end = afterHeredocs(command, at, [delimiter]);
        kinds.fill(quoted ? SINGLE_QUOTE : DOUBLE_QUOTE, at, end);
        at = end;
      }
      i = at - 1;
    }
  }
  return kinds;
}

/** The `$( )`, backtick, `<( )` and `>( )` substitutions outside single quotes (double quotes still run them). */
function substitutions(command, kinds) {
  const found = [];
  for (let i = 0; i < command.length; i++) {
    if (kinds[i] === SINGLE_QUOTE || kinds[i] === ESCAPE) continue;
    if (command[i] === BACKTICK) {
      let end = i + 1;
      while (end < command.length && command[end] !== BACKTICK)
        end += command[end] === ESCAPE ? 2 : 1;
      found.push({ from: i, to: end + 1, body: command.slice(i + 1, end) });
      i = end;
    } else {
      const opener = SUBSTITUTION_OPENERS.find((open) => command.startsWith(open, i));
      if (!opener) continue;
      const start = i + opener.length;
      const end = closingParen(command, start);
      found.push({ from: i, to: end + 1, body: command.slice(start, end) });
      i = start - 1;
    }
  }
  return found;
}

/** True when a `(` outside quotes opens a subshell (not a substitution), where a `cd` does not last. */
function hasSubshell(command, kinds) {
  return [...command].some(
    (c, i) =>
      c === OPEN_PAREN && kinds[i] === "" && !SUBSTITUTION_PREFIXES.includes(command[i - 1]),
  );
}

/**
 * Replaces each variable reference outside single quotes and each outermost substitution with
 * UNKNOWN_VALUE: the guard cannot know either value (substitution bodies are checked on their own).
 */
function maskUnknowns(command, kinds, found) {
  let masked = "";
  for (let i = 0; i < command.length; i++) {
    const inner = found.find((sub) => sub.from === i);
    const variable =
      kinds[i] === SINGLE_QUOTE || kinds[i] === ESCAPE
        ? null
        : VARIABLE_REFERENCE.exec(command.slice(i));
    if (inner) {
      masked += UNKNOWN_VALUE;
      i = Math.min(inner.to, command.length) - 1;
    } else if (variable) {
      masked += UNKNOWN_VALUE;
      i += variable[0].length - 1;
    } else {
      masked += command[i];
    }
  }
  return masked;
}

/** The first word that is not an assignment or control-flow word (`case` and `esac` count). */
const leadingWord = (words) =>
  words.find(
    (text) =>
      !ASSIGNMENT.test(text) &&
      (text === CASE_WORD || text === CASE_END_WORD || !RESERVED_WORDS.has(text)),
  );

/** The folder after `cd dir`; undefined when it cannot be known. */
function changeDir(args, cwd) {
  const dir = operands(args)[0];
  if (cwd === undefined || dir === undefined) return undefined;
  if (dir === PREVIOUS_DIR || dir.startsWith(HOME_PREFIX) || dir.includes(UNKNOWN_VALUE))
    return undefined;
  return resolve(cwd, dir);
}

/** `true` is a file write; a string already is the detail. */
const verdictDetail = (verdict) => (verdict === true ? SHELL_WRITE_DETAIL : verdict);

/** The detail to deny with when running `command` from `cwd` writes; undefined when it passes. */
function commandWrites(command, cwd, depth) {
  if (depth > MAX_DEPTH) return SHELL_WRITE_DETAIL;
  const kinds = quoteKinds(command);
  const found = substitutions(command, kinds);
  for (const { body } of found) {
    const inner = commandWrites(body, cwd, depth + 1);
    if (inner) return inner;
  }
  const subshell = hasSubshell(command, kinds);
  let inCase = false;
  let here = cwd;
  for (const pipeline of parse(maskUnknowns(command, kinds, found))) {
    for (const words of pipeline) {
      if (
        words.some(
          (word) =>
            word.output && !NON_FILE_TARGETS.has(word.text) && outsidePlans(word.text, here),
        )
      )
        return SHELL_WRITE_DETAIL;
      const named = words.filter((word) => !word.output && !word.input);
      const texts = named.map((word) => word.text);
      const lead = leadingWord(texts);
      if (lead === CASE_WORD) inCase = true;
      else if (lead === CASE_END_WORD) inCase = false;
      // Inside a case, or after a `{` that opens a function body, any word may start a command.
      const hidden = inCase || texts.indexOf(BLOCK_OPEN_WORD, 1) > 0;
      if (hidden) {
        for (let k = 0; k < texts.length; k++) {
          const verdict = runsWriter(texts.slice(k), here, depth);
          if (verdict) return verdictDetail(verdict);
        }
      }
      const parsed = commandWords(texts);
      if (!parsed) continue;
      const { name, args } = parsed;
      // A cd inside a subshell would not last, so with any subshell the folder is unknown:
      // `(cd .plans && rm x)` is denied on purpose.
      if (CD_COMMANDS.has(name)) here = subshell ? undefined : changeDir(args, here);
      else if (name === POPD_COMMAND) here = undefined;
      const verdict = writerFor(name)?.(args, here, depth);
      if (verdict) return verdictDetail(verdict);
    }
  }
  return undefined;
}

// Variables are not expanded: a path holding one counts as outside .plans/. Accepted residual: interpreter code (python3 -c, node -e, perl, ruby, awk system(), sed's w
// command), build tools and npm scripts (make, vp pack, npm run) and sqlite3 dot-commands such as
// .open and .output can still write outside .plans/, as can SQL such as ATTACH and VACUUM INTO on
// a .plans database; git aliases are not resolved. The skill text
// and the always-on block cover them, not this guard.

/** Denies a Bash command that writes outside .plans/; fails closed on any error. */
export function shellWriteRule(input) {
  if (input?.tool_name !== SHELL_TOOL) return undefined;
  try {
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const command = input.tool_input?.[COMMAND_FIELD];
    if (typeof command !== "string" || command === "") return SHELL_WRITE_DETAIL;
    return commandWrites(command, cwd, 0);
  } catch {
    return SHELL_WRITE_DETAIL;
  }
}

// ---------------------------------------------------------------- rules

/**
 * Each rule is `(input) => string | undefined`: a detail sentence to deny the call, or undefined
 * to pass. Git history and branch changes are part of the shell rule.
 */
export const RULES = [fileWriteRule, writerAgentRule, shellWriteRule];

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
