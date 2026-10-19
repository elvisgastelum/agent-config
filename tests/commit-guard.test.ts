import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import { decide } from "../assets/commit-guard.mjs";

const bash = (command: string) => decide({ tool_name: "Bash", tool_input: { command } });

describe("commit guard", () => {
  test("allows one title line and commands that are not commits", () => {
    expect(bash('git commit -m "fix(auth): refresh token before expiry"')).toBeUndefined();
    expect(bash('git -C repo commit -am "docs: add readme"')).toBeUndefined();
    expect(bash("git commit --amend --no-edit")).toBeUndefined();
    expect(bash('git log --oneline -n 10 && echo "a\nb"')).toBeUndefined();
    expect(decide({ tool_name: "Read", tool_input: { file_path: "x" } })).toBeUndefined();
  });

  test("blocks attribution trailers", () => {
    expect(bash('git commit -m "fix: x Co-Authored-By: Claude"')).toContain("attribution");
    expect(bash('git commit -m "fix: x 🤖 Generated with [Claude Code]"')).toContain("attribution");
  });

  test("blocks heredocs and message files", () => {
    expect(bash("git commit -F msg.txt")).toContain("-F/--file");
    expect(bash("git commit --file=msg.txt")).toContain("-F/--file");
    expect(bash('git commit -m "$(cat <<EOF\nfix: x\nEOF\n)"')).toContain("heredocs");
  });

  test("blocks a body from a second -m or a multi-line message", () => {
    expect(bash('git commit -m "fix: x" -m "body"')).toContain("multiple -m");
    expect(bash('git commit --message="fix: x" -m "body"')).toContain("multiple -m");
    expect(bash('git commit -m "fix: x\n\nbody"')).toContain("multi-line");
  });

  test("runs as a hook: denies through stdout and lets anything else through", () => {
    const script = join(import.meta.dirname, "..", "assets", "commit-guard.mjs");
    const hook = (input: string) => execFileSync("node", [script], { input, encoding: "utf8" });
    const denied = JSON.parse(
      hook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -F m" } })),
    );
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("commit skill");
    expect(hook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }))).toBe("");
    expect(hook("not json")).toBe("");
  });
});
