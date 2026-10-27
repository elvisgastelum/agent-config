import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { parseStatus, safePrompt } from "../src/delegate.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
let dir: string;
let log: string;

// Fake runtimes: they log their argv, stdin and delegation marker, and answer per model from
// FAKE_PLAN ("model=status,..."): done, partial, escalate, crash or sleep. Codex writes its
// reply to the -o file like the real one; Claude wraps it in --output-format json.
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = args.includes("-") ? fs.readFileSync(0, "utf8") : "";
const flag = args.includes("--model") ? "--model" : args.includes("-m") ? "-m" : "";
const model = flag ? args[args.indexOf(flag) + 1] : "default";
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: process.argv[1].split("/").pop(), args, stdin, delegated: process.env.AGENT_CONFIG_DELEGATED }) + "\\n");
const plan = Object.fromEntries((process.env.FAKE_PLAN || "").split(",").filter(Boolean).map((p) => p.split("=")));
const status = plan[model] || "done";
if (status === "crash") { process.stderr.write("boom\\n"); process.exit(7); }
if (status === "sleep") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); }
const reply = "STATUS: " + status + "\\nANSWER:\\n- answered by " + model;
if (process.argv[1].endsWith("claude")) process.stdout.write(JSON.stringify({ type: "result", result: reply, is_error: false }));
else if (args.includes("-o")) fs.writeFileSync(args[args.indexOf("-o") + 1], reply);
else process.stdout.write(reply);
`;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${dir}/bin:${process.env.PATH}`,
    HOME: dir,
    FAKE_LOG: log,
    NO_COLOR: "1",
    ...extra,
  };
}

