import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { BLOCK_BEGIN, LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END, BLOCK_END } from "../src/ops.ts";
import { put, read } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-config-migrate-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const p = (...parts: string[]) => join(home, ...parts);

function rewrite(path: string, from: string, to: string): void {
  writeFileSync(path, read(path).split(from).join(to));
}

/**
 * Builds the layout a pre-rename (model-ladder 0.2.0) install left behind: the same files,
 * but under the old state, config and hook folders, the old setting name and block markers.
 */
function legacyInstall(): { memory: string; settings: string; skill: string } {
  const memory = "# mine\n";
  const settings = `{\n  "env": { "FOO": "1" }\n}\n`;
  const skill = "my own skill\n";
  put(p(".claude/CLAUDE.md"), memory);
  put(p(".claude/settings.json"), settings);
  put(p(".claude/skills/model-ladder/SKILL.md"), skill);
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);

  renameSync(p(".local/state/agent-config"), p(".local/state/model-ladder"));
  renameSync(p(".config/agent-config"), p(".config/model-ladder"));
  renameSync(p(".claude/hooks/agent-config"), p(".claude/hooks/model-ladder"));
  const manifest = p(".local/state/model-ladder/manifest.json");
  rewrite(manifest, "/.local/state/agent-config/", "/.local/state/model-ladder/");
  rewrite(manifest, "/hooks/agent-config", "/hooks/model-ladder");
  rewrite(manifest, "AGENT_CONFIG_MIN_LINES", "MODEL_LADDER_MIN_LINES");
  rewrite(p(".claude/settings.json"), "/hooks/agent-config", "/hooks/model-ladder");
  rewrite(p(".claude/settings.json"), "AGENT_CONFIG_MIN_LINES", "MODEL_LADDER_MIN_LINES");
  rewrite(p(".claude/CLAUDE.md"), BLOCK_BEGIN, LEGACY_BLOCK_BEGIN);
  rewrite(p(".claude/CLAUDE.md"), BLOCK_END, LEGACY_BLOCK_END);
  return { memory, settings, skill };
}

test("moves the pre-rename state and configuration on first run", () => {
  legacyInstall();
  const res = run("status", "--json");
  expect(res.stderr).toContain("renamed from model-ladder");
  expect(existsSync(p(".local/state/model-ladder"))).toBe(false);
  expect(existsSync(p(".config/model-ladder"))).toBe(false);
  expect(JSON.parse(read(p(".config/agent-config/config.json"))).runtimes).toEqual(["claude"]);
  const backups = JSON.parse(read(p(".local/state/agent-config/manifest.json")))
    .records.map((r: { backup?: string }) => r.backup)
    .filter(Boolean);
  expect(backups).toHaveLength(1);
  expect(backups[0]).toContain("/.local/state/agent-config/backups/");
  expect(read(backups[0])).toBe("my own skill\n");
  // The old block markers still count as installed.
  expect(JSON.parse(res.stdout).entries.every((e: { state: string }) => e.state === "ok")).toBe(
    true,
  );
});

test("re-installing replaces the old hook, setting and block instead of adding to them", () => {
  legacyInstall();
  const res = run("install", "--runtime", "claude", "--yes", "--json");
  expect(res.code).toBe(0);
  const removed = JSON.parse(res.stdout).plan.filter(
    (x: { action: string }) => x.action === "remove",
  );
  expect(removed.map((x: { path: string }) => x.path.replace(home, "~")).sort()).toEqual([
    "~/.claude/hooks/model-ladder/read-guard.mjs",
    "~/.claude/settings.json",
    "~/.claude/settings.json",
  ]);

  const settings = JSON.parse(read(p(".claude/settings.json")));
  expect(settings.env).toEqual({ FOO: "1", AGENT_CONFIG_MIN_LINES: "350" });
  const commands = settings.hooks.PreToolUse.flatMap((g: { hooks: { command: string }[] }) =>
    g.hooks.map((h) => h.command),
  );
  expect(commands).toEqual([`node "${p(".claude/hooks/agent-config/read-guard.mjs")}"`]);
  expect(existsSync(p(".claude/hooks/model-ladder"))).toBe(false);

  const memory = read(p(".claude/CLAUDE.md"));
  expect(memory.split(BLOCK_BEGIN)).toHaveLength(2);
  expect(memory).not.toContain(LEGACY_BLOCK_BEGIN);
  expect(memory).toContain("agent-config delegate");
});

test("uninstall after the move still restores everything the old install replaced", () => {
  const original = legacyInstall();
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
  expect(run("uninstall", "--yes").code).toBe(0);
  expect(read(p(".claude/CLAUDE.md"))).toBe(original.memory);
  expect(JSON.parse(read(p(".claude/settings.json")))).toEqual(JSON.parse(original.settings));
  expect(read(p(".claude/skills/model-ladder/SKILL.md"))).toBe(original.skill);
  expect(existsSync(p(".claude/hooks"))).toBe(false);
});

test("uninstall straight from the pre-rename layout strips the old block", () => {
  const original = legacyInstall();
  expect(run("uninstall", "--yes").code).toBe(0);
  expect(read(p(".claude/CLAUDE.md"))).toBe(original.memory);
  expect(JSON.parse(read(p(".claude/settings.json")))).toEqual(JSON.parse(original.settings));
});

test("merges the old records into a new state folder that already exists", () => {
  const original = legacyInstall();
  // A fresh agent-config state next to the old one.
  put(p(".local/state/agent-config/manifest.json"), `{ "version": 1, "records": [] }\n`);
  const res = run("status", "--json");
  expect(res.stderr).toContain("renamed from model-ladder");
  expect(existsSync(p(".local/state/model-ladder"))).toBe(false);
  expect(JSON.parse(res.stdout).entries.length).toBeGreaterThan(0);
  expect(run("uninstall", "--yes").code).toBe(0);
  expect(read(p(".claude/CLAUDE.md"))).toBe(original.memory);
  expect(read(p(".claude/skills/model-ladder/SKILL.md"))).toBe(original.skill);
});

test("a migration that cannot run warns and leaves commands working", () => {
  legacyInstall();
  const stateRoot = p(".local/state");
  chmodSync(stateRoot, 0o500);
  try {
    const res = run("status", "--json");
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("warning: could not move");
    expect(existsSync(p(".local/state/model-ladder/manifest.json"))).toBe(true);
  } finally {
    chmodSync(stateRoot, 0o755);
  }
});

test("an edited old item is left in place once and not offered again", () => {
  legacyInstall();
  put(p(".claude/hooks/model-ladder/read-guard.mjs"), "// my tweaks\n");
  const first = JSON.parse(run("install", "--runtime", "claude", "--yes", "--json").stdout);
  expect(first.notes.join("\n")).toContain("left as you changed it and is no longer managed");
  expect(read(p(".claude/hooks/model-ladder/read-guard.mjs"))).toBe("// my tweaks\n");
  const again = JSON.parse(run("install", "--runtime", "claude", "--dry-run", "--json").stdout);
  expect(
    again.plan.filter((x: { action: string }) => x.action !== "unchanged" && x.action !== "skip"),
  ).toEqual([]);
});
