#!/usr/bin/env node
// agent-config commit guard: a Claude Code PreToolUse hook (Bash).
//
// Denies `git commit` commands whose message is not a single title line: attribution trailers,
// heredocs, -F/--file, a second -m, or a multi-line command. Ported from claude-commit-skill.
//
// Any unexpected input or error lets the call through: the guard never breaks a session.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// `git [-C dir | --opt[=value]]... commit`, anywhere in the command.
const COMMIT = /(^|[^\w-])git(\s+(-[Cc]\s+\S+|--[a-z-]+(=\S+)?))*\s+commit(\s|$)/;
const TRAILER = /co-authored-by|generated with \[?claude/i;
const MESSAGE_FILE = /<<|(^|\s)(-F|--file)([\s=]|$)/;
const MESSAGE_FLAG = /(?<=^|\s)(-[a-zA-Z]*m|--message)(?=[\s=]|$)/g;

/** Returns the reason to deny a Bash call, or undefined to let it through. */
export function decide(input) {
  const command = input?.tool_input?.command;
  if (input?.tool_name !== "Bash" || typeof command !== "string" || !COMMIT.test(command)) {
    return undefined;
  }
  const deny = (why) =>
    `commit-guard: ${why}\nUse a single title line: git commit -m "type(scope): summary" (see the commit skill).`;
  if (TRAILER.test(command)) {
    return deny(
      "commit attribution trailers (Co-Authored-By / Generated with Claude Code) are not allowed.",
    );
  }
  if (MESSAGE_FILE.test(command))
    return deny("heredocs and -F/--file commit messages are not allowed.");
  if ((command.match(MESSAGE_FLAG) ?? []).length > 1) {
    return deny("multiple -m flags create a commit body.");
  }
  if (command.includes("\n")) {
    return deny("multi-line commit commands are not allowed (the message must be one line).");
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
