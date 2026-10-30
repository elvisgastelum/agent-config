import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import * as guard from "../assets/brief-guard.mjs";
import { inlineShellSplit } from "../src/catalog.ts";
import {
  BRIEF_GUARD_MATCHER,
  FAST_REVIEW_APPROVAL,
  PHASE_PREFIX,
  briefMarkdown,
} from "../src/brief.ts";

const { BRIEF_PHASES, BRIEF_SECTIONS, briefProblems, decide } = guard;

const agent = (prompt: string, subagent_type: string, model?: string) =>
  decide({
    tool_name: "Agent",
    tool_input: { prompt, subagent_type, ...(model ? { model } : {}) },
  });
const bash = (command: string, cwd?: string) =>
  decide({ tool_name: "Bash", cwd, tool_input: { command } });

const dirs: string[] = [];
const tempDir = (prefix = "brief-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const writeBrief = (dir: string, name: string, text: string) => {
  mkdirSync(join(dir, "agent-config", "briefs"), { recursive: true });
  const path = join(dir, "agent-config", "briefs", name);
  writeFileSync(path, text);
  return path;
};
const brief = (
  first = "/continue parallel 2",
  sections: readonly string[] = BRIEF_SECTIONS,
  phases: readonly string[] = BRIEF_PHASES,
) =>
  [
    first,
    "",
    ...sections.map((s) => (s === "# Brief:" ? `${s} FEX-1 Epic` : s)),
    ...phases.map((p) => `Run ${p} for each ticket`),
  ].join("\n");
const INCOMPLETE = "Continue the epic\n\n# Brief: FEX-2 Epic\n";

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("brief guard: T3 Code delegate_task handoffs", () => {
  const delegated = (task: string, model?: string) =>
    decide({
      tool_name: "mcp__t3-code__delegate_task",
      tool_input: { task, ...(model ? { target: { model } } : {}) },
    });

  test("a checked phase runs only on its rung's model", () => {
    expect(delegated("Phase: plan\nTicket: FEX-1", "claude-opus-5-5")).toBeUndefined();
    const denied = delegated("Phase: plan\nTicket: FEX-1", "claude-haiku-5-5");
    expect(denied).toContain("not the fast rung");
    expect(denied).toContain("set `target.model` to a deep model");
  });

  test("a checked phase without a model is denied, unchecked phases pass", () => {
    expect(delegated("Phase: risk\nTicket: FEX-1")).toContain("set `target.model`");
    expect(delegated("Phase: edit\nTicket: FEX-1", "claude-haiku-5-5")).toBeUndefined();
    expect(delegated("Ticket: FEX-1")).toBeUndefined();
  });

  test("a fast review needs the approval line, as with the Agent tool", () => {
    const task = `Phase: review\n${FAST_REVIEW_APPROVAL}\nDiff: x`;
    expect(delegated(task, "claude-haiku-5-5")).toBeUndefined();
    expect(delegated("Phase: review\nDiff: x", "claude-sonnet-5-5")).toBeUndefined();
  });

  test("the hook matcher includes delegate_task", () => {
    expect(BRIEF_GUARD_MATCHER.split("|")).toEqual([
      "Agent",
      "Task",
      "Bash",
      "Write",
      "mcp__t3-code__delegate_task",
    ]);
  });

  test("the Agent tool's denial is unchanged", () => {
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-read-fast")).toContain(
      "Use ladder-read-deep without a model override.",
    );
  });
});

