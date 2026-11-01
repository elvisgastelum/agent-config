import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { read } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const ITEM = "fix-claude-code-permissions";
const ALL = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-config-macfix-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(args: string[], input?: string) {
  const res = spawnSync("node", [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const skills = () => [
  join(home, ".claude/skills", ITEM, "SKILL.md"),
  join(home, ".config/opencode/skills", ITEM, "SKILL.md"),
  join(home, ".codex/skills", ITEM, "SKILL.md"),
  join(home, ".pi/agent/skills", ITEM, "SKILL.md"),
];

test("install adds the skill for every runtime and uninstall removes it", () => {
  expect(run(["install", ITEM, ...ALL, "--yes"]).code).toBe(0);
  for (const path of skills()) {
    const text = read(path);
    expect(text).toContain(`name: ${ITEM}`);
    expect(text).toContain("agent-config fix-claude-code diagnose");
  }
  expect(run(["uninstall", ITEM, "--yes"]).code).toBe(0);
  for (const path of skills()) expect(existsSync(path)).toBe(false);
});

test("the skill keeps the password out of chat and commands, and asks T3 Code for it as a file", () => {
  run(["install", ITEM, "--runtime", "claude", "--yes"]);
  const text = read(skills()[0]!);
  expect(text).toContain("Never ask for it in chat");
  expect(text).toContain("## In T3 Code");
  expect(text).toContain("Only when the `t3-code` MCP tools are available");
  expect(text).toContain('`delivery:"file"`');
  expect(text).toContain("--password-file <path>");
});

test("the item is user scope only", () => {
  const r = run(["install", ITEM, "--runtime", "claude", "--project", home, "--yes"]);
  expect(r.code).not.toBe(0);
});

test("catalog lists the item under its title", () => {
  const listed = JSON.parse(run(["catalog", "--json"]).stdout).items as {
    id: string;
    title: string;
  }[];
  expect(listed.find((i) => i.id === ITEM)?.title).toBe("Fix Claude Code Permissions (MacOS)");
});

test("fix-claude-code refuses unrelated flags, bad usage and both password sources", () => {
  expect(run(["fix-claude-code", "--json", "diagnose"]).code).toBe(2);
  expect(run(["fix-claude-code", "explode"]).code).toBe(2);
  expect(run(["fix-claude-code", "diagnose", "extra"]).code).toBe(2);
  expect(run(["fix-claude-code", "remote"]).code).toBe(2);
  expect(run(["fix-claude-code", "remote", "h", "explode"]).code).toBe(2);
  expect(run(["fix-claude-code", "diagnose", "--timeout", "0"]).code).toBe(2);
  expect(run(["fix-claude-code", "diagnose", "--tier", "fast"]).code).toBe(2);
  const both = run(["fix-claude-code", "fix", "--password-stdin", "--password-file", "x"]);
  expect(both.code).toBe(2);
  expect(both.stderr).toContain("not both");
});

test("the fix flags apply to fix-claude-code only", () => {
  for (const flag of [["--binary", "x"], ["--password-stdin"], ["--password-file", "x"]]) {
    const r = run(["status", ...flag]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only applies to fix-claude-code");
    expect(run(["delegate", "read", ...flag, "task"]).stderr).toContain(
      "does not apply to delegate",
    );
  }
});

test("remote rejects a host that looks like an ssh option before any ssh runs", () => {
  const r = run(["fix-claude-code", "remote", "-oProxyCommand=evil", "diagnose"]);
  expect(r.code).toBe(2);
});

test("a password file with an empty first line is refused, not sent", () => {
  const file = join(home, "pw");
  writeFileSync(file, "\n");
  const r = run(["fix-claude-code", "remote", "somehost", "fix", "--password-file", file]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("the password is empty");
});
