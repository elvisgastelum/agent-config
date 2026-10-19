#!/usr/bin/env node
// model-ladder read guard: a Claude Code PreToolUse hook (Read|Bash).
//
// Denies whole-file reads of large text files in the main session and tells Claude to
// delegate the question to a ladder read agent, or to read only the range it will edit.
// Subagents (input carries agent_id) and ranged reads (offset/limit) always pass.
//
//   MODEL_LADDER_MIN_LINES  line threshold (default 350)
//   MODEL_LADDER_GUARD=off  disable the guard
//
// Any unexpected input or error lets the call through: the guard never breaks a session.

import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MIN_LINES = 350;
const NON_TEXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".pdf",
  ".ipynb",
]);
const PAGERS = new Set(["cat", "less", "more", "bat"]);
const SLICERS = new Set(["head", "tail"]);

function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (error) {
      if (error && error.code === "EAGAIN") continue;
      if (error && error.code === "EOF") break;
      throw error;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Counts newlines, stopping once `cap` is reached. Returns -1 when unreadable. */
export function countLines(path, cap) {
  let fd;
  try {
    if (!statSync(path).isFile()) return -1;
    fd = openSync(path, "r");
    const buf = Buffer.alloc(65536);
    let lines = 0;
    let last = 10;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      last = buf[n - 1];
      if (lines >= cap) return lines;
    }
    return last === 10 ? lines : lines + 1;
  } catch {
    return -1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Splits a simple command into words, honouring quotes and backslashes. Returns undefined
 * for anything with substitutions, pipes, redirects or chains: those already narrow or
 * post-process the output, so the guard lets them through.
 */
export function words(command, env = process.env) {
  if (/[|;&<>`()]|\$\(/.test(command)) return undefined;
  const home = env.HOME ?? "";
  const out = [];
  let cur = "";
  let started = false;
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\\" && i + 1 < command.length) {
      cur += command[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) out.push(cur);
  return out.map((w) => w.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home));
}

/** Files a simple `cat`/`head -n N` style command would print whole, or [] to let it pass. */
export function bashTargets(command, minLines, env = process.env) {
  const tokens = words(command, env);
  if (!tokens) return [];
  // Skip leading VAR=value assignments.
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  const prog = tokens.shift();
  if (!prog || tokens.some((t) => t.includes("$"))) return [];
  if (PAGERS.has(prog)) {
    // bat -r/--line-range prints a range, like a ranged Read.
    if (prog === "bat" && tokens.some((t) => /^(-r|--line-range)/.test(t))) return [];
    return tokens.filter((t) => !t.startsWith("-"));
  }
  if (!SLICERS.has(prog)) return [];
  // head/tail print 10 lines by default; only a large explicit count reads the file whole.
  let count = 10;
  const files = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m =
      /^-n?(\+?)(\d+)$/.exec(t) || (t === "-n" ? /^(\+?)(\d+)$/.exec(tokens[++i] ?? "") : null);
    if (m) count = m[1] === "+" ? Number.POSITIVE_INFINITY : Number(m[2]);
    else if (!t.startsWith("-")) files.push(t);
  }
  return count >= minLines ? files : [];
}

export function decide(input, env = process.env) {
  if (env.MODEL_LADDER_GUARD === "off") return undefined;
  if (input.agent_id || input.agent_type) return undefined;
  const minLines = Number.parseInt(env.MODEL_LADDER_MIN_LINES ?? "", 10) || DEFAULT_MIN_LINES;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const ti = input.tool_input ?? {};
  let files = [];
  if (input.tool_name === "Read") {
    if (ti.offset != null || ti.limit != null) return undefined;
    if (typeof ti.file_path === "string") files = [ti.file_path];
  } else if (input.tool_name === "Bash" && typeof ti.command === "string") {
    files = bashTargets(ti.command, minLines, env);
  }
  for (const file of files) {
    if (NON_TEXT.has(extname(file).toLowerCase())) continue;
    const path = isAbsolute(file) ? file : resolve(cwd, file);
    const lines = countLines(path, minLines);
    if (lines >= minLines) {
      return (
        `model-ladder: ${file} has ${minLines}+ lines; reading it whole fills the main context. ` +
        `To understand it, delegate the question to the ladder-read-fast agent (Agent tool, subagent_type "ladder-read-fast") ` +
        `and keep only its answer. To edit it, find the lines with Grep (-n) and Read just that range with offset/limit. ` +
        `(Threshold: MODEL_LADDER_MIN_LINES=${minLines}; MODEL_LADDER_GUARD=off disables this guard.)`
      );
    }
  }
  return undefined;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  let reason;
  try {
    reason = decide(input);
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
