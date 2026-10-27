import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { PYTHON_FALLBACK } from "../src/planning.ts";
import { tomlMultiline } from "../src/runtimes.ts";
import { RUNTIMES, type Runtime } from "../src/tiers.ts";
import { read } from "./helpers.ts";

test("escapes backslashes, quote runs and control characters in TOML strings", () => {
  expect(tomlMultiline('a\\b """ c\r\u0001\td')).toBe('"""\na\\\\b ""\\" c\\r\\u0001\td"""');
});

describe("store fallback on every runtime", () => {
  const cli = join(import.meta.dirname, "..", "src", "cli.ts");
  const ACTION_FILES: Record<Runtime, (name: string) => string> = {
    claude: (name) => `.claude/skills/${name}/SKILL.md`,
    opencode: (name) => `.config/opencode/commands/${name}.md`,
    codex: (name) => `.codex/skills/${name}/SKILL.md`,
    pi: (name) => `.pi/agent/prompts/${name}.md`,
  };
  let home: string;
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "agent-config-runtimes-"));
    const runtimes = RUNTIMES.flatMap((r) => ["--runtime", r]);
    for (const item of ["continue", "brief"]) {
      const res = spawnSync("node", [cli, "install", item, ...runtimes, "--yes"], {
        env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
    }
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test.each(RUNTIMES.flatMap((runtime) => ["brief", "continue"].map((name) => [runtime, name])))(
    "%s /%s carries the store fallback, the write prefix and the python3 line",
    (runtime, name) => {
      const text = read(join(home, ACTION_FILES[runtime as Runtime](name!)));
      expect(text).toContain("## Plan store fallback");
      expect(text).toContain("Fall back to the stores only when Kaneo is not installed");
      expect(text).toContain("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      expect(text).toContain(PYTHON_FALLBACK);
      expect(text).toContain("| Store reads and writes |");
      expect(text).not.toContain(".timeout");
      if (runtime === "codex") {
        expect(text).toContain("`$continue`");
        expect(text).not.toContain("`/continue");
      } else {
        expect(text).toContain("`/continue");
      }
    },
  );

  test("the Claude brief guard hook is still installed, unchanged", () => {
    const installed = read(join(home, ".claude/hooks/agent-config/brief-guard.mjs"));
    expect(installed).toBe(read(join(import.meta.dirname, "..", "assets", "brief-guard.mjs")));
    const hooks = JSON.parse(read(join(home, ".claude/settings.json"))).hooks.PreToolUse as {
      matcher: string;
      hooks: { command: string }[];
    }[];
    expect(hooks.some((e) => e.hooks.some((h) => h.command.includes("brief-guard.mjs")))).toBe(
      true,
    );
  });
});
