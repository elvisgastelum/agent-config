import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import * as guard from "../assets/planning-guard.mjs";
import { PLANNING_GUARD_MATCHER } from "../src/planning.ts";
import { T3_LAUNCH_TOOLS } from "../src/t3.ts";

const { FILE_WRITE_DETAIL, PLANNING_COMMAND_TAG, blockMessage, decide, repoRoot } = guard;

const GUARD_PATH = join(import.meta.dirname, "..", "assets", "planning-guard.mjs");
const IMPORT_SPECIFIER = /(?:\bfrom\s+|^\s*import\s+)["']([^"']+)["']/gm;
const ALLOWED_PREFIX = "node:";
const ALLOWED_LOCAL = "./shell-split.mjs";
const DENIED = "this call is denied.";

const denyAll = () => DENIED;
const EDIT = { tool_name: "Edit", tool_input: { file_path: "src/a.ts" } };
const BASH = { tool_name: "Bash", tool_input: { command: "git commit -m x" } };
const AGENT = { tool_name: "Agent", tool_input: { prompt: "write code" } };

const planningEntry = {
  type: "user",
  message: {
    role: "user",
    content: `${PLANNING_COMMAND_TAG}\n<command-message>planning</command-message>\n<command-args>x</command-args>`,
  },
};
const userEntry = (content: unknown, extra: object = {}) => ({
  type: "user",
  message: { role: "user", content },
  ...extra,
});
const skillEntry = (skill: string) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill } }],
  },
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const transcript = (...entries: object[]) => {
  const dir = mkdtempSync(join(tmpdir(), "planning-guard-"));
  dirs.push(dir);
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
};
const withTranscript = (path: string) => ({ ...EDIT, transcript_path: path });

describe("planning guard activation", () => {
  test("transcript without /planning allows Edit, Bash and Agent calls", () => {
    const path = transcript(userEntry("hello"), skillEntry("brief"));
    for (const input of [EDIT, BASH, AGENT]) {
      const withPath = { ...input, transcript_path: path };
      expect(decide(withPath)).toBeUndefined();
      expect(decide(withPath, [denyAll])).toBeUndefined();
    }
    const missing = { ...EDIT, transcript_path: join(tmpdir(), "planning-guard-missing.jsonl") };
    expect(decide(missing, [denyAll])).toBeUndefined();
    expect(decide(EDIT, [denyAll])).toBeUndefined();
  });

  test("user command-name entry activates the guard", () => {
    const path = transcript(planningEntry);
    expect(decide(withTranscript(path), [denyAll])).toBe(blockMessage(DENIED));
  });

  test("assistant Skill tool_use for planning activates the guard", () => {
    const active = transcript(skillEntry("planning"));
    expect(decide(withTranscript(active), [denyAll])).toBe(blockMessage(DENIED));
    const other = transcript(skillEntry("brief"));
    expect(decide(withTranscript(other), [denyAll])).toBeUndefined();
  });

  test("/planning inside a tool result does not activate the guard", () => {
    const path = transcript(
      userEntry([{ type: "tool_result", tool_use_id: "t1", content: PLANNING_COMMAND_TAG }]),
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "try /planning later" }] },
      },
    );
    expect(decide(withTranscript(path), [denyAll])).toBeUndefined();
  });

  test("block message names /clear, a new session, /brief and /continue", () => {
    const message = blockMessage(DENIED);
    for (const part of ["planning mode", "/clear", "a new session", "/brief", "/continue"]) {
      expect(message).toContain(part);
    }
    expect(message).toContain(DENIED);
  });

  test("transcript with a compact summary after /planning stays blocked", () => {
    const path = transcript(
      planningEntry,
      userEntry("This session is being continued from a previous conversation...", {
        isCompactSummary: true,
      }),
    );
    expect(decide(withTranscript(path), [denyAll])).toBe(blockMessage(DENIED));
  });

  test("resumed transcript with /planning in an earlier entry stays blocked", () => {
    const path = transcript(
      { ...planningEntry, sessionId: "s1" },
      userEntry("answer one", { sessionId: "s1" }),
      skillEntry("brief"),
      userEntry("after resume", { sessionId: "s2" }),
      userEntry("more", { sessionId: "s2" }),
    );
    expect(decide(withTranscript(path), [denyAll])).toBe(blockMessage(DENIED));
  });

  test("later /continue entry keeps the block", () => {
    const path = transcript(
      planningEntry,
      userEntry("<command-name>/continue</command-name>\n<command-args></command-args>"),
    );
    expect(decide(withTranscript(path), [denyAll])).toBe(blockMessage(DENIED));
  });
});

