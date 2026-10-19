import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  expect(JSON.parse(read(join(home, ".config/agent-config/config.json"))).runtimes).toEqual([
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

test("uninstall exits 3 when it keeps a file you edited", () => {
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
  const agent = join(home, ".claude/agents/ladder-read-fast.md");
  writeFileSync(agent, "edited\n");
  const res = run("uninstall", "--yes");
  expect(res.code).toBe(3);
  expect(read(agent)).toBe("edited\n");
  expect(run("uninstall", "--yes", "--force").code).toBe(0);
  expect(existsSync(agent)).toBe(false);
});

test("install kaneo adds only the catalog item; catalog lists it; uninstall kaneo removes it", () => {
  const args = ["install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com/"];
  const dry = run(...args, "--dry-run");
  expect(dry.code).toBe(0);
  expect(dry.stdout).toContain("kaneo skill kaneo-work-tracking");
  expect(existsSync(join(home, ".claude"))).toBe(false);

  const installed = run(...args, "--yes", "--json");
  expect(installed.code).toBe(0);
  expect(JSON.parse(installed.stdout).applied).toBe(true);
  expect(read(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toContain("kaneo-scribe");
  expect(JSON.parse(read(join(home, ".claude.json"))).mcpServers.kaneo.url).toBe(
    "https://k.example.com/api/mcp",
  );
  // The ladder was not installed along with it.
  expect(existsSync(join(home, ".claude/agents/ladder-read-fast.md"))).toBe(false);

  const listed = JSON.parse(run("catalog", "--json").stdout);
  const kaneo = listed.items.find((i: { id: string }) => i.id === "kaneo");
  expect(kaneo.entries).toMatchObject([
    { scope: "user", runtimes: ["claude"], settings: { url: "https://k.example.com" } },
  ]);

  // Re-running reuses the saved URL and changes nothing.
  const again = run("install", "kaneo", "--yes", "--json");
  expect(again.code).toBe(0);
  expect(JSON.parse(again.stdout).applied).toBe(false);

  const removed = run("uninstall", "kaneo", "--yes", "--json");
  expect(removed.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(false);
  expect(existsSync(join(home, ".claude.json"))).toBe(false);
  expect(JSON.parse(run("catalog", "--json").stdout).items[0].entries).toEqual([]);
});

test("install kaneo --project writes into the repository and reuses the user's Kaneo URL", () => {
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { kaneo: { type: "http", url: "https://k.example.com/api/mcp" } },
    }),
  );
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const res = run("install", "kaneo", "--project", repo, "--runtime", "claude", "--yes");
    expect(res.code).toBe(0);
    expect(JSON.parse(read(join(repo, ".mcp.json"))).mcpServers.kaneo.url).toBe(
      "https://k.example.com/api/mcp",
    );
    expect(existsSync(join(repo, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude/skills"))).toBe(false);
    expect(run("uninstall", "kaneo", "--project", repo, "--yes").code).toBe(0);
    expect(existsSync(join(repo, ".mcp.json"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("catalog usage errors exit 2", () => {
  const noUrl = run("install", "kaneo", "--runtime", "claude", "--yes");
  expect(noUrl.code).toBe(2);
  expect(noUrl.stderr).toContain("kaneo needs --url");
  expect(run("install", "nope", "--runtime", "claude").code).toBe(2);
  expect(run("install", "--url", "https://k.example.com", "--runtime", "claude").code).toBe(2);
  expect(run("uninstall", "kaneo", "--url", "https://k.example.com").code).toBe(2);
  const badUrl = run("install", "kaneo", "--runtime", "claude", "--url", "ftp://x");
  expect(badUrl.code).toBe(2);
  const ladderFlag = run("install", "kaneo", "--url", "https://k.example.com", "--min-lines", "9");
  expect(ladderFlag.stderr).toContain("configures the ladder");
  expect(ladderFlag.code).toBe(2);
  expect(
    run("install", "kaneo", "--project", join(home, "missing"), "--url", "https://k.example.com")
      .code,
  ).toBe(2);
});
