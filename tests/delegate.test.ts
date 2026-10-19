import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { parseStatus } from "../src/delegate.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
let dir: string;
let log: string;

// Fake runtimes: they log their argv, stdin and delegation marker, and answer per model
// from FAKE_PLAN ("model=status,..."). Codex writes its reply to the -o file like the real one.
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = args.includes("-") ? fs.readFileSync(0, "utf8") : "";
const flag = args.includes("--model") ? "--model" : args.includes("-m") ? "-m" : "";
const model = flag ? args[args.indexOf(flag) + 1] : "default";
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: process.argv[1], args, stdin, delegated: process.env.MODEL_LADDER_DELEGATED }) + "\\n");
const plan = Object.fromEntries((process.env.FAKE_PLAN || "").split(",").filter(Boolean).map((p) => p.split("=")));
const status = plan[model] || "done";
if (status === "crash") { process.stderr.write("boom\\n"); process.exit(7); }
const reply = "STATUS: " + status + "\\nANSWER:\\n- answered by " + model;
if (process.argv[1].endsWith("claude")) process.stdout.write(JSON.stringify({ type: "result", result: reply, is_error: false }));
else if (args.includes("-o")) fs.writeFileSync(args[args.indexOf("-o") + 1], reply);
else process.stdout.write(reply);
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "model-ladder-delegate-"));
  log = join(dir, "calls.jsonl");
  for (const bin of ["claude", "codex"]) {
    writeFileSync(join(dir, bin), FAKE);
    chmodSync(join(dir, bin), 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}, input?: string) {
  const res = spawnSync("node", [cli, ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, FAKE_LOG: log, NO_COLOR: "1", ...env },
    encoding: "utf8",
    input,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function calls(): { bin: string; args: string[]; stdin: string; delegated?: string }[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("climbs from fast to balanced and prints only the final reply", () => {
  const res = run(["delegate", "read", "--runtime", "claude", "Where is X?"], {
    FAKE_PLAN: "claude-haiku-5-5=escalate",
  });
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("STATUS: done\nANSWER:\n- answered by claude-sonnet-5-5");
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
  expect(first?.args.at(-1)).toBe("Where is X?");
  expect(second?.args.at(-1)).toContain("Previous attempt (fast rung, STATUS: escalate)");
});

test("marks the agents it starts so they cannot delegate again", () => {
  run(["delegate", "edit", "--runtime", "claude", "write it"]);
  const [call] = calls();
  expect(call?.delegated).toBe("1");
  expect(call?.args).toEqual(
    expect.arrayContaining([
      "--agent",
      "ladder-edit-fast",
      "--permission-mode",
      "acceptEdits",
      "Bash",
    ]),
  );

  const nested = run(["delegate", "read", "--runtime", "claude", "x"], {
    MODEL_LADDER_DELEGATED: "1",
  });
  expect(nested.code).toBe(4);
  expect(nested.stderr).toContain("no nested delegation");
  expect(calls()).toHaveLength(1);
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

test("a crashing agent climbs; failing on every rung exits 1", () => {
  const res = run(["delegate", "read", "--runtime", "claude", "--json", "q"], {
    FAKE_PLAN: "claude-haiku-5-5=crash,claude-sonnet-5-5=crash,claude-opus-5-5=crash",
  });
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).attempts.map((a: { tier: string }) => a.tier)).toEqual([
    "fast",
    "balanced",
    "deep",
  ]);
});

test("codex gets the agent instructions on stdin, the sandbox and effort, and replies through -o", () => {
  const res = run(
    ["delegate", "read", "--runtime", "codex", "--tier", "deep"],
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

test("a missing runtime fails once instead of climbing", () => {
  const res = spawnSync(
    process.execPath,
    [cli, "delegate", "read", "--runtime", "pi", "--json", "q"],
    {
      env: { PATH: "/usr/bin:/bin", HOME: dir },
      encoding: "utf8",
    },
  );
  expect(res.status).toBe(1);
  const out = JSON.parse(res.stdout);
  expect(out.attempts).toHaveLength(1);
  expect(out.attempts[0].error).toContain("pi is not installed");
});

test("usage errors exit 2", () => {
  expect(run(["delegate", "write", "--runtime", "claude", "q"]).code).toBe(2);
  expect(run(["delegate", "read", "--runtime", "claude", "--tier", "huge", "q"]).code).toBe(2);
  expect(run(["delegate", "read", "--runtime", "claude"], {}, "").code).toBe(2);
});

test("parses the STATUS line, defaulting to partial", () => {
  expect(parseStatus("STATUS: done\nANSWER: x")).toBe("done");
  expect(parseStatus("  status: Escalate - needs judgment")).toBe("escalate");
  expect(parseStatus("no status here")).toBe("partial");
});
