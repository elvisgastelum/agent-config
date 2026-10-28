import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import * as guard from "../assets/planning-guard.mjs";

const { PLANNING_COMMAND_TAG, blockMessage, decide } = guard;

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

  test("hook run on an active transcript prints nothing while no rules exist", () => {
    const path = transcript(planningEntry);
    const result = spawnSync("node", [GUARD_PATH], {
      input: JSON.stringify(withTranscript(path)),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