describe("planning guard script", () => {
  test("planning-guard.mjs imports nothing except node: built-ins and ./shell-split.mjs", () => {
    const source = readFileSync(GUARD_PATH, "utf8");
    const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith(ALLOWED_PREFIX) || specifier === ALLOWED_LOCAL).toBe(true);
    }
  });

  test("hook run denying a write prints a PreToolUse deny", () => {
    const root = gitFixture();
    const input = write("Edit", "src/x.ts", root);
    const result = spawnSync("node", [GUARD_PATH], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      blockMessage(FILE_WRITE_DETAIL),
    );
  });

  test("hook run allowing a write prints nothing", () => {
    const root = gitFixture();
    const input = write("Write", ".plans/x/plan.sqlite", root);
    const result = spawnSync("node", [GUARD_PATH], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

function gitFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "planning-guard-repo-")));
  dirs.push(root);
  const init = spawnSync("git", ["init", "-q"], { cwd: root });
  expect(init.status).toBe(0);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".plans", "10-2026", "p"), { recursive: true });
  return root;
}

const planningPath = () => transcript(planningEntry);
const write = (tool: string, path: string, cwd: string) => ({
  tool_name: tool,
  tool_input: tool === "NotebookEdit" ? { notebook_path: path } : { file_path: path },
  transcript_path: planningPath(),
  cwd,
});
const BLOCKED = blockMessage(FILE_WRITE_DETAIL);

