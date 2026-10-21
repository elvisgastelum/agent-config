import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import { BRIEF_PHASES, BRIEF_SECTIONS, briefProblems, decide } from "../assets/kick-off-guard.mjs";
import { kickOffMarkdown } from "../src/kickoff.ts";

const agent = (prompt: string, subagent_type: string, model?: string) =>
  decide({
    tool_name: "Agent",
    tool_input: { prompt, subagent_type, ...(model ? { model } : {}) },
  });
const bash = (command: string, cwd?: string) =>
  decide({ tool_name: "Bash", cwd, tool_input: { command } });

const dirs: string[] = [];
const tempDir = (prefix = "kick-off-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const writeBrief = (dir: string, name: string, text: string) => {
  mkdirSync(join(dir, "agent-config", "kick-off"), { recursive: true });
  const path = join(dir, "agent-config", "kick-off", name);
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
    ...sections.map((s) => (s === "# Kick-off:" ? `${s} FEX-1 Epic` : s)),
    ...phases.map((p) => `Run ${p} for each ticket`),
  ].join("\n");
const INCOMPLETE = "Continue the epic\n\n# Kick-off: FEX-2 Epic\n";

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("kick-off guard: phase rungs", () => {
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

describe("kick-off guard: brief copies", () => {
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
    expect(bash("cat agent-config/kick-off/FEX-2.md | pbcopy", dir)).toBeDefined();
  });

  test("$HOME in the brief path expands to the home directory", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-3.md", INCOMPLETE);
    const original = process.env.HOME;
    try {
      process.env.HOME = dir;
      expect(bash('wl-copy < "$HOME/agent-config/kick-off/FEX-3.md"')).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  test("a brief path with spaces is checked, quoted or escaped", () => {
    const dir = tempDir("kick off ");
    const path = writeBrief(dir, "FEX-6.md", INCOMPLETE);
    expect(bash(`pbcopy < "${path}"`)).toContain("/continue");
    expect(bash(`cat '${path}' | pbcopy`)).toContain("/continue");
    expect(bash(`pbcopy < ${path.replaceAll(" ", "\\ ")}`)).toContain("/continue");
  });

  test("environment variables in the brief path expand", () => {
    const dir = tempDir();
    writeBrief(dir, "FEX-7.md", INCOMPLETE);
    const original = process.env.XDG_STATE_HOME;
    try {
      process.env.XDG_STATE_HOME = dir;
      expect(bash('pbcopy < "${XDG_STATE_HOME}/agent-config/kick-off/FEX-7.md"')).toBeDefined();
      expect(bash("pbcopy < $XDG_STATE_HOME/agent-config/kick-off/FEX-7.md")).toBeDefined();
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

  test("copying a missing brief is allowed", () => {
    const dir = tempDir();
    expect(bash(`pbcopy < ${dir}/agent-config/kick-off/missing.md`)).toBeUndefined();
  });

  test("copying a file outside the brief folder is allowed, even under a kick-off folder", () => {
    const dir = tempDir();
    for (const folder of [join(dir, ".claude", "skills", "kick-off"), join(dir, "kick-off")]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), "# not a brief\n");
      expect(bash(`cat ${join(folder, "SKILL.md")} | pbcopy`)).toBeUndefined();
    }
  });

  test("copying other text is allowed", () => {
    expect(bash("echo hi | pbcopy")).toBeUndefined();
  });
});

describe("kick-off guard: runs as a hook", () => {
  test("denies through stdout and lets anything else through", () => {
    const script = join(import.meta.dirname, "..", "assets", "kick-off-guard.mjs");
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
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("kick-off-guard");
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

describe("kick-off action: the brief template", () => {
  test.each(["claude", "opencode", "pi"] as const)(
    "the %s template is a valid brief",
    (runtime) => {
      const text = kickOffMarkdown(
        runtime,
        { fast: "f", balanced: "b", deep: "d" },
        "~/x/kick-off",
      );
      const template = text.split("````markdown\n")[1]?.split("\n````")[0] ?? "";
      expect(template).not.toBe("");
      expect(briefProblems(template)).toEqual([]);
    },
  );
});
