import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import { bashTargets, decide, words } from "../assets/read-guard.mjs";

const dir = mkdtempSync(join(tmpdir(), "model-ladder-guard-"));
const big = join(dir, "big.ts");
const small = join(dir, "small.ts");
writeFileSync(big, "x\n".repeat(400));
writeFileSync(small, "x\n".repeat(20));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const env = {};
const read = (extra: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  decide({ tool_name: "Read", cwd: dir, tool_input: { file_path: big, ...extra }, ...more }, env);
const bash = (command: string) =>
  decide({ tool_name: "Bash", cwd: dir, tool_input: { command } }, env);

describe("Read", () => {
  test("denies a whole read of a large file in the main session", () => {
    expect(read({})).toContain("ladder-read-fast");
  });
  test("allows ranged reads, small files and subagents", () => {
    expect(read({ offset: 10, limit: 50 })).toBeUndefined();
    expect(decide({ tool_name: "Read", tool_input: { file_path: small } }, env)).toBeUndefined();
    expect(read({}, { agent_id: "a1", agent_type: "ladder-read-fast" })).toBeUndefined();
  });
  test("guards the orchestrator subagent and points it at agent-config delegate", () => {
    const reason = read({}, { agent_id: "a1", agent_type: "ladder-orchestrator" });
    expect(reason).toContain('agent-config delegate read --runtime claude "<question>"');
    expect(reason).not.toContain("subagent_type");
    expect(read({ offset: 1, limit: 20 }, { agent_type: "ladder-orchestrator" })).toBeUndefined();
  });
  test("honours the threshold and the off switch", () => {
    expect(
      decide(
        { tool_name: "Read", tool_input: { file_path: big } },
        { AGENT_CONFIG_MIN_LINES: "500" },
      ),
    ).toBeUndefined();
    expect(
      decide({ tool_name: "Read", tool_input: { file_path: big } }, { AGENT_CONFIG_GUARD: "off" }),
    ).toBeUndefined();
    // The pre-rename names still work.
    expect(
      decide({ tool_name: "Read", tool_input: { file_path: big } }, { MODEL_LADDER_GUARD: "off" }),
    ).toBeUndefined();
    expect(
      decide(
        { tool_name: "Read", tool_input: { file_path: big } },
        { MODEL_LADDER_MIN_LINES: "500" },
      ),
    ).toBeUndefined();
  });
  test("ignores missing and non-text files", () => {
    expect(read({ file_path: join(dir, "nope.ts") })).toBeUndefined();
    expect(read({ file_path: join(dir, "shot.png") })).toBeUndefined();
  });
});

describe("Bash", () => {
  test("denies cat of a large file, relative to cwd", () => {
    expect(bash("cat big.ts")).toContain("big.ts");
  });
  test("allows pipes, short head/tail and small files", () => {
    expect(bash("cat big.ts | grep x")).toBeUndefined();
    expect(bash("head -n 20 big.ts")).toBeUndefined();
    expect(bash("tail big.ts")).toBeUndefined();
    expect(bash("cat small.ts")).toBeUndefined();
  });
  test("denies head/tail with a count at or over the threshold", () => {
    expect(bash("head -n 500 big.ts")).toBeDefined();
    expect(bash("tail -n +1 big.ts")).toBeDefined();
    expect(bashTargets("head -400 a b", 350)).toEqual(["a", "b"]);
  });
});

describe("Bash parsing", () => {
  test("sees through quotes, ~, $HOME and leading env assignments", () => {
    const env = { HOME: dir };
    expect(bashTargets('cat "big.ts"', 350, env)).toEqual(["big.ts"]);
    expect(bashTargets("cat ~/big.ts", 350, env)).toEqual([`${dir}/big.ts`]);
    expect(bashTargets("cat $HOME/big.ts", 350, env)).toEqual([`${dir}/big.ts`]);
    expect(bashTargets("LC_ALL=C cat big.ts", 350, env)).toEqual(["big.ts"]);
    expect(words("cat 'a b' c\\ d", env)).toEqual(["cat", "a b", "c d"]);
  });
  test("lets ranged bat, other variables and substitutions through", () => {
    expect(bashTargets("bat -r 1:10 big.ts", 350)).toEqual([]);
    expect(bashTargets("bat --line-range=1:10 big.ts", 350)).toEqual([]);
    expect(bashTargets("cat $FILE", 350)).toEqual([]);
    expect(bashTargets("cat $(ls)", 350)).toEqual([]);
    expect(bashTargets("cat 'unterminated", 350)).toEqual([]);
  });
});

test("runs as a hook: JSON deny on stdout, silence otherwise", () => {
  const script = join(import.meta.dirname, "..", "assets", "read-guard.mjs");
  const run = (input: unknown) =>
    execFileSync("node", [script], {
      input: JSON.stringify(input),
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
  const out = JSON.parse(run({ tool_name: "Read", tool_input: { file_path: big } }));
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(run({ tool_name: "Read", tool_input: { file_path: small } })).toBe("");
  expect(execFileSync("node", [script], { input: "not json", encoding: "utf8" })).toBe("");
});