describe("planning guard file writes", () => {
  test("Edit of src/x.ts is blocked", () => {
    const root = gitFixture();
    expect(decide(write("Edit", "src/x.ts", root))).toBe(BLOCKED);
  });

  test("Write to .plans/10-2026/p/plan.sqlite is allowed", () => {
    const root = gitFixture();
    expect(decide(write("Write", ".plans/10-2026/p/plan.sqlite", root))).toBeUndefined();
  });

  test("with hook cwd in a subfolder (src/), Write to <root>/.plans/x/plan.sqlite is allowed and Write to src/x.ts is blocked", () => {
    const root = gitFixture();
    const cwd = join(root, "src");
    expect(repoRoot(cwd)).toBe(root);
    expect(decide(write("Write", join(root, ".plans", "x", "plan.sqlite"), cwd))).toBeUndefined();
    expect(decide(write("Write", join(root, "src", "x.ts"), cwd))).toBe(BLOCKED);
    expect(decide(write("Write", "x.ts", cwd))).toBe(BLOCKED);
  });

  test("cwd outside any git repo falls back to cwd as root", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "planning-guard-plain-")));
    dirs.push(dir);
    expect(repoRoot(dir)).toBe(dir);
    expect(decide(write("Write", ".plans/x/plan.sqlite", dir))).toBeUndefined();
    expect(decide(write("Write", "x.ts", dir))).toBe(BLOCKED);
  });

  test("path through .plans/../src/x.ts is blocked", () => {
    const root = gitFixture();
    expect(decide(write("Write", ".plans/../src/x.ts", root))).toBe(BLOCKED);
  });

  test("symlink under .plans that points into src is blocked", () => {
    const root = gitFixture();
    symlinkSync(join(root, "src"), join(root, ".plans", "link"));
    expect(decide(write("Write", ".plans/link/x.ts", root))).toBe(BLOCKED);
    writeFileSync(join(root, "src", "f.ts"), "");
    symlinkSync(join(root, "src", "f.ts"), join(root, ".plans", "f.ts"));
    expect(decide(write("Write", ".plans/f.ts", root))).toBe(BLOCKED);
    symlinkSync(join(root, "src", "missing.ts"), join(root, ".plans", "d.ts"));
    expect(decide(write("Write", ".plans/d.ts", root))).toBe(BLOCKED);
  });

  test("src/.plans/x.sqlite is blocked", () => {
    const root = gitFixture();
    expect(decide(write("Write", "src/.plans/x.sqlite", root))).toBe(BLOCKED);
  });

  test("MultiEdit and NotebookEdit get the same decision as Edit", () => {
    const root = gitFixture();
    const decisions = { "src/x.ts": BLOCKED, ".plans/x/plan.sqlite": undefined };
    for (const [path, decision] of Object.entries(decisions)) {
      const expected = decide(write("Edit", path, root));
      expect(expected).toBe(decision);
      expect(decide(write("MultiEdit", path, root))).toBe(expected);
      expect(decide(write("NotebookEdit", path, root))).toBe(expected);
    }
  });

  test("path starting with ~ is blocked", () => {
    const root = gitFixture();
    const cwd = join(root, ".plans");
    expect(decide(write("Write", "~/x", cwd))).toBe(BLOCKED);
    expect(decide(write("Write", "~", cwd))).toBe(BLOCKED);
  });

  test("GIT_* variables in the environment do not move the root", () => {
    const root = gitFixture();
    process.env.GIT_WORK_TREE = join(root, "src");
    try {
      expect(repoRoot(root)).toBe(root);
      expect(decide(write("Write", "src/.plans/x.sqlite", root))).toBe(BLOCKED);
    } finally {
      delete process.env.GIT_WORK_TREE;
    }
  });

  test("the deny detail is pinned", () => {
    expect(guard.FILE_WRITE_DETAIL).toBe(
      "file writes are allowed only under .plans/ at the repository root.",
    );
  });

  test("denial reason names the .plans rule", () => {
    const root = gitFixture();
    const message = decide(write("Edit", "src/x.ts", root));
    expect(message).toContain(".plans/");
    expect(message).toBe(blockMessage(FILE_WRITE_DETAIL));
    for (const input of [BASH, AGENT]) expect(guard.fileWriteRule(input)).toBeUndefined();
    expect(guard.fileWriteRule({ tool_name: "Edit", tool_input: {}, cwd: root })).toBe(
      FILE_WRITE_DETAIL,
    );
  });
});

const agent = (tool_input: object, tool_name = "Agent") => ({
  tool_name,
  tool_input,
  transcript_path: planningPath(),
});
const agentBlocked = (type: string) => blockMessage(guard.writerAgentDetail(type));

