import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { read } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "model-ladder-cli-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const res = spawnSync("node", [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("install, status and uninstall round-trip with --json", () => {
  const installed = run(
    "install",
    "--runtime",
    "claude",
    "--model",
    "claude:deep=claude-opus-5-5",
    "--yes",
    "--json",
  );
  expect(installed.code).toBe(0);
  expect(JSON.parse(installed.stdout).applied).toBe(true);
  expect(read(join(home, ".claude/agents/ladder-read-deep.md"))).toContain(
    "model: claude-opus-5-5",
  );
  expect(JSON.parse(read(join(home, ".config/model-ladder/config.json"))).runtimes).toEqual([
    "claude",
  ]);

  const status = JSON.parse(run("status", "--json").stdout);
  expect(status.entries.length).toBeGreaterThan(0);
  expect(status.entries.every((e: { state: string }) => e.state === "ok")).toBe(true);

  const removed = run("uninstall", "--yes", "--json");
  expect(removed.code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-deep.md"))).toBe(false);
  expect(JSON.parse(run("status", "--json").stdout).entries).toEqual([]);
});

test("--dry-run writes nothing", () => {
  const res = run("install", "--runtime", "codex", "--dry-run");
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("ladder-read-fast");
  expect(existsSync(join(home, ".codex"))).toBe(false);
});

test("refuses to apply without --yes outside a terminal", () => {
  const res = run("install", "--runtime", "claude");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("--yes");
  expect(existsSync(join(home, ".claude"))).toBe(false);
});

test("usage errors exit 2", () => {
  expect(run("install", "--runtime", "vim").code).toBe(2);
  expect(run("install", "--model", "claude:huge=x").code).toBe(2);
  expect(run("frobnicate").code).toBe(2);
  expect(run().code).toBe(2);
});