describe("brief guard: phase rungs", () => {
  test("Phase: plan runs only on the deep rung", () => {
    const prompt = "Phase: plan\nTicket: FEX-1";
    expect(agent(prompt, "ladder-read-deep")).toBeUndefined();
    expect(agent(prompt, "ladder-read-balanced")).toContain("deep rung");
    expect(agent(prompt, "ladder-read-deep", "haiku")).toBeDefined();
    expect(agent(prompt, "general-purpose")).toContain("general-purpose");
    expect(agent(prompt, "general-purpose", "opus")).toBeUndefined();
    expect(agent(prompt, "general-purpose", "fable")).toBeDefined();
    expect(agent(prompt, "ladder-read-deep", "fable")).toBeUndefined();
    expect(agent(prompt, "ladder-read-fast", "fable")).toContain("fast rung");
    expect(agent(prompt, "ladder-read-deep", "claude-haiku-5-5")).toContain("fast rung");
    expect(agent(prompt, "general-purpose", "claude-opus-5-5")).toBeUndefined();
    expect(agent("Phase: review", "ladder-read-fast", "claude-sonnet-5-5")).toBeUndefined();
  });

  test("Phase: risk is deep-only", () => {
    const prompt = "Phase: risk\nTicket: FEX-1";
    expect(agent(prompt, "ladder-read-deep")).toBeUndefined();
    expect(agent(prompt, "ladder-read-balanced")).toContain("deep rung");
  });

  test("Phase: diagnose is deep-only", () => {
    const prompt = "Phase: diagnose\nTicket: FEX-1";
    expect(agent(prompt, "ladder-read-deep")).toBeUndefined();
    expect(agent(prompt, "general-purpose")).toContain("general-purpose");
  });

  test("Phase: review runs on balanced or deep, and on fast only with the user's approval line", () => {
    const prompt = "Phase: review\nDiff: x";
    expect(agent(prompt, "ladder-read-balanced")).toBeUndefined();
    expect(agent(prompt, "ladder-read-deep")).toBeUndefined();
    expect(agent(prompt, "ladder-read-fast")).toContain("Fast review: approved by the user");
    expect(
      agent("Phase: review\nFast review: approved by the user\nDiff: x", "ladder-read-fast"),
    ).toBeUndefined();
    expect(
      agent("Phase: review\n\n  Fast review: approved by the user\nDiff: x", "ladder-read-fast"),
    ).toBeUndefined();
  });

  test("the fast-review approval counts only right under the phase line", () => {
    const quoted = "Phase: review\nTicket: FEX-1\nFast review: approved by the user";
    expect(agent(quoted, "ladder-read-fast")).toContain("right under the phase line");
    const extended = "Phase: review\nFast review: approved by the user? no\nDiff: x";
    expect(agent(extended, "ladder-read-fast")).toContain("right under the phase line");
  });

  test("a phase name that is an object key is not a checked phase", () => {
    expect(agent("Phase: constructor", "ladder-read-fast")).toBeUndefined();
  });

  test("the skill's protocol lines are the ones the guard reads", () => {
    expect(guard.FAST_REVIEW_APPROVAL).toBe(FAST_REVIEW_APPROVAL);
    expect(agent(`${PHASE_PREFIX} plan`, "ladder-read-fast")).toContain("deep rung");
  });

  test("planner agents carry their rung in their name, like the ladder agents", () => {
    expect(agent("Phase: plan\nTask: classify", "planner-deep")).toBeUndefined();
    expect(agent("Phase: review\nTask: draft quality", "planner-deep")).toBeUndefined();
    expect(agent("Phase: plan\nTask: classify", "planner-fast")).toContain("fast rung");
    expect(agent("Phase: review\nTask: draft quality", "planner-balanced")).toBeUndefined();
    expect(agent("Phase: review\nTask: draft quality", "planner-fast")).toContain("fast");
    expect(agent("Phase: draft\nTask: draft the tickets", "planner-fast")).toBeUndefined();
  });

  test("reviewer, explorer and researcher agents carry their rung; the orchestrator is deep", () => {
    const review = "Phase: review\nDiff: origin/dev...HEAD";
    expect(agent(review, "ladder-reviewer-balanced")).toBeUndefined();
    expect(agent(review, "ladder-reviewer-deep")).toBeUndefined();
    const fast = agent(review, "ladder-reviewer-fast");
    expect(fast).toContain("Use ladder-reviewer-deep or ladder-reviewer-balanced");
    expect(fast).toContain("Fast review: approved by the user");
    expect(
      agent("Phase: review\nFast review: approved by the user\nDiff: x", "ladder-reviewer-fast"),
    ).toBeUndefined();
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-explorer-fast")).toContain("fast rung");
    expect(agent("Phase: risk\nTicket: FEX-1", "ladder-researcher-deep")).toBeUndefined();
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-designer-fast")).toContain("fast rung");
    expect(agent("Phase: diagnose\nTicket: FEX-1", "ladder-user-experience-balanced")).toContain(
      "balanced rung",
    );
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-user-experience-deep")).toBeUndefined();
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-orchestrator")).toBeUndefined();
    expect(agent("Phase: plan\nTicket: FEX-1", "ladder-orchestrator", "haiku")).toContain(
      "fast rung",
    );
    expect(agent("Phase: explore\nTicket: FEX-1", "ladder-explorer-fast")).toBeUndefined();
  });

  test("unchecked handoffs pass through", () => {
    expect(agent("Phase: edit\nTicket: FEX-1", "ladder-edit-fast")).toBeUndefined();
    expect(agent("Phase: fix\nTicket: FEX-1", "ladder-edit-fast")).toBeUndefined();
    expect(agent("Ticket: FEX-1", "ladder-read-fast")).toBeUndefined();
    expect(agent("Context first\nPhase: plan", "ladder-read-fast")).toBeUndefined();
  });

  test("Phase must be the first non-empty line, ignoring surrounding whitespace", () => {
    expect(agent("\n\n  Phase: plan", "ladder-read-fast")).toBeDefined();
  });

  test("Task behaves like Agent", () => {
    expect(
      decide({
        tool_name: "Task",
        tool_input: { prompt: "Phase: plan", subagent_type: "ladder-read-fast" },
      }),
    ).toContain("deep rung");
  });

  test("other tools are not checked", () => {
    expect(decide({ tool_name: "Read", tool_input: { file_path: "x" } })).toBeUndefined();
  });
});