describe("planning guard writer sub-agents", () => {
  test("Agent with subagent_type ladder-edit-balanced is blocked", () => {
    expect(decide(agent({ subagent_type: "ladder-edit-balanced", prompt: "x" }))).toBe(
      agentBlocked("ladder-edit-balanced"),
    );
    for (const type of ["ladder-edit-fast", "ladder-edit-deep"])
      expect(decide(agent({ subagent_type: type }))).toBe(agentBlocked(type));
  });

  test("ladder-orchestrator is blocked", () => {
    expect(decide(agent({ subagent_type: "ladder-orchestrator" }))).toBe(
      agentBlocked("ladder-orchestrator"),
    );
  });

  test("general-purpose is blocked", () => {
    expect(decide(agent({ subagent_type: "general-purpose" }))).toBe(
      agentBlocked("general-purpose"),
    );
  });

  test("Agent call without subagent_type is blocked", () => {
    const missing = agentBlocked(guard.MISSING_AGENT_TYPE);
    expect(decide(agent({ prompt: "write code" }))).toBe(missing);
    expect(decide(agent({ subagent_type: "" }))).toBe(missing);
    expect(decide(agent({ subagent_type: "  " }))).toBe(missing);
    expect(decide(agent({ subagent_type: 3 }))).toBe(missing);
    expect(decide({ tool_name: "Agent", transcript_path: planningPath() })).toBe(missing);
  });

  test("the Task tool is guarded the same way", () => {
    expect(decide(agent({ subagent_type: "ladder-edit-fast" }, "Task"))).toBe(
      agentBlocked("ladder-edit-fast"),
    );
    expect(decide(agent({}, "Task"))).toBe(agentBlocked(guard.MISSING_AGENT_TYPE));
    expect(decide(agent({ subagent_type: "Explore" }, "Task"))).toBeUndefined();
  });

  test("case, whitespace and a plugin namespace do not slip a writer through", () => {
    for (const type of ["Ladder-Edit-Fast", " general-purpose ", "plugin:ladder-orchestrator"])
      expect(decide(agent({ subagent_type: type }))).toBe(agentBlocked(type));
  });

  test("planner-deep, ladder-reviewer-deep, kaneo-scribe and Explore pass", () => {
    for (const type of [
      "planner-deep",
      "planner-fast",
      "ladder-reviewer-deep",
      "kaneo-scribe",
      "Explore",
      "ladder-read-fast",
      "ladder-explorer-balanced",
      "ladder-researcher-fast",
      "ladder-designer-balanced",
      "ladder-user-experience-deep",
      "ladder-editor",
    ])
      expect(decide(agent({ subagent_type: type }))).toBeUndefined();
  });

  test("outside planning a writer sub-agent passes", () => {
    const outside = {
      ...agent({ subagent_type: "ladder-edit-fast" }),
      transcript_path: transcript(userEntry("hi")),
    };
    expect(decide(outside)).toBeUndefined();
  });

  test("the denylist and the deny detail are pinned", () => {
    expect(guard.WRITER_AGENTS).toEqual([
      "ladder-edit-*",
      "ladder-orchestrator",
      "general-purpose",
    ]);
    expect(guard.writerAgentDetail("ladder-edit-fast")).toBe(
      "the sub-agent ladder-edit-fast can write files, so it cannot start; read-only agents such as planners, readers, explorers, researchers and reviewers still run.",
    );
    expect(guard.MISSING_AGENT_TYPE).toBe("general-purpose (no subagent_type)");
  });

  test("denial reason names the agent type", () => {
    expect(decide(agent({ subagent_type: "ladder-edit-balanced" }))).toContain(
      "ladder-edit-balanced",
    );
    expect(decide(agent({}))).toContain("no subagent_type");
    for (const input of [EDIT, BASH]) expect(guard.writerAgentRule(input)).toBeUndefined();
  });
});

describe("planning guard T3 Code tools", () => {
  const t3 = (tool: string, tool_input: object = { task: "implement the plan" }) => ({
    tool_name: `mcp__t3-code__${tool}`,
    tool_input,
    transcript_path: planningPath(),
  });

  test("tools that start work in another thread, worktree or schedule are blocked", () => {
    for (const tool of [
      "delegate_task",
      "t3_thread_launch",
      "create_threads",
      "t3_thread_send",
      "t3_worktree_handoff",
      "schedule_task",
      "run_scheduled_task_now",
    ])
      expect(decide(t3(tool))).toBe(blockMessage(guard.t3LaunchDetail(tool)));
  });

  test("read-only T3 tools and other MCP servers pass", () => {
    for (const tool of [
      "t3_thread_read",
      "task_status",
      "html_render",
      "orchestrator_capabilities",
    ])
      expect(decide(t3(tool))).toBeUndefined();
    expect(
      decide({ ...t3("delegate_task"), tool_name: "mcp__other__delegate_task" }),
    ).toBeUndefined();
  });

  test("outside planning a T3 delegation passes", () => {
    expect(
      decide({ ...t3("delegate_task"), transcript_path: transcript(userEntry("hi")) }),
    ).toBeUndefined();
  });

  test("the tool list and the deny detail are pinned", () => {
    expect(guard.T3_LAUNCH_TOOLS).toEqual([...T3_LAUNCH_TOOLS]);
    for (const tool of T3_LAUNCH_TOOLS)
      expect(PLANNING_GUARD_MATCHER.split("|")).toContain(`mcp__t3-code__${tool}`);
    expect(guard.t3LaunchDetail("delegate_task")).toBe(
      "the T3 Code tool delegate_task starts work in another thread, worktree or schedule, so it cannot run; read-only agents and T3 read tools such as t3_thread_read still run.",
    );
  });
});

