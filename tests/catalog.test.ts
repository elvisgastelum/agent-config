import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { entryKey, upsertEntry, type CatalogEntry } from "../src/catalog.ts";
import { buildPlan, status } from "../src/commands.ts";
import { defaultConfig, loadConfig, type Config } from "../src/config.ts";
import { kaneoBaseUrl } from "../src/kaneo.ts";
import { applyPlan, uninstall } from "../src/ops.ts";
import { configPath } from "../src/paths.ts";
import type { Runtime } from "../src/tiers.ts";
import { put, read, sandbox } from "./helpers.ts";

const URL = "https://kaneo.example.com";
const MCP = "https://kaneo.example.com/api/mcp";

let box: ReturnType<typeof sandbox>;
let project: string | undefined;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => {
  box.restore();
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

function kaneoEntry(runtimes: Runtime[], dir?: string): CatalogEntry {
  return {
    item: "kaneo",
    ...(dir ? { project: dir } : {}),
    runtimes,
    settings: { url: URL },
  };
}

function withEntry(entry: CatalogEntry): Config {
  const config = defaultConfig();
  upsertEntry(config, entry);
  return config;
}

function install(config: Config, entry: CatalogEntry) {
  const result = applyPlan(buildPlan(config, [entryKey(entry)]));
  expect(result.errors).toEqual([]);
  return result;
}

describe("kaneo catalog item", () => {
  test("installs skill, scribe, block and MCP server for claude at user scope, and uninstalls them", () => {
    const entry = kaneoEntry(["claude"]);
    install(withEntry(entry), entry);
    const h = box.home;

    const skill = read(join(h, ".claude/skills/kaneo-work-tracking/SKILL.md"));
    expect(skill).toContain("kaneo-scribe");
    expect(skill).toContain("ladder-read-fast");
    const scribe = read(join(h, ".claude/agents/kaneo-scribe.md"));
    expect(scribe).toContain("model: claude-haiku-5-5");
    expect(scribe).toContain("mcp__kaneo__create_task");
    expect(read(join(h, ".claude/CLAUDE.md"))).toContain("<!-- BEGIN agent-config:kaneo");
    expect(JSON.parse(read(join(h, ".claude.json"))).mcpServers.kaneo).toEqual({
      type: "http",
      url: MCP,
    });
    expect(status().every((s) => s.record.item === "kaneo@user")).toBe(true);
    expect(status().length).toBe(4);

    uninstall((r) => r.item === "kaneo@user");
    expect(existsSync(join(h, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(false);
    expect(existsSync(join(h, ".claude/agents/kaneo-scribe.md"))).toBe(false);
    const memory = join(h, ".claude/CLAUDE.md");
    if (existsSync(memory)) expect(read(memory)).not.toContain("agent-config:kaneo");
    const json = join(h, ".claude.json");
    if (existsSync(json)) expect(JSON.parse(read(json)).mcpServers?.kaneo).toBeUndefined();
    expect(status()).toEqual([]);
  });

  test("keeps the ladder block and the user's text when only kaneo is uninstalled", () => {
    const memory = join(box.home, ".claude/CLAUDE.md");
    put(memory, "# Mine\n");
    const ladder = {
      ...defaultConfig(),
      runtimes: ["claude" as Runtime],
      components: ["instructions" as const],
    };
    expect(applyPlan(buildPlan(ladder)).errors).toEqual([]);
    const entry = kaneoEntry(["claude"]);
    install(withEntry(entry), entry);
    const both = read(memory);
    expect(both).toContain("<!-- BEGIN agent-config: managed");
    expect(both).toContain("<!-- BEGIN agent-config:kaneo");

    uninstall((r) => r.item === "kaneo@user");
    const after = read(memory);
    expect(after).toContain("<!-- BEGIN agent-config: managed");
    expect(after).not.toContain("agent-config:kaneo");
    expect(after).toContain("# Mine");
  });

  test("replaces the legacy standalone block in place", () => {
    const memory = join(box.home, ".claude/CLAUDE.md");
    put(
      memory,
      "# Mine\n\n<!-- BEGIN kaneo-work-tracking-skill: managed by install.sh, edits inside this block are overwritten -->\nold\n<!-- END kaneo-work-tracking-skill -->\n",
    );
    const entry = kaneoEntry(["claude"]);
    install(withEntry(entry), entry);
    const text = read(memory);
    expect(text).not.toContain("kaneo-work-tracking-skill");
    expect(text).not.toContain("old\n");
    expect(text).toContain("<!-- BEGIN agent-config:kaneo");
    expect(text).toContain("<!-- END agent-config:kaneo -->");
    expect(text).toContain("# Mine");
  });

  test("keeps other MCP servers and keys in ~/.claude.json and removes only kaneo", () => {
    const json = join(box.home, ".claude.json");
    put(json, '{"mcpServers":{"other":{"type":"stdio"}},"x":1}');
    const entry = kaneoEntry(["claude"]);
    install(withEntry(entry), entry);
    const installed = JSON.parse(read(json));
    expect(installed.x).toBe(1);
    expect(installed.mcpServers.other).toEqual({ type: "stdio" });
    expect(installed.mcpServers.kaneo).toEqual({ type: "http", url: MCP });

    uninstall((r) => r.item === "kaneo@user");
    const after = JSON.parse(read(json));
    expect(after.x).toBe(1);
    expect(after.mcpServers.other).toEqual({ type: "stdio" });
    expect(after.mcpServers.kaneo).toBeUndefined();
  });

  test("writes a codex TOML block and skips when the table already exists outside it", () => {
    const entry = kaneoEntry(["codex"]);
    const config = withEntry(entry);
    install(config, entry);
    const toml = join(box.home, ".codex/config.toml");
    const text = read(toml);
    expect(text).toContain("# BEGIN agent-config:kaneo");
    expect(text).toContain("[mcp_servers.kaneo]");
    expect(text).toContain(`url = "${MCP}"`);

    uninstall((r) => r.item === "kaneo@user");
    const mine = '[mcp_servers.kaneo]\nurl = "https://mine.example.com/api/mcp"\n';
    put(toml, mine);
    const plan = buildPlan(config, [entryKey(entry)]);
    const op = plan.find((p) => p.op.kind === "block" && p.op.path === toml);
    expect(op?.action).toBe("skip");
    applyPlan(plan);
    expect(read(toml)).toBe(mine);
  });

  test("installs at project scope for all four runtimes and uninstalls cleanly", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    const p = project;
    const entry = kaneoEntry(["claude", "opencode", "codex", "pi"], p);
    install(withEntry(entry), entry);

    const files = [
      ".claude/skills/kaneo-work-tracking/SKILL.md",
      ".opencode/skills/kaneo-work-tracking/SKILL.md",
      ".agents/skills/kaneo-work-tracking/SKILL.md",
      ".pi/skills/kaneo-work-tracking/SKILL.md",
      ".claude/agents/kaneo-scribe.md",
      ".opencode/agents/kaneo-scribe.md",
      ".codex/agents/kaneo-scribe.toml",
      ".pi/agents/kaneo-scribe.md",
      ".mcp.json",
      "opencode.json",
      ".codex/config.toml",
      "CLAUDE.md",
      "AGENTS.md",
    ];
    for (const f of files) expect(existsSync(join(p, f)), f).toBe(true);
    expect(existsSync(join(p, ".pi/mcp.json"))).toBe(false);
    expect(JSON.parse(read(join(p, ".mcp.json"))).mcpServers.kaneo).toEqual({
      type: "http",
      url: MCP,
    });
    expect(JSON.parse(read(join(p, "opencode.json"))).mcp.kaneo).toEqual({
      enabled: true,
      type: "remote",
      url: MCP,
    });
    expect(read(join(p, ".codex/config.toml"))).toContain("[mcp_servers.kaneo]");
    expect(read(join(p, "AGENTS.md")).split("<!-- BEGIN agent-config:kaneo").length - 1).toBe(1);

    for (const dir of [".claude", ".config/opencode", ".codex", ".pi", ".agents"]) {
      expect(existsSync(join(box.home, dir)), dir).toBe(false);
    }
    expect(existsSync(join(box.home, ".claude.json"))).toBe(false);

    uninstall((r) => r.item === `kaneo@${p}`);
    for (const f of files) expect(existsSync(join(p, f)), f).toBe(false);
    expect(status()).toEqual([]);
  });

  test("plans removal of a runtime dropped from the entry", () => {
    const entry = kaneoEntry(["claude", "opencode"]);
    const config = withEntry(entry);
    install(config, entry);
    const skill = join(box.home, ".config/opencode/skills/kaneo-work-tracking/SKILL.md");
    expect(existsSync(skill)).toBe(true);

    upsertEntry(config, kaneoEntry(["claude"]));
    const plan = buildPlan(config, ["kaneo@user"]);
    const removed = plan.filter((p) => p.action === "remove");
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((p) => p.op.runtime === "opencode")).toBe(true);
    expect(
      plan.filter((p) => p.op.runtime === "opencode").every((p) => p.action === "remove"),
    ).toBe(true);
    expect(applyPlan(plan).errors).toEqual([]);
    expect(existsSync(skill)).toBe(false);
    expect(existsSync(join(box.home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  });
});

test("a whole-config plan re-applies saved catalog entries and leaves deselected ladder parts alone", () => {
  const entry = kaneoEntry(["claude"]);
  const config = withEntry(entry);
  config.runtimes = ["claude"];
  config.components = ["skill", "instructions"];
  expect(applyPlan(buildPlan(config)).errors).toEqual([]);
  expect(existsSync(join(box.home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  expect(buildPlan(config).every((p) => p.action === "unchanged")).toBe(true);

  config.components = ["instructions"];
  const plan = buildPlan(config);
  expect(plan.filter((p) => p.action !== "unchanged")).toEqual([]);
  expect(plan.some((p) => p.op.label === "skill model-ladder")).toBe(false);
  expect(plan.filter((p) => p.op.item === "kaneo@user")).toHaveLength(4);
});

describe("kaneoBaseUrl", () => {
  test("strips the MCP path and rejects non-http input", () => {
    expect(kaneoBaseUrl("https://k.example.com/api/mcp/")).toBe("https://k.example.com");
    expect(kaneoBaseUrl("ftp://x")).toBeUndefined();
    expect(kaneoBaseUrl("not a url")).toBeUndefined();
  });
});

describe("loadConfig catalog", () => {
  test("drops entries with an unknown item or a relative project path", () => {
    put(
      configPath(),
      JSON.stringify({
        catalog: [
          { item: "nope", runtimes: ["claude"], settings: {} },
          { item: "kaneo", project: "relative/dir", runtimes: ["claude"], settings: {} },
          { item: "kaneo", runtimes: ["claude"], settings: { url: URL } },
        ],
      }),
    );
    const catalog = loadConfig().catalog;
    expect(catalog).toEqual([{ item: "kaneo", runtimes: ["claude"], settings: { url: URL } }]);
  });
});