describe("brief guard: brief copies", () => {
  test("a complete brief passes the checker and the clipboard command", () => {
    const dir = tempDir();
    const text = brief();
    expect(briefProblems(text)).toEqual([]);
    const path = writeBrief(dir, "FEX-1.md", text);
    expect(bash(`pbcopy < ${path}`)).toBeUndefined();
  });

  test("a brief without ## Queue is denied", () => {
    const dir = tempDir();
    const path = writeBrief(
      dir,
      "FEX-1.md",
      brief(
        undefined,
        BRIEF_SECTIONS.filter((s: string) => s !== "## Queue"),
      ),
    );
    expect(bash(`pbcopy < ${path}`)).toContain("## Queue");
    expect(bash(`pbcopy<${path}`)).toContain("## Queue");
    expect(bash(`cat ${path}|pbcopy`)).toContain("## Queue");
    expect(bash(`cat ${path} | xclip -selection clipboard>/dev/null`)).toContain("## Queue");
  });

  test("a brief whose first line is not /continue is denied", () => {
    const dir = tempDir();
    const path = writeBrief(dir, "FEX-1.md", brief("Continue the epic"));
    expect(bash(`pbcopy < ${path}`)).toContain("/continue");
  });

  test("a brief without Phase: risk is denied", () => {
    const dir = tempDir();
    const path = writeBrief(
      dir,
      "FEX-1.md",
      brief(
        undefined,
        undefined,
        BRIEF_PHASES.filter((p: string) => p !== "Phase: risk"),
      ),
    );
    expect(bash(`pbcopy < ${path}`)).toContain("Phase: risk");
  });

  test("a relative brief path resolves against cwd", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-2.md", INCOMPLETE);
    expect(bash("cat agent-config/briefs/FEX-2.md | pbcopy", dir)).toBeDefined();
  });

  test("$HOME in the brief path expands to the home directory", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-3.md", INCOMPLETE);
    const original = process.env.HOME;
    try {
      process.env.HOME = dir;
      expect(bash('wl-copy < "$HOME/agent-config/briefs/FEX-3.md"')).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  test("a brief path with spaces is checked, quoted or escaped", () => {
    const dir = tempDir("brief dir ");
    const path = writeBrief(dir, "FEX-6.md", INCOMPLETE);
    expect(bash(`pbcopy < "${path}"`)).toContain("/continue");
    expect(bash(`cat '${path}' | pbcopy`)).toContain("/continue");
    expect(bash(`pbcopy < ${path.replaceAll(" ", "\\ ")}`)).toContain("/continue");
  });

  test("a ~/ brief path expands to the home directory", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-14.md", INCOMPLETE);
    const original = process.env.HOME;
    try {
      process.env.HOME = dir;
      expect(bash("pbcopy < ~/agent-config/briefs/FEX-14.md")).toContain("FEX-14.md");
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  test("file-descriptor redirects do not end the pipeline", () => {
    const dir = tempDir();
    const incomplete = writeBrief(dir, "FEX-15.md", INCOMPLETE);
    expect(bash(`cat ${incomplete} 2>&1 | pbcopy`)).toContain("FEX-15.md");
    expect(bash(`cat ${incomplete} |& pbcopy`)).toContain("FEX-15.md");
    expect(bash(`cat ${incomplete} >&2 | pbcopy`)).toContain("FEX-15.md");
    expect(bash(`cat ${incomplete} &>/dev/null | pbcopy`)).toContain("FEX-15.md");
    expect(bash(`cat ${incomplete} & echo hi | pbcopy`)).toContain("a command of its own");
  });

  test("a path-qualified tee writing the brief counts as a write", () => {
    const dir = tempDir();
    const complete = writeBrief(dir, "FEX-16.md", brief());
    expect(bash(`printf x | /usr/bin/tee ${complete} | pbcopy`)).toContain("a command of its own");
  });

  test("the project skill's portable brief folder expands with its default", () => {
    const dir = tempDir();
    writeBrief(join(dir, ".local", "state"), "FEX-19.md", brief());
    writeBrief(dir, "FEX-19.md", INCOMPLETE);
    const copy = 'pbcopy < "${XDG_STATE_HOME:-~/.local/state}/agent-config/briefs/FEX-19.md"';
    const original = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
    try {
      process.env.HOME = dir;
      delete process.env.XDG_STATE_HOME;
      expect(bash(copy)).toBeUndefined();
      process.env.XDG_STATE_HOME = dir;
      expect(bash(copy)).toContain("FEX-19.md");
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("environment variables in the brief path expand", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-7.md", INCOMPLETE);
    const original = process.env.XDG_STATE_HOME;
    try {
      process.env.XDG_STATE_HOME = dir;
      expect(bash('pbcopy < "${XDG_STATE_HOME}/agent-config/briefs/FEX-7.md"')).toBeDefined();
      expect(bash("pbcopy < $XDG_STATE_HOME/agent-config/briefs/FEX-7.md")).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
    }
  });

  test("reading an incomplete brief without a clipboard tool is allowed", () => {
    const dir = tempDir();
    const path = writeBrief(dir, "FEX-4.md", INCOMPLETE);
    expect(bash(`cat ${path}`)).toBeUndefined();
  });

  test("copying a brief that does not exist yet is denied", () => {
    const dir = tempDir();
    expect(bash(`pbcopy < ${dir}/agent-config/briefs/missing.md`)).toContain("does not exist");
  });

  test("writing and copying a brief in one command is denied", () => {
    const dir = tempDir();
    const fresh = join(dir, "agent-config", "briefs", "FEX-8.md");
    mkdirSync(join(dir, "agent-config", "briefs"), { recursive: true });
    const heredoc = `cat > ${fresh} <<'EOF'\n${brief()}\nEOF\npbcopy < ${fresh}`;
    expect(bash(heredoc)).toContain("a command of its own");
    const complete = writeBrief(dir, "FEX-9.md", brief());
    expect(bash(`printf x > ${complete} && pbcopy < ${complete}`)).toContain(
      "a command of its own",
    );
    expect(bash(`printf x | tee ${complete} | pbcopy`)).toContain("a command of its own");
  });

  test("a heredoc body is input, not shell code", () => {
    const dir = tempDir();
    const fresh = join(dir, "agent-config", "briefs", "FEX-17.md");
    const body = "the ticket's criteria\n\tand the epic goal";
    expect(bash(`cat > ${fresh} <<'EOF'\n${body}\nEOF\npbcopy < ${fresh}`)).toContain(
      "a command of its own",
    );
    expect(bash(`cat > ${fresh} <<-EOF\n${body}\n\tEOF\npbcopy < ${fresh}`)).toContain(
      "a command of its own",
    );
    const incomplete = writeBrief(dir, "FEX-18.md", INCOMPLETE);
    expect(bash(`cat <<EOF\ncat ${incomplete} | pbcopy\nEOF`)).toBeUndefined();
  });

  test("every brief a clipboard pipeline reads is checked", () => {
    const dir = tempDir();
    const complete = writeBrief(dir, "FEX-10.md", brief());
    const incomplete = writeBrief(dir, "FEX-11.md", INCOMPLETE);
    expect(bash(`cat ${complete} ${incomplete} | pbcopy`)).toContain("FEX-11.md");
    expect(bash(`LANG=C /usr/bin/pbcopy < ${incomplete}`)).toContain("FEX-11.md");
  });

  test("a clipboard command that names a brief must be the copy alone", () => {
    const dir = tempDir();
    const complete = writeBrief(dir, "FEX-12.md", brief());
    const own = "a command of its own";
    expect(bash(`cat ${complete} > /dev/null; echo hi | pbcopy`)).toContain(own);
    expect(bash(`pbcopy < ${complete} && echo copied`)).toContain(own);
    expect(bash(`cp other.md ${complete} && pbcopy < ${complete}`)).toContain(own);
    expect(bash(`sed -i '' s/a/b/ ${complete}; pbcopy < ${complete}`)).toContain(own);
    expect(bash(`sudo tee ${complete} | pbcopy`)).toContain(own);
    expect(bash(`xclip -selection clipboard ${complete}`)).toContain(own);
  });

  test("wrapper commands do not hide the clipboard tool", () => {
    const dir = tempDir();
    const incomplete = writeBrief(dir, "FEX-22.md", INCOMPLETE);
    expect(bash(`command pbcopy < ${incomplete}`)).toContain("FEX-22.md");
    expect(bash(`env LANG=C pbcopy < ${incomplete}`)).toContain("FEX-22.md");
    expect(bash(`sudo -n pbcopy < ${incomplete}`)).toContain("FEX-22.md");
    expect(bash(`sudo -u root pbcopy < ${incomplete}`)).toContain("FEX-22.md");
    expect(bash(`env -u LANG pbcopy < ${incomplete}`)).toContain("FEX-22.md");
  });

  test("a complete brief copied with a descriptor redirect passes", () => {
    const dir = tempDir();
    const complete = writeBrief(dir, "FEX-23.md", brief());
    expect(bash(`cat ${complete} 2>&1 | pbcopy`)).toBeUndefined();
    expect(bash(`cat ${complete} 2>/dev/null | pbcopy`)).toBeUndefined();
    expect(bash(`pbcopy < ${complete} 2>/dev/null`)).toBeUndefined();
  });

  test("copying a file outside the brief folder is allowed, even under a brief folder", () => {
    const dir = tempDir();
    for (const folder of [join(dir, ".claude", "skills", "brief"), join(dir, "briefs")]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), "# not a brief\n");
      expect(bash(`cat ${join(folder, "SKILL.md")} | pbcopy`)).toBeUndefined();
    }
  });

  test("copying a brief's path as text is allowed", () => {
    const dir = tempDir();
    const incomplete = writeBrief(dir, "FEX-20.md", INCOMPLETE);
    const missing = join(dir, "agent-config", "briefs", "FEX-21.md");
    expect(bash(`echo ${incomplete} | pbcopy`)).toBeUndefined();
    expect(bash(`printf '%s' ${missing} | pbcopy`)).toBeUndefined();
    expect(bash(`echo hi < ${incomplete} | pbcopy`)).toContain("FEX-20.md");
  });

  test("copying other text is allowed", () => {
    expect(bash("echo hi | pbcopy")).toBeUndefined();
  });
});

describe("brief guard: brief writes", () => {
  const write = (file_path: string, content: string) =>
    decide({ tool_name: "Write", tool_input: { file_path, content } });
  const path = join(tmpdir(), "state", "agent-config", "briefs", "FEX-13.md");

  test("an incomplete brief is denied before it is written", () => {
    expect(write(path, INCOMPLETE)).toContain("/continue");
  });

  test("a complete brief and other files are written", () => {
    expect(write(path, brief())).toBeUndefined();
    expect(write(join(tmpdir(), "notes.md"), INCOMPLETE)).toBeUndefined();
  });
});

describe("brief guard: runs as a hook", () => {
  test("denies through stdout and lets anything else through", () => {
    const script = join(import.meta.dirname, "..", "assets", "brief-guard.mjs");
    const hook = (input: string) => execFileSync("node", [script], { input, encoding: "utf8" });
    const denied = JSON.parse(
      hook(
        JSON.stringify({
          tool_name: "Agent",
          tool_input: { prompt: "Phase: plan\nTicket: FEX-1", subagent_type: "ladder-read-fast" },
        }),
      ),
    );
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("brief-guard");
    expect(
      hook(
        JSON.stringify({
          tool_name: "Agent",
          tool_input: { prompt: "Phase: plan", subagent_type: "ladder-read-deep" },
        }),
      ),
    ).toBe("");
    expect(hook("not json")).toBe("");
  });
});

describe("brief action: a store ticket with no epic", () => {
  test("a brief for a store ticket that is its own root passes the guard", () => {
    const text = briefMarkdown("claude", { fast: "f", balanced: "b", deep: "d" }, "~/x/briefs");
    const template = text.split("````markdown\n")[1]!.split("\n````")[0]!;
    const filled = template
      .replace("<EPIC-ID> <epic title>", "BCS-12 Store-only fix")
      .replace(/^- Ticket: .*$/m, "- Ticket: BCS-12 Store-only fix (no epic: its own root)");
    expect(filled).toContain("## Epic\n");
    expect(briefProblems(filled)).toEqual([]);
    const path = join(tmpdir(), "state", "agent-config", "briefs", "BCS-12.md");
    expect(
      decide({ tool_name: "Write", tool_input: { file_path: path, content: filled } }),
    ).toBeUndefined();
  });
});

describe("brief action: the brief template", () => {
  test.each(["claude", "opencode", "pi"] as const)(
    "the %s template is a valid brief",
    (runtime) => {
      const text = briefMarkdown(runtime, { fast: "f", balanced: "b", deep: "d" }, "~/x/briefs");
      const template = text.split("````markdown\n")[1]?.split("\n````")[0] ?? "";
      expect(template).not.toBe("");
      expect(briefProblems(template)).toEqual([]);
    },
  );
});

describe("brief guard: installed hook", () => {
  const root = join(import.meta.dirname, "..");
  const cli = join(root, "src", "cli.ts");
  const IMPORT_STATEMENT = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/gm;
  let home: string;
  let hooks: string;
  let installed: string;
  const importsOf = (text: string) =>
    [...text.matchAll(IMPORT_STATEMENT)].map((m) => ({
      names: m[1].split(",").map((n) => n.trim()),
      specifier: m[2],
    }));

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "agent-config-hook-"));
    for (const item of ["brief", "commit"]) {
      const res = spawnSync("node", [cli, "install", item, "--runtime", "claude", "--yes"], {
        env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
        encoding: "utf8",
      });
      if (res.status !== 0) throw new Error(`install ${item} failed: ${res.stderr}`);
    }
    hooks = join(home, ".claude", "hooks", "agent-config");
    installed = readFileSync(join(hooks, "brief-guard.mjs"), "utf8");
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("installed brief-guard.mjs has no relative import", () => {
    expect(installed).not.toMatch(/\bfrom\s*["']\.\.?\//);
  });

  test("installed brief-guard.mjs passes node --check", () => {
    const res = spawnSync("node", ["--check", join(hooks, "brief-guard.mjs")], {
      encoding: "utf8",
    });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  test("installed brief-guard.mjs has one import per node: module", () => {
    const imports = importsOf(installed);
    const specifiers = imports.map((i) => i.specifier);
    expect(new Set(specifiers).size).toBe(specifiers.length);
    expect(imports.every((i) => !i.specifier.startsWith("."))).toBe(true);
    const path = imports.filter((i) => i.specifier === "node:path");
    expect(path).toHaveLength(1);
    expect(path[0].names).toEqual(["basename", "isAbsolute", "join"]);
  });

  test("rendering merges a shell-split node: import into the hook's import for the same module", () => {
    const hook = [
      'import { join } from "node:path";',
      'import { x } from "./shell-split.mjs";',
      "",
      "console.log(x, join);",
      "",
    ].join("\n");
    const module = [
      "// splitter",
      'import { basename, join } from "node:path";',
      'import { readFileSync } from "node:fs";',
      "export const x = basename(readFileSync.name) + join();",
      "",
    ].join("\n");
    const out = inlineShellSplit(hook, module);
    expect(out.match(/from "node:path"/g)).toHaveLength(1);
    expect(out).toContain('import { basename, join } from "node:path";');
    expect(out.indexOf('import { readFileSync } from "node:fs";')).toBeGreaterThan(
      out.indexOf('import { basename, join } from "node:path";'),
    );
    expect(out).not.toContain("export ");
    expect(out).not.toContain("shell-split.mjs");
    expect(out).toContain("const x = ");
  });

  test("rendering leaves a hook without that import unchanged and rejects a relative import", () => {
    const hook = 'import { join } from "node:path";\nconsole.log(join);\n';
    expect(inlineShellSplit(hook, 'import { a } from "./other.mjs";')).toBe(hook);
    expect(() =>
      inlineShellSplit(
        'import { x } from "./shell-split.mjs";\n',
        'import { a } from "./other.mjs";\nexport const x = a;\n',
      ),
    ).toThrow("./other.mjs");
  });

  test("rendering inserts a new node: import after a leading shebang", () => {
    const hook = '#!/usr/bin/env node\nimport { x } from "./shell-split.mjs";\nconsole.log(x);\n';
    const module = 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n';
    const lines = inlineShellSplit(hook, module).split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env node");
    expect(lines[1]).toBe('import { readFileSync } from "node:fs";');
  });

  test("rendering rejects leftover exports, name collisions and unmergeable node: imports", () => {
    const hook = 'import { x } from "./shell-split.mjs";\n';
    expect(() => inlineShellSplit(hook, "export async function x() {}\n")).not.toThrow();
    expect(() => inlineShellSplit(hook, "export { x };\n")).toThrow("export");
    expect(() => inlineShellSplit(hook, "export default 1;\n")).toThrow("export");
    expect(() => inlineShellSplit(`${hook}const x = 1;\n`, "export function x() {}\n")).toThrow(
      "already declares",
    );
    expect(() =>
      inlineShellSplit(
        `import * as fs from "node:fs";\n${hook}`,
        'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
      ),
    ).toThrow("cannot be merged");
    expect(() =>
      inlineShellSplit(
        `import { join } from "node:path"; // c\n${hook}`,
        'import { basename } from "node:path";\nexport const x = basename;\n',
      ),
    ).toThrow("cannot be merged");
  });

  test("no shell-split.mjs is installed beside the hooks", () => {
    expect(existsSync(join(hooks, "shell-split.mjs"))).toBe(false);
  });

  test("installed brief-guard.mjs run from its install folder passes the hook decision cases", () => {
    const run = (payload: object) =>
      execFileSync("node", [join(hooks, "brief-guard.mjs")], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
      });
    const cases = [
      {
        tool_name: "Agent",
        tool_input: { prompt: "Phase: plan", subagent_type: "ladder-edit-fast" },
      },
      {
        tool_name: "Agent",
        tool_input: { prompt: "Phase: plan", subagent_type: "ladder-read-deep" },
      },
      {
        tool_name: "Bash",
        cwd: tmpdir(),
        tool_input: { command: "cat agent-config/briefs/FEX-404.md | pbcopy" },
      },
      { tool_name: "Bash", cwd: tmpdir(), tool_input: { command: "ls -la" } },
    ];
    for (const payload of cases) {
      const expected = decide(payload);
      const out = run(payload);
      if (expected === undefined) expect(out).toBe("");
      else {
        const output = JSON.parse(out).hookSpecificOutput;
        expect(output.permissionDecision).toBe("deny");
        expect(output.permissionDecisionReason).toBe(expected);
      }
    }
  });

  test("installed commit-guard.mjs is byte-identical to assets/commit-guard.mjs", () => {
    expect(readFileSync(join(hooks, "commit-guard.mjs"), "utf8")).toBe(
      readFileSync(join(root, "assets", "commit-guard.mjs"), "utf8"),
    );
  });
});
