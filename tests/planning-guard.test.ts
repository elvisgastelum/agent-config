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