const bash = (command: string, cwd: string) => ({
  tool_name: "Bash",
  tool_input: { command },
  transcript_path: planningPath(),
  cwd,
});
const SHELL_BLOCKED = blockMessage(guard.SHELL_WRITE_DETAIL);
const GIT_BLOCKED = blockMessage(guard.GIT_WRITE_DETAIL);

describe("planning guard shell writes", () => {
  const blocked = (commands: string[], cwd: string) => {
    for (const command of commands)
      expect([command, decide(bash(command, cwd))]).toEqual([command, SHELL_BLOCKED]);
  };
  const gitBlocked = (commands: string[], cwd: string) => {
    for (const command of commands)
      expect([command, decide(bash(command, cwd))]).toEqual([command, GIT_BLOCKED]);
  };
  const passes = (commands: string[], cwd: string) => {
    for (const command of commands)
      expect([command, decide(bash(command, cwd))]).toEqual([command, undefined]);
  };

  test("the shell deny detail is pinned", () => {
    expect(guard.SHELL_WRITE_DETAIL).toBe(
      "shell commands may write only under .plans/ at the repository root.",
    );
  });

  test("echo x > src/a.ts is blocked", () => {
    blocked(["echo x > src/a.ts", "echo x &> src/a.ts", "echo x 2> src/a.ts"], gitFixture());
  });

  test("echo x >> ../outside is blocked", () => {
    blocked(["echo x >> ../outside"], gitFixture());
  });

  test("echo x >| src/a.ts is blocked", () => {
    blocked(["echo x >| src/a.ts"], gitFixture());
  });

  test("sed -i on src/a.ts is blocked", () => {
    const root = gitFixture();
    blocked(
      [
        "sed -i s/a/b/ src/a.ts",
        "sed -i.bak s/a/b/ src/a.ts",
        "sed -Ei s/a/b/ src/a.ts",
        "sed --in-place s/a/b/ src/a.ts",
      ],
      root,
    );
    passes(["sed -n 1p src/a.ts"], root);
  });

  test("tee, cp, mv and rm outside .plans are blocked", () => {
    const root = gitFixture();
    blocked(["tee src/a.ts", "cp a.txt src/a.ts", "mv a.txt src/b.ts", "rm src/a.ts"], root);
    passes(["tee .plans/x.txt", "cp .plans/a .plans/b"], root);
  });

  test("git apply and npm install are blocked", () => {
    const root = gitFixture();
    blocked(
      [
        "git apply x.patch",
        "git -C . apply x.patch",
        "npm install",
        "npm --prefix x install",
        "pnpm add x",
        "pip install x",
        "brew install x",
        "patch -p1 < x.diff",
      ],
      root,
    );
    passes(["git status", "git log --grep apply"], root);
  });

  test("env FOO=1 wrapper around a write is blocked", () => {
    blocked(
      ["env FOO=1 rm src/a.ts", "FOO=1 command rm src/a.ts", "sudo -u root tee src/a.ts"],
      gitFixture(),
    );
  });

  test("cat, grep and ls pass", () => {
    passes(
      ["cat src/a.ts | grep x && ls -la", "ls 2>/dev/null", "grep x src/a.ts 2>&1"],
      gitFixture(),
    );
  });

  test("sqlite3 store < schema.sql outside .plans is blocked", () => {
    blocked(["sqlite3 store < schema.sql"], gitFixture());
  });

  test("the git deny detail is pinned", () => {
    expect(guard.GIT_WRITE_DETAIL).toBe(
      "git may not change history, branches or the checked-out tree; read forms such as git status, git diff, git log and git branch --list pass.",
    );
  });

  test("git with the commit verb and -m x is blocked", () => {
    gitBlocked(
      [
        "git commit -m x",
        "git commit -am x",
        "env FOO=1 git commit -m x",
        "command git commit -m x",
      ],
      gitFixture(),
    );
  });

  test("git push is blocked", () => {
    gitBlocked(["git push", "git push origin main"], gitFixture());
  });

  test("git checkout -b feat is blocked", () => {
    gitBlocked(
      [
        "git checkout -b feat",
        "git checkout -B feat",
        "git checkout src/a.ts",
        "git checkout -- src/a.ts",
      ],
      gitFixture(),
    );
  });

  test("git switch -c feat is blocked", () => {
    gitBlocked(["git switch -c feat", "git switch -C feat", "git switch main"], gitFixture());
  });

  test("git branch feat is blocked; git branch --list passes", () => {
    const root = gitFixture();
    gitBlocked(["git branch feat", "git branch -D feat", "git branch -m a b"], root);
    passes(
      [
        "git branch",
        "git branch --list",
        "git branch -a",
        "git branch --list 'feat*'",
        "git branch --contains HEAD",
      ],
      root,
    );
  });

  test("git worktree add is blocked", () => {
    const root = gitFixture();
    gitBlocked(["git worktree add ../x", "git worktree remove ../x"], root);
    passes(["git worktree list"], root);
  });

  test("git -C ../other with a push is blocked", () => {
    gitBlocked(["git -C ../other push", "git -C ../other commit -m x"], gitFixture());
  });

  test("git status and git diff pass", () => {
    passes(
      [
        "git status",
        "git diff",
        "git diff --stat",
        "git log --oneline",
        "git -C ../other status",
        "git stash list",
        "git tag -l",
      ],
      gitFixture(),
    );
  });

  test("git reset, stash and tag creation are blocked", () => {
    gitBlocked(
      [
        "git reset --hard",
        "git reset HEAD~1",
        "git stash",
        "git stash pop",
        "git tag v1",
        "git merge x",
        "git rebase main",
      ],
      gitFixture(),
    );
  });

  test("git history writes inside sh -c, eval and substitutions are blocked", () => {
    gitBlocked(["sh -c 'git commit -m x'", "eval git push", "echo $(git push)"], gitFixture());
  });

  test("git with an unknown subcommand is blocked", () => {
    gitBlocked(["git $X", "X=push; git $X", 'git "$(echo push)"'], gitFixture());
  });

  test("git stash -m list is blocked", () => {
    gitBlocked(["git stash -m list", "git worktree --porcelain list"], gitFixture());
    passes(["git stash show", "git worktree list"], gitFixture());
  });

  test("git branch --format --list feat is blocked", () => {
    gitBlocked(["git branch --format --list feat", "git tag --sort --list v1"], gitFixture());
    passes(
      ["git branch --format %(refname) --list feat", "git tag -l", "git tag --sort=-v:refname"],
      gitFixture(),
    );
  });

  test("git branch upstream and clustered options are blocked", () => {
    gitBlocked(
      [
        "git branch -uorigin/main",
        "git branch --set-u=origin/main",
        "git branch --unset",
        "git branch -Df feat",
        "git tag -af v1",
      ],
      gitFixture(),
    );
    passes(
      ["git branch -vv", "git branch -a", "git branch --show-current", "git tag -n5"],
      gitFixture(),
    );
  });

  test("sqlite3 with a file: URI is blocked", () => {
    blocked(
      ["cd .plans && sqlite3 file:/tmp/x.db 'create table t(a)'", "sqlite3 FILE:/tmp/x.db"],
      gitFixture(),
    );
  });

  test("python3 -Im sqlite3 and python3.12 -m sqlite3 outside .plans are blocked", () => {
    blocked(
      [
        "python3 -Im sqlite3 /tmp/x.sqlite",
        "python3.12 -m sqlite3 /tmp/x.sqlite",
        "python3 -Imsqlite3 /tmp/x.sqlite",
      ],
      gitFixture(),
    );
    passes(["python3 -m sqlite3 .plans/x/plan.sqlite"], gitFixture());
  });

  test("sqlite3 .plans/x/plan.sqlite with select passes", () => {
    passes(
      [
        'sqlite3 .plans/x/plan.sqlite "SELECT 1;"',
        'sqlite3 -line .plans/x/plan.sqlite "SELECT 1;"',
        'sqlite3 -cmd ".timeout 5000" .plans/x/plan.sqlite "SELECT 1;"',
      ],
      gitFixture(),
    );
  });

  test("python3 -m sqlite3 .plans/x/plan.sqlite passes", () => {
    passes(["python3 -m sqlite3 .plans/x/plan.sqlite"], gitFixture());
  });

  test("python3 -m sqlite3 /tmp/x.sqlite is blocked", () => {
    blocked(
      [
        "python3 -m sqlite3 /tmp/x.sqlite",
        'sqlite3 /tmp/x.sqlite "SELECT 1;"',
        "sqlite3",
        "python3 -msqlite3 /tmp/x.sqlite",
      ],
      gitFixture(),
    );
  });

  test("a heredoc into sqlite3 on .plans passes", () => {
    passes(["sqlite3 .plans/x/plan.sqlite <<'SQL'\nINSERT INTO t VALUES (1);\nSQL"], gitFixture());
  });

  test("echo x > .plans/x.txt passes", () => {
    passes(["echo x > .plans/x.txt"], gitFixture());
  });

  test("python3 -c writing a file is not blocked (documented residual)", () => {
    passes([`python3 -c "open('src/a.ts','w').write('x')"`], gitFixture());
  });

  test("with hook cwd in a subfolder, .plans resolves against the git toplevel", () => {
    const cwd = join(gitFixture(), "src");
    passes(["echo x > ../.plans/x.txt"], cwd);
    blocked(["echo x > a.ts"], cwd);
  });

  test("ln outside .plans is blocked", () => {
    const root = gitFixture();
    blocked(["ln src/a.ts .plans/a", "ln -s ../src .plans/l"], root);
    passes(["ln .plans/a .plans/b"], root);
  });

  test("subshells, sh -c, eval and command substitution do not hide a write", () => {
    blocked(
      [
        "(rm src/a.ts)",
        'bash -c "rm src/a.ts"',
        "eval rm src/a.ts",
        'echo "$(rm src/a.ts)"',
        "echo `rm src/a.ts`",
        "find . -delete",
        "ls | xargs rm",
      ],
      gitFixture(),
    );
  });

  test("cd before a redirect moves the target", () => {
    const root = gitFixture();
    blocked(["cd src && echo x > a.ts", "cd && echo x > x.txt"], root);
    passes(["cd .plans && echo x > x.txt"], root);
  });

  test("cd into a store folder not yet created keeps the repository root", () => {
    const root = gitFixture();
    passes(
      [
        'mkdir -p .plans/10-2026/new && cd .plans/10-2026/new && sqlite3 plan.sqlite "select 1"',
        "cd .plans/10-2026/new && echo x > notes.md",
        "cd src/x && echo x > ../../.plans/a",
      ],
      root,
    );
    blocked(
      [
        "cd src/new && echo x > a.ts",
        "cd .plans/10-2026/new && echo x > ../../../a.ts",
        "cd src/x && echo x > .plans/a",
      ],
      root,
    );
  });

  test("shell reserved words are not taken as the command name", () => {
    const root = gitFixture();
    blocked(
      [
        "for f in src/*; do rm $f; done",
        "if true; then rm src/a.ts; fi",
        "{ rm src/a.ts; }",
        "! rm src/a.ts",
        'while read f; do rm "$f"; done < list',
      ],
      root,
    );
    passes(["for f in rm cp; do echo $f; done", "if true; then echo ok; fi"], root);
  });

  test("a variable in a write target counts as outside .plans", () => {
    const root = gitFixture();
    blocked(["OUT=src/a.ts; echo x > $OUT", 'F=src/a.ts; rm "$F"', 'echo x > "$OUT"'], root);
    passes(
      [
        `sqlite3 .plans/x/plan.sqlite "UPDATE t SET a = '$SID'"`,
        "echo $HOME",
        "ls $PWD 2>/dev/null",
      ],
      root,
    );
  });

  test("a cd inside a subshell makes the folder unknown", () => {
    blocked(["(cd .plans) && echo x > a", "(cd .plans && ls); rm x"], gitFixture());
  });

  test("an apostrophe inside double quotes does not hide a substitution", () => {
    blocked(
      ['echo "it\'s" $(rm src/a.ts)', 'git log -m "don\'t break" && echo `rm src/a.ts`'],
      gitFixture(),
    );
  });

  test("a quoted heredoc body is not scanned for substitutions", () => {
    passes(
      ["cat > .plans/p/plan.md <<'EOF'\nRun `npm install` and `rm -rf dist`\nEOF"],
      gitFixture(),
    );
  });

  test("only the command after a wrapper is judged", () => {
    const root = gitFixture();
    passes(["env echo rm x", "xargs grep -n cp", "find . -exec grep -l rm {} +"], root);
    blocked(
      [
        "sudo -u root tee src/a.ts",
        "timeout 5 rm src/a.ts",
        "nice -n 5 rm src/a.ts",
        "ls | xargs rm",
        "find . -exec rm {} +",
      ],
      root,
    );
  });

  test("the mode or owner of chmod is not a path", () => {
    const root = gitFixture();
    passes(["chmod 644 .plans/p/x", "chmod +x .plans/p/x"], root);
    blocked(["chmod +x src/a.ts", "chmod -x src/a.ts"], root);
  });

  test("case arms and function bodies are judged", () => {
    const root = gitFixture();
    blocked(
      [
        "case x in a) rm src/a.ts ;; esac",
        "case $x in a) ls ;; b) rm src/a.ts ;; esac",
        "f() { rm src/a.ts; }; f",
        "function f { rm src/a.ts; }; f",
      ],
      root,
    );
    passes(["case x in a) ls ;; esac"], root);
  });

  test("a command substitution in a cd folder or redirect target is unknown", () => {
    blocked(
      [
        'cd "$(git rev-parse --show-toplevel)" && echo x > .plans/p/x',
        "echo x > .plans/$(echo ../src/a.ts)",
      ],
      gitFixture(),
    );
  });

  test("stdbuf, ionice and caffeinate wrap a write", () => {
    blocked(
      ["stdbuf -oL rm src/a.ts", "ionice -c 3 rm src/a.ts", "caffeinate rm src/a.ts"],
      gitFixture(),
    );
  });

  test("a Bash call without a command is blocked", () => {
    const root = gitFixture();
    expect(decide({ ...bash("", root), tool_input: {} })).toBe(SHELL_BLOCKED);
    expect(decide(bash("", root))).toBe(SHELL_BLOCKED);
  });

  test("outside planning a shell write passes", () => {
    const input = {
      ...bash("rm src/a.ts", gitFixture()),
      transcript_path: transcript(userEntry("hi")),
    };
    expect(decide(input)).toBeUndefined();
  });
});