function run(args: string[], extra: Record<string, string> = {}, input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    env: env(extra),
    encoding: "utf8",
    input: input ?? "",
    timeout: 30_000,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function calls(): { bin: string; args: string[]; stdin: string; delegated?: string }[] {
  try {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "model-ladder-delegate-"));
  log = join(dir, "calls.jsonl");
  mkdirSync(join(dir, "bin"));
  for (const bin of ["claude", "codex", "opencode", "pi"]) {
    writeFileSync(join(dir, "bin", bin), FAKE);
    chmodSync(join(dir, "bin", bin), 0o755);
  }
  // Claude and OpenCode pick ladder agents by name, so install their agent files.
  const installed = run([
    "install",
    "--runtime",
    "claude",
    "--runtime",
    "opencode",
    "--component",
    "agents",
    "--yes",
  ]);
  expect(installed.code).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("climbs from fast to balanced and prints only the final reply", () => {
  const res = run(["delegate", "read", "--runtime", "claude", "Where is X?"], {
    FAKE_PLAN: "claude-haiku-5-5=escalate",
  });
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("STATUS: done\nANSWER:\n- answered by claude-sonnet-5-5");
  expect(res.stderr).toContain("read fast (claude-haiku-5-5) running…");
  expect(res.stderr).toContain("read fast (claude-haiku-5-5) → escalate");
  expect(res.stderr).toContain("read balanced (claude-sonnet-5-5) → done");
  const [first, second] = calls();
  expect(first?.args).toEqual(
    expect.arrayContaining([
      "-p",
      "--agent",
      "ladder-read-fast",
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
    ]),
  );
  expect(first?.args.slice(-2)).toEqual(["--", "Where is X?"]);
  expect(second?.args.at(-1)).toContain("Previous attempt (fast rung, STATUS: escalate)");
});

test("claude edits get a shell only for the --verify command", () => {
  run(["delegate", "edit", "--runtime", "claude", "write it"]);
  run(["delegate", "edit", "--runtime", "claude", "--verify", "npm test", "write it"]);
  const [plain, verified] = calls();
  expect(plain?.delegated).toBe("1");
  expect(plain?.args).toEqual(
    expect.arrayContaining(["--agent", "ladder-edit-fast", "--permission-mode", "acceptEdits"]),
  );
  expect(plain?.args.some((a) => a.startsWith("Bash"))).toBe(false);
  expect(verified?.args).toContain("Bash(npm test)");
  expect(verified?.args.at(-1)).toContain(
    "Verify command (the only shell command you may run): npm test",
  );
});

test("refuses to run inside an agent it started, under the new or the pre-rename marker", () => {
  for (const marker of ["AGENT_CONFIG_DELEGATED", "MODEL_LADDER_DELEGATED"]) {
    const nested = run(["delegate", "read", "--runtime", "claude", "x"], { [marker]: "1" });
    expect(nested.code).toBe(4);
    expect(nested.stderr).toContain("no nested delegation");
  }
  expect(calls()).toHaveLength(0);
});

test("--no-climb stops on the first rung and exits 3 when not done", () => {
  const res = run(["delegate", "read", "--runtime", "claude", "--no-climb", "--json", "q"], {
    FAKE_PLAN: "claude-haiku-5-5=partial",
  });
  expect(res.code).toBe(3);
  const out = JSON.parse(res.stdout);
  expect(out.status).toBe("partial");
  expect(out.attempts).toHaveLength(1);
});

test("a crashing agent climbs; failing on every rung exits 1 with the exit code reported", () => {
  const res = run(["delegate", "read", "--runtime", "claude", "--json", "q"], {
    FAKE_PLAN: "claude-haiku-5-5=crash,claude-sonnet-5-5=crash,claude-opus-5-5=crash",
  });
  expect(res.code).toBe(1);
  const out = JSON.parse(res.stdout);
  expect(out.attempts.map((a: { tier: string }) => a.tier)).toEqual(["fast", "balanced", "deep"]);
  expect(out.attempts[0].error).toBe("claude exited with 7: boom");
});

test("a rung that runs too long is reported as a timeout, and --max-time stops climbing", () => {
  const res = run(
    ["delegate", "read", "--runtime", "claude", "--timeout", "1", "--max-time", "1", "--json", "q"],
    {
      FAKE_PLAN: "claude-haiku-5-5=sleep",
    },
  );
  expect(res.code).toBe(1);
  const out = JSON.parse(res.stdout);
  expect(out.attempts).toHaveLength(1);
  expect(out.attempts[0].error).toBe("timed out after 1s");
});

test("codex gets the agent instructions and the task on stdin, the sandbox and effort, and replies through -o", () => {
  const res = run(
    ["delegate", "read", "--runtime", "codex", "--tier", "deep", "-"],
    {},
    "Summarize the logs",
  );
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("answered by default");
  const [call] = calls();
  expect(call?.args).toEqual(
    expect.arrayContaining(["exec", "-s", "read-only", "-c", 'model_reasoning_effort="high"']),
  );
  expect(call?.stdin).toContain("You are a read-only worker on the model ladder");
  expect(call?.stdin).toContain("Summarize the logs");
});

test("opencode runs the installed agent by name and protects a task that starts with -", () => {
  const res = run(["delegate", "read", "--runtime", "opencode", "--", "- list the callers"]);
  expect(res.code).toBe(0);
  const [call] = calls();
  expect(call?.args.slice(0, 5)).toEqual([
    "run",
    "--agent",
    "ladder-read-fast",
    "--model",
    "anthropic/claude-haiku-5-5",
  ]);
  expect(call?.args.at(-1)).toBe("Task:\n- list the callers");
});

test("opencode refuses a read agent that no longer denies edits", () => {
  const agent = join(dir, ".config/opencode/agents/ladder-read-fast.md");
  writeFileSync(agent, readFileSync(agent, "utf8").replace("  edit: deny\n", ""));
  const res = run(["delegate", "read", "--runtime", "opencode", "--json", "q"]);
  expect(res.code).toBe(1);
  const out = JSON.parse(res.stdout);
  expect(out.attempts).toHaveLength(1);
  expect(out.attempts[0].error).toContain("no longer denies edit and bash");
  expect(calls()).toHaveLength(0);
});

test("pi gets read tools for reads, and bash for edits only with --verify", () => {
  run(["delegate", "read", "--runtime", "pi", "q"]);
  run(["delegate", "edit", "--runtime", "pi", "q"]);
  run(["delegate", "edit", "--runtime", "pi", "--verify", "make test", "q"]);
  const [read, edit, verified] = calls();
  expect(read?.args).toEqual(
    expect.arrayContaining([
      "-p",
      "--no-session",
      "--tools",
      "read,grep,find,ls",
      "--thinking",
      "low",
    ]),
  );
  expect(read?.args).toContain("--append-system-prompt");
  expect(edit?.args).toEqual(expect.arrayContaining(["--tools", "read,grep,find,ls,edit,write"]));
  expect(verified?.args).toEqual(
    expect.arrayContaining(["--tools", "read,grep,find,ls,edit,write,bash"]),
  );
});

test("explore, research and review run their agents with read-only tools per runtime", () => {
  expect(run(["delegate", "explore", "--runtime", "claude", "map it"]).code).toBe(0);
  run(["delegate", "research", "--runtime", "claude", "find it"]);
  run(["delegate", "review", "--runtime", "claude", "--tier", "deep", "review it"]);
  run(["delegate", "research", "--runtime", "codex", "find it"]);
  run(["delegate", "review", "--runtime", "codex", "review it"]);
  run(["delegate", "explore", "--runtime", "pi", "map it"]);
  run(["delegate", "review", "--runtime", "pi", "review it"]);
  const [explore, research, review, codexResearch, codexReview, piExplore, piReview] = calls();
  expect(explore?.args).toEqual(expect.arrayContaining(["--agent", "ladder-explorer-fast"]));
  expect(explore?.args.some((a) => a.startsWith("Bash") || a === "Edit")).toBe(false);
  expect(research?.args).toEqual(
    expect.arrayContaining(["--agent", "ladder-researcher-fast", "WebSearch", "WebFetch"]),
  );
  expect(review?.args).toEqual(
    expect.arrayContaining(["--agent", "ladder-reviewer-deep", "Bash(git diff:*)"]),
  );
  expect(review?.args).not.toContain("Bash");
  expect(review?.args).not.toContain("--permission-mode");
  expect(codexResearch?.args.slice(0, 2)).toEqual(["--search", "exec"]);
  expect(codexResearch?.args).toEqual(expect.arrayContaining(["-s", "read-only"]));
  expect(codexResearch?.stdin).toContain("You are a researcher on the model ladder");
  expect(codexReview?.args).toEqual(expect.arrayContaining(["-s", "read-only"]));
  expect(codexReview?.args).not.toContain("--search");
  expect(piExplore?.args).toEqual(expect.arrayContaining(["--tools", "read,grep,find,ls"]));
  expect(piReview?.args).toEqual(expect.arrayContaining(["--tools", "read,grep,find,ls,bash"]));
});

test("design and ux run their agents read-only, without a shell", () => {
  expect(
    run(["delegate", "design", "--runtime", "claude", "--tier", "balanced", "rules"]).code,
  ).toBe(0);
  run(["delegate", "ux", "--runtime", "codex", "flow"]);
  run(["delegate", "ux", "--runtime", "pi", "flow"]);
  const [design, codexUx, piUx] = calls();
  expect(design?.args).toEqual(expect.arrayContaining(["--agent", "ladder-designer-balanced"]));
  expect(design?.args.some((a) => a.startsWith("Bash") || a === "Edit" || a === "Write")).toBe(
    false,
  );
  expect(design?.args).not.toContain("--permission-mode");
  // Headless runs deny tools that are not allowed up front, so the Figma servers are listed.
  expect(design?.args).toEqual(expect.arrayContaining(["mcp__plugin_figma_figma", "mcp__figma"]));
  expect(codexUx?.args).toEqual(expect.arrayContaining(["-s", "read-only"]));
  expect(codexUx?.stdin).toContain("You are a user-experience analyst on the model ladder");
  expect(piUx?.args).toEqual(expect.arrayContaining(["--tools", "read,grep,find,ls"]));
});

test("opencode refuses a reviewer whose shell is no longer limited", () => {
  const agent = join(dir, ".config/opencode/agents/ladder-reviewer-fast.md");
  writeFileSync(agent, readFileSync(agent, "utf8").replace('    "*": deny\n', ""));
  const res = run(["delegate", "review", "--runtime", "opencode", "--no-climb", "--json", "q"]);
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).attempts[0].error).toContain("no longer denies edit and bash");
  expect(calls()).toHaveLength(0);
});

