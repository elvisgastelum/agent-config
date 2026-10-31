import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { read } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const ITEM = "t3-code-integration";
const SECTION = "## In T3 Code";
const GATE = "Only when the `t3-code` MCP tools are available";
const ALL = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-config-t3-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const res = spawnSync("node", [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const skill = {
  claude: () => join(home, ".claude/skills/t3-code/SKILL.md"),
  opencode: () => join(home, ".config/opencode/skills/t3-code/SKILL.md"),
  codex: () => join(home, ".codex/skills/t3-code/SKILL.md"),
  pi: () => join(home, ".pi/agent/skills/t3-code/SKILL.md"),
};
const actions = {
  continue: () => join(home, ".claude/skills/continue/SKILL.md"),
  brief: () => join(home, ".claude/skills/brief/SKILL.md"),
  planning: () => join(home, ".claude/skills/planning/SKILL.md"),
};

test("install t3-code-integration adds the skill and the gated block for every runtime", () => {
  const installed = run("install", ITEM, ...ALL, "--yes", "--json");
  expect(installed.code).toBe(0);
  expect(JSON.parse(installed.stdout).applied).toBe(true);

  for (const path of Object.values(skill)) {
    const text = read(path());
    expect(text).toContain("name: t3-code");
    expect(text).toContain(GATE);
    expect(text).toContain('`delegate_task` with `isolation:"worktree"`');
  }
  expect(read(skill.claude())).toContain("the `AskUserQuestion` tool");
  expect(read(skill.opencode())).toContain("the `question` tool");
  expect(read(skill.codex())).toContain("the `request_user_input` tool");
  expect(read(skill.pi())).toContain("otherwise one message with numbered options");
  expect(read(skill.claude())).toContain("`html_render`");

  for (const file of [
    ".claude/CLAUDE.md",
    ".config/opencode/AGENTS.md",
    ".codex/AGENTS.md",
    ".pi/agent/AGENTS.md",
  ]) {
    const text = read(join(home, file));
    expect(text).toContain("<!-- BEGIN agent-config:t3-code-integration");
    expect(text).toContain(SECTION);
    expect(text).toContain(GATE);
  }
});

test("without the item the actions keep their text: no T3 Code lines", () => {
  for (const item of ["continue", "brief", "planning"])
    expect(run("install", item, "--runtime", "claude", "--yes").code).toBe(0);
  for (const path of Object.values(actions)) {
    const text = read(path());
    expect(text).not.toContain(SECTION);
    expect(text).not.toContain("t3-code");
  }
  expect(read(actions.continue())).toContain("git worktree add -b <branch> <path>");
});

test("installing the item re-renders continue, brief and planning at its scope", () => {
  for (const item of ["continue", "brief", "planning"])
    expect(run("install", item, "--runtime", "claude", "--yes").code).toBe(0);
  const before = read(actions.continue());

  const installed = run("install", ITEM, "--runtime", "claude", "--yes", "--json");
  expect(installed.code).toBe(0);
  const items = new Set(
    (JSON.parse(installed.stdout).plan as { item: string }[]).map((x) => x.item),
  );
  expect([...items].sort()).toEqual([
    "brief@user",
    "continue@user",
    "planning@user",
    `${ITEM}@user`,
  ]);

  const cont = read(actions.continue());
  expect(cont.startsWith(before.trimEnd())).toBe(true);
  expect(cont).toContain(SECTION);
  expect(cont).toContain('`isolation:"worktree"`, `role:"implementation"`');
  expect(cont).toContain("skip `git worktree remove`");
  expect(cont).toContain("`link_pull_request`");
  expect(read(actions.brief())).toContain("`t3_thread_launch` with the brief as `message`");
  const planning = read(actions.planning());
  expect(planning).toContain(SECTION);
  expect(planning).toContain("Never `delegate_task`, `t3_thread_launch`");
  for (const path of Object.values(actions)) expect(read(path())).toContain("`AskUserQuestion`");
});

test("an action installed after the item gets its T3 Code lines", () => {
  expect(run("install", ITEM, "--runtime", "claude", "--yes").code).toBe(0);
  expect(run("install", "continue", "--runtime", "claude", "--yes").code).toBe(0);
  expect(read(actions.continue())).toContain(SECTION);
});

test("uninstalling the item removes its files and the actions' T3 Code lines", () => {
  expect(run("install", "continue", "--runtime", "claude", "--yes").code).toBe(0);
  const plain = read(actions.continue());
  expect(run("install", ITEM, "--runtime", "claude", "--yes").code).toBe(0);
  expect(read(actions.continue())).toContain(SECTION);

  const removed = run("uninstall", ITEM, "--yes");
  expect(removed.code).toBe(0);
  expect(existsSync(skill.claude())).toBe(false);
  // The item created CLAUDE.md, so uninstalling removes it.
  expect(existsSync(join(home, ".claude/CLAUDE.md"))).toBe(false);
  expect(read(actions.continue())).toBe(plain);
  const status = JSON.parse(run("status", "--json").stdout);
  expect(status.entries.every((e: { state: string }) => e.state === "ok")).toBe(true);
});

test("a project-scope item leaves the user-scope actions alone", () => {
  const project = join(home, "repo");
  mkdirSync(join(project, ".git"), { recursive: true });
  expect(run("install", "continue", "--runtime", "claude", "--yes").code).toBe(0);
  expect(
    run("install", "continue", "--runtime", "claude", "--project", project, "--yes").code,
  ).toBe(0);
  expect(run("install", ITEM, "--runtime", "claude", "--project", project, "--yes").code).toBe(0);
  expect(read(actions.continue())).not.toContain(SECTION);
  expect(read(join(project, ".claude/skills/continue/SKILL.md"))).toContain(SECTION);
  expect(read(join(project, ".claude/skills/t3-code/SKILL.md"))).toContain("name: t3-code");
});

test("kaneo's skill gets T3 Code lines only when the item is installed at its scope", () => {
  const kaneo = join(home, ".claude/skills/kaneo-work-tracking/SKILL.md");
  expect(
    run("install", "kaneo", "--runtime", "claude", "--url", "https://kaneo.example.com", "--yes")
      .code,
  ).toBe(0);
  const plain = read(kaneo);
  expect(plain).not.toContain(SECTION);

  const installed = run("install", ITEM, "--runtime", "claude", "--yes", "--json");
  expect(installed.code).toBe(0);
  expect(
    (JSON.parse(installed.stdout).plan as { item: string }[]).some((x) => x.item === "kaneo@user"),
  ).toBe(true);
  const text = read(kaneo);
  expect(text.startsWith(plain.trimEnd())).toBe(true);
  expect(text).toContain(SECTION);
  expect(text).toContain("`t3_thread_update`");
  expect(text).toContain("`link_pull_request`");
  expect(text).toContain("`t3_thread_organize`");
  expect(text).toContain("`write_pull_request_guides`");

  expect(run("uninstall", ITEM, "--yes").code).toBe(0);
  expect(read(kaneo)).toBe(plain);
});

test("/continue waits for a running ticket thread before taking the ticket over", () => {
  expect(run("install", "continue", "--runtime", "claude", "--yes").code).toBe(0);
  expect(run("install", ITEM, "--runtime", "claude", "--yes").code).toBe(0);
  expect(read(actions.continue())).toContain("`t3_thread_wait`");
});

test("the brief guard's thread tools are listed in the README", () => {
  const readme = read(join(import.meta.dirname, "..", "README.md"));
  expect(readme).toContain("`t3_thread_launch` and `create_threads` handoffs");
});
