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

test("i is the same command as install, including install <item>", () => {
  const plan = run("i", "--runtime", "codex", "--dry-run", "--json");
  expect(plan.code).toBe(0);
  expect(plan.stdout).toBe(run("install", "--runtime", "codex", "--dry-run", "--json").stdout);
  const item = run("i", "kaneo", "--runtime", "claude", "--url", "https://k.example.com", "--yes");
  expect(item.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
});

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
  expect(JSON.parse(read(join(home, ".config/agent-config/config.json"))).catalog).toEqual([
    { item: "model-ladder", runtimes: ["claude"], settings: {} },
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
  const after = JSON.parse(run("catalog", "--json").stdout).items;
  expect(after.find((i: { id: string }) => i.id === "kaneo").entries).toEqual([]);
});

test("install model-ladder installs only the ladder; uninstall model-ladder keeps kaneo", () => {
  const kaneo = ["install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com"];
  expect(run(...kaneo, "--yes").code).toBe(0);
  const installed = run(
    "install",
    "model-ladder",
    "--runtime",
    "claude",
    "--model",
    "claude:deep=claude-opus-5-5",
    "--yes",
    "--json",
  );
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string }[];
  expect(plan.length).toBeGreaterThan(0);
  expect(plan.every((x) => x.item === "model-ladder@user")).toBe(true);
  expect(read(join(home, ".claude/agents/ladder-read-deep.md"))).toContain(
    "model: claude-opus-5-5",
  );

  const listed = JSON.parse(run("catalog", "--json").stdout);
  expect(listed.items.map((i: { id: string }) => i.id)).toEqual(["model-ladder", "kaneo"]);
  expect(listed.items[0].entries).toMatchObject([{ scope: "user", runtimes: ["claude"] }]);
  expect(run("catalog").stdout).toContain("install: agent-config install model-ladder\n");

  // A bare install re-applies both saved items and changes nothing.
  const again = run("install", "--yes", "--json");
  expect(again.code).toBe(0);
  expect(JSON.parse(again.stdout).applied).toBe(false);

  expect(run("uninstall", "model-ladder", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-deep.md"))).toBe(false);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  const saved = JSON.parse(read(join(home, ".config/agent-config/config.json"))).catalog;
  expect(saved.map((e: { item: string }) => e.item)).toEqual(["kaneo"]);
});

test("a bare install with nothing saved asks for a catalog item instead of installing the ladder", () => {
  const res = run("install", "--yes");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("agent-config install model-ladder");
  expect(existsSync(join(home, ".claude"))).toBe(false);
});

test("install model-ladder refuses --project", () => {
  const res = run("install", "model-ladder", "--project", home, "--runtime", "claude");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("user scope only");
});

test("a 0.4.0 ladder install migrates to the model-ladder entry without reinstalling", () => {
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
  // Rewrite the state as 0.4.0 left it: runtimes saved on their own, records without an item.
  const cfg = join(home, ".config/agent-config/config.json");
  const manifest = join(home, ".local/state/agent-config/manifest.json");
  const config = JSON.parse(read(cfg));
  writeFileSync(cfg, JSON.stringify({ ...config, runtimes: ["claude"], catalog: [] }));
  const state = JSON.parse(read(manifest));
  for (const r of state.records) delete r.item;
  writeFileSync(manifest, JSON.stringify(state));

  const plan = JSON.parse(run("install", "--dry-run", "--json").stdout).plan;
  expect(plan.length).toBeGreaterThan(0);
  // Review models skip without Gentle AI agents; everything installed stays as it is.
  expect(plan.filter((x: { action: string }) => !["unchanged", "skip"].includes(x.action))).toEqual(
    [],
  );
  const listed = JSON.parse(run("catalog", "--json").stdout).items[0];
  expect(listed.entries).toMatchObject([{ runtimes: ["claude"], files: state.records.length }]);

  expect(run("uninstall", "model-ladder", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-fast.md"))).toBe(false);
  expect(JSON.parse(run("status", "--json").stdout).entries).toEqual([]);
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
    expect(res.stderr).toContain("from your user config");
    expect(res.stderr).toContain(repo);
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
  expect(ladderFlag.stderr).toContain("configures the model ladder");
  expect(ladderFlag.code).toBe(2);
  expect(
    run("install", "kaneo", "--project", join(home, "missing"), "--url", "https://k.example.com")
      .code,
  ).toBe(2);
});

test("uninstall <item> --dry-run keeps the saved entry; apply <item> installs the item", () => {
  const cfg = join(home, ".config/agent-config/config.json");
  const applied = run(
    "apply",
    "kaneo",
    "--runtime",
    "claude",
    "--url",
    "https://k.example.com",
    "--yes",
  );
  expect(applied.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  rmSync(join(home, ".local/state/agent-config/manifest.json"));
  expect(run("uninstall", "kaneo", "--dry-run").code).toBe(0);
  expect(JSON.parse(read(cfg)).catalog).toHaveLength(1);
});

test("a partial runtime uninstall at project scope keeps the shared AGENTS.md block", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const url = ["--url", "https://k.example.com"];
    const rt = ["--runtime", "opencode", "--runtime", "codex"];
    expect(run("install", "kaneo", "--project", repo, ...rt, ...url, "--yes").code).toBe(0);
    // A file the user removed by hand is not brought back by the partial uninstall.
    rmSync(join(repo, ".codex/agents/kaneo-scribe.toml"));
    const res = run("uninstall", "kaneo", "--project", repo, "--runtime", "opencode", "--yes");
    expect(res.code).toBe(0);
    expect(read(join(repo, "AGENTS.md"))).toContain("<!-- BEGIN agent-config:kaneo");
    expect(existsSync(join(repo, ".opencode/skills/kaneo-work-tracking/SKILL.md"))).toBe(false);
    expect(existsSync(join(repo, ".agents/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".codex/agents/kaneo-scribe.toml"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install kaneo warns about a plain http URL", () => {
  const res = run(
    "install",
    "kaneo",
    "--runtime",
    "claude",
    "--url",
    "http://k.example.com",
    "--yes",
  );
  expect(res.code).toBe(0);
  expect(res.stderr).toContain("not https");
});

test("a project whose directory is gone is skipped by install and forgotten by uninstall", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const args = ["--project", repo, "--runtime", "claude", "--url", "https://k.example.com"];
    expect(run("install", "kaneo", ...args, "--yes").code).toBe(0);
    rmSync(repo, { recursive: true, force: true });

    const whole = run("install", "--runtime", "claude", "--yes");
    expect(whole.code).toBe(0);
    expect(whole.stderr).toContain("is gone");
    expect(existsSync(repo)).toBe(false);

    expect(run("uninstall", "kaneo", "--project", repo, "--yes").code).toBe(0);
    const listed = JSON.parse(run("catalog", "--json").stdout);
    expect(listed.items.find((i: { id: string }) => i.id === "kaneo").entries).toEqual([]);
    expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
    expect(existsSync(repo)).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a partial uninstall puts the shared block back into a pre-existing AGENTS.md", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    writeFileSync(join(repo, "AGENTS.md"), "# Our agents\n");
    const rt = ["--runtime", "opencode", "--runtime", "codex"];
    const url = ["--url", "https://k.example.com"];
    expect(run("install", "kaneo", "--project", repo, ...rt, ...url, "--yes").code).toBe(0);
    for (const runtime of ["opencode", "codex"]) {
      const left = run("uninstall", "kaneo", "--project", repo, "--runtime", runtime, "--yes");
      expect(left.code).toBe(0);
      if (runtime === "opencode") {
        const text = read(join(repo, "AGENTS.md"));
        expect(text).toContain("# Our agents");
        expect(text).toContain("<!-- BEGIN agent-config:kaneo");
      }
    }
    expect(read(join(repo, "AGENTS.md"))).toBe("# Our agents\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