test("an edit that climbs tells the next rung which files are already changed", () => {
  const work = join(dir, "work");
  mkdirSync(work);
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", work, ...a], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
      },
    });
  git("init", "-q");
  writeFileSync(join(work, "retry.ts"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  writeFileSync(join(work, "retry.ts"), "a\nhalf done\n");
  run(["delegate", "edit", "--runtime", "claude", "--cwd", work, "fix retry"], {
    FAKE_PLAN: "claude-haiku-5-5=partial",
  });
  const second = calls()[1];
  expect(second?.args.at(-1)).toContain("already changed these files");
  expect(second?.args.at(-1)).toContain("retry.ts");
});

test("a missing runtime or agent fails once instead of climbing", () => {
  const res = spawnSync(
    process.execPath,
    [cli, "delegate", "read", "--runtime", "pi", "--json", "q"],
    {
      env: { PATH: "/usr/bin:/bin", HOME: dir },
      encoding: "utf8",
    },
  );
  expect(res.status).toBe(1);
  expect(JSON.parse(res.stdout).attempts[0].error).toContain("pi is not installed");

  rmSync(join(dir, ".claude/agents/ladder-read-fast.md"));
  const missing = JSON.parse(
    run(["delegate", "read", "--runtime", "claude", "--json", "q"]).stdout,
  );
  expect(missing.attempts).toHaveLength(1);
  expect(missing.attempts[0].error).toContain("ladder-read-fast is not installed for claude");
});

test("picks the runtime from AGENT_CONFIG_RUNTIME, then Claude Code, then the configured one", () => {
  run(["delegate", "read", "q"], { AGENT_CONFIG_RUNTIME: "codex", CLAUDECODE: "1" });
  run(["delegate", "read", "q"], { CLAUDECODE: "1" });
  run(["delegate", "read", "q"]);
  run(["delegate", "read", "q"], { MODEL_LADDER_RUNTIME: "pi" });
  expect(calls().map((c) => c.bin)).toEqual(["codex", "claude", "claude", "pi"]);
});

test("usage errors exit 2 without starting an agent", () => {
  expect(run(["delegate", "write", "--runtime", "claude", "q"]).code).toBe(2);
  expect(run(["delegate", "read", "--runtime", "claude", "--tier", "huge", "q"]).code).toBe(2);
  expect(run(["delegate", "read", "--runtime", "claude", "-"], {}, "").code).toBe(2);
  expect(run(["delegate", "read", "--runtime", "claude", "--verify", "x", "q"]).code).toBe(2);
  expect(run(["delegate", "review", "--runtime", "claude", "--verify", "x", "q"]).code).toBe(2);
  expect(run(["delegate", "write", "--runtime", "claude", "q"]).stderr).toContain(
    "read, explore, research, design, ux, edit, review",
  );
  expect(
    run(["delegate", "read", "--runtime", "claude", "--cwd", join(dir, "nope"), "q"]).stderr,
  ).toContain("is not a directory");
  expect(run(["delegate", "read", "--runtime", "claude", "--yes", "q"]).stderr).toContain(
    "--yes does not apply to delegate",
  );
  expect(run(["install", "--tier", "deep", "--yes"]).stderr).toContain(
    "--tier only applies to delegate",
  );
  expect(calls()).toHaveLength(0);
});

test("never reads stdin unless asked with -", () => {
  const res = run(["delegate", "read", "--runtime", "claude"], {}, "this would be the task");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain('"-" to read stdin');
  expect(calls()).toHaveLength(0);
});

test("parses the STATUS line, defaulting to partial, and protects leading dashes", () => {
  expect(parseStatus("STATUS: done\nANSWER: x")).toBe("done");
  expect(parseStatus("  status: Escalate - needs judgment")).toBe("escalate");
  expect(parseStatus("no status here")).toBe("partial");
  expect(safePrompt("--model x")).toBe("Task:\n--model x");
  expect(safePrompt("Question: y")).toBe("Question: y");
});
