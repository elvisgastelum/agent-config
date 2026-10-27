import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  catalogItem,
  entryDefaults,
  entryKey,
  missingProjectWarnings,
  upsertEntry,
  type CatalogEntry,
} from "../src/catalog.ts";
import { buildPlan, doctor, restoreShared, status, uninstallSelection } from "../src/commands.ts";
import { defaultConfig, loadConfig, saveConfig, type Config } from "../src/config.ts";
import {
  EPIC_LABEL,
  EPIC_LINE,
  EPIC_TITLE_PREFIX,
  kaneoBaseUrl,
  kaneoSkillMarkdown,
  kaneoUrlWarning,
  SCRIBE_BODY,
  TOUCHES_LINE,
  WAVE_RULE,
} from "../src/kaneo.ts";
import {
  applyPlan,
  loadManifest,
  saveManifest,
  sha256,
  uninstall,
  withBlock,
  type ManifestRecord,
} from "../src/ops.ts";
import { configPath } from "../src/paths.ts";
import type { Runtime } from "../src/tiers.ts";
import { isNewer, VERSION } from "../src/version.ts";
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
    // Catalog agents know the ladder too, so they can name the agent for work outside their role.
    expect(scribe).toContain("## Team");
    expect(scribe).toContain("`ladder-designer-<rung>`");
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
    const ladder: Config = {
      ...defaultConfig(),
      components: ["instructions"],
      catalog: [{ item: "model-ladder", runtimes: ["claude"], settings: {} }],
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
      ".pi/mcp.json",
      ".mcp.json",
      "opencode.json",
      ".codex/config.toml",
      "CLAUDE.md",
      "AGENTS.md",
    ];
    for (const f of files) expect(existsSync(join(p, f)), f).toBe(true);
    expect(JSON.parse(read(join(p, ".pi/mcp.json"))).mcpServers.kaneo).toEqual({ url: MCP });
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
    const agents = read(join(p, "AGENTS.md"));
    expect(agents.split("<!-- BEGIN agent-config:kaneo").length - 1).toBe(1);
    for (const label of ["OpenCode:", "Codex:", "Pi:"]) expect(agents).toContain(label);
    expect(read(join(p, "CLAUDE.md"))).not.toContain("OpenCode:");

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
  test("gives the Pi scribe a tool allowlist without bash", () => {
    const entry = kaneoEntry(["pi"]);
    install(withEntry(entry), entry);
    const scribe = read(join(box.home, ".pi/agent/agents/kaneo-scribe.md"));
    expect(scribe).toContain("tools:");
    expect(scribe).toContain("  - tool_search");
    expect(scribe).not.toContain("  - bash");
  });

  test("a partial uninstall at project scope restores the shared AGENTS.md block for the rest", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    const p = project;
    const entry = kaneoEntry(["opencode", "codex"], p);
    install(withEntry(entry), entry);
    saveConfig(withEntry(entry));

    const out = uninstallSelection({ key: `kaneo@${p}`, runtimes: ["opencode"] });
    expect(out.restoreErrors).toEqual([]);
    const agents = read(join(p, "AGENTS.md"));
    expect(agents).toContain("<!-- BEGIN agent-config:kaneo");
    expect(agents).toContain("a spawned sub-agent with `kaneo-scribe` as its role");
    expect(agents).not.toContain("OpenCode:");
    expect(loadConfig().catalog[0]?.runtimes).toEqual(["codex"]);
  });

  test("skips a project whose directory is gone: no create, no remove, one warning", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    const p = project;
    const entry = kaneoEntry(["claude"], p);
    const config = withEntry(entry);
    install(config, entry);
    rmSync(p, { recursive: true, force: true });

    expect(buildPlan(config).filter((x) => x.op.path.startsWith(p))).toEqual([]);
    const warnings = missingProjectWarnings(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("is gone");
  });

  test("keeps a modified file and its saved entry, and removes both with force", () => {
    const entry = kaneoEntry(["claude"]);
    const config = withEntry(entry);
    install(config, entry);
    saveConfig(config);
    const skill = join(box.home, ".claude/skills/kaneo-work-tracking/SKILL.md");
    writeFileSync(skill, "edited\n");

    const first = uninstallSelection({ key: "kaneo@user", runtimes: [] });
    expect(first.results.some((r) => r.outcome === "kept-modified")).toBe(true);
    expect(read(skill)).toBe("edited\n");
    expect(loadConfig().catalog.map(entryKey)).toContain("kaneo@user");

    uninstallSelection({ key: "kaneo@user", runtimes: [] }, true);
    expect(existsSync(skill)).toBe(false);
    expect(loadConfig().catalog.map(entryKey)).not.toContain("kaneo@user");
  });

  test("restoreShared reports an error when the file to recreate is a directory", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    const p = project;
    const entry = kaneoEntry(["opencode", "codex"], p);
    const config = withEntry(entry);
    install(config, entry);
    const agents = join(p, "AGENTS.md");
    const owner = status().find((s) => s.record.path === agents)?.record.runtime;
    expect(owner).toBeDefined();
    uninstall((r) => r.item === `kaneo@${p}` && r.runtime === owner);
    rmSync(agents, { force: true });
    mkdirSync(agents);
    const remaining = (["opencode", "codex"] as Runtime[]).filter((r) => r !== owner);
    upsertEntry(config, kaneoEntry(remaining, p));

    expect(restoreShared(config, [agents])).toHaveLength(1);
  });
});

test("a whole-config plan re-applies saved catalog entries and leaves deselected ladder parts alone", () => {
  const entry = kaneoEntry(["claude"]);
  const config = withEntry(entry);
  upsertEntry(config, { item: "model-ladder", runtimes: ["claude"], settings: {} });
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

  test("keeps a sub-path and drops dashboard, API, query and fragment", () => {
    expect(kaneoBaseUrl("https://k.example.com/dashboard/workspace/abc/project/def?x=1#y")).toBe(
      "https://k.example.com",
    );
    expect(kaneoBaseUrl("https://h.example.com/kaneo/dashboard")).toBe(
      "https://h.example.com/kaneo",
    );
    expect(kaneoBaseUrl("https://k.example.com/api/mcp")).toBe("https://k.example.com");
  });
});

describe("kaneoUrlWarning", () => {
  test("warns about plain http except on loopback", () => {
    expect(kaneoUrlWarning("http://k.example.com")).toContain("not https");
    expect(kaneoUrlWarning("http://localhost:1337")).toBeUndefined();
    expect(kaneoUrlWarning("https://k.example.com")).toBeUndefined();
  });
});

describe("entryDefaults", () => {
  test("discovers the URL from the user's Claude config, and prefers a saved entry", () => {
    const item = catalogItem("kaneo")!;
    put(
      join(box.home, ".claude.json"),
      JSON.stringify({
        mcpServers: { kaneo: { type: "http", url: "https://d.example.com/api/mcp" } },
      }),
    );
    const config = defaultConfig();
    const found = entryDefaults(item, undefined, config, () => ["claude"]);
    expect(found.runtimes).toEqual(["claude"]);
    expect(found.settings.url).toEqual({ value: "https://d.example.com", source: "discovered" });

    upsertEntry(config, {
      item: "kaneo",
      runtimes: ["codex"],
      settings: { url: "https://s.example.com" },
    });
    const saved = entryDefaults(item, undefined, config, () => ["claude"]);
    expect(saved.runtimes).toEqual(["codex"]);
    expect(saved.settings.url).toEqual({ value: "https://s.example.com", source: "saved" });
  });
});

describe("kaneoSkillMarkdown", () => {
  test("lists the PR title rule right after linking every other ticket", () => {
    const text = kaneoSkillMarkdown("claude", "m");
    const section = text.split("## Pull requests for ticket work")[1]!;
    const lines = section.split("\n");
    const link = lines.findIndex((l) => l.startsWith("- Link every other ticket"));
    expect(link).toBeGreaterThan(-1);
    expect(lines[link + 1]).toMatch(/^- Keep the PR title/);
  });

  test("creates each label on its task instead of looking it up in the workspace", () => {
    const text = kaneoSkillMarkdown("claude", "m");
    expect(text).not.toContain("List workspace labels");
    expect(text).toContain("create each label on the task with `create_label`");
    expect(text).toContain("a failed `create_label` is never retried");
  });

  test("marks an epic by title and label, and ties every story to it", () => {
    const text = kaneoSkillMarkdown("claude", "m");
    const section = text.split("## Plan an epic")[1]!.split("\n## ")[0]!;
    expect(section).toContain(`titled \`${EPIC_TITLE_PREFIX}<outcome>\``);
    expect(section).toContain(`\`${EPIC_LABEL}\``);
    expect(section).toContain(`\`${EPIC_LINE} <EPIC-ID>\``);
    expect(section).toContain(`\`${TOUCHES_LINE} <`);
    expect(section).toContain(WAVE_RULE);
  });
});

describe("SCRIBE_BODY", () => {
  test("labels each task without listing workspace labels", () => {
    expect(SCRIBE_BODY).not.toContain("and list workspace labels");
    expect(SCRIBE_BODY).toContain("Never call `list_workspace_labels`");
  });

  test("never retries a create and marks each failed call", () => {
    expect(SCRIBE_BODY).toContain("Never retry a create (task, label, relation, comment)");
    expect(SCRIBE_BODY).toContain(
      "- <unknown | skipped | error> | <call and its target> | <error>",
    );
  });

  test("keeps the summary reply apart from the write reply shape", () => {
    expect(SCRIBE_BODY).toContain("instead of the shape below");
    expect(SCRIBE_BODY).toContain("For a write request, reply in exactly this shape:");
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

  test("reads a saved kick-off entry as brief", () => {
    put(
      configPath(),
      JSON.stringify({ catalog: [{ item: "kick-off", runtimes: ["claude"], settings: {} }] }),
    );
    expect(loadConfig().catalog).toEqual([{ item: "brief", runtimes: ["claude"], settings: {} }]);
  });
});

describe("kick-off renamed to brief", () => {
  test("a full re-apply removes the kick-off skill and installs brief", () => {
    const oldDir = join(box.home, ".claude/skills/kick-off");
    const oldSkill = join(oldDir, "SKILL.md");
    const oldContent = "---\nname: kick-off\n---\n";
    put(oldSkill, oldContent);
    addRecords([
      {
        kind: "file",
        runtime: "claude",
        component: "catalog",
        path: oldSkill,
        label: "kick-off skill",
        item: "kick-off@user",
        createdDirs: [oldDir],
        createdFile: true,
        sha: sha256(oldContent),
        version: "0.15.0",
      },
    ]);
    put(
      configPath(),
      JSON.stringify({ catalog: [{ item: "kick-off", runtimes: ["claude"], settings: {} }] }),
    );

    expect(applyPlan(buildPlan(loadConfig())).errors).toEqual([]);
    expect(existsSync(oldDir)).toBe(false);
    expect(read(join(box.home, ".claude/skills/brief/SKILL.md"))).toContain("name: brief");
    expect(loadManifest().records.some((r) => r.item === "kick-off@user")).toBe(false);
  });
});

// What `agi install plans-mcp` wrote in 0.12.0-0.14.0, a catalog item this version does not have.
const RETIRED_ITEM = "plans-mcp@user";
const RETIRED_SERVER = { type: "stdio", command: "agent-config", args: ["plans", "mcp"] };
const RETIRED_MARKERS: [string, string][] = [
  [
    "# BEGIN agent-config:plans-mcp: managed by agent-config, edits inside this block are overwritten",
    "# END agent-config:plans-mcp",
  ],
];
const CODEX_BEFORE = 'model = "gpt-5"\n';

function addRecords(records: ManifestRecord[]): void {
  saveManifest({ version: 1, records: [...loadManifest().records, ...records] });
}

/** Writes the 0.14.0 plans-mcp registrations for Claude and Codex and records them as it did. */
function installRetired(): { claudeJson: string; codexToml: string } {
  const claudeJson = join(box.home, ".claude.json");
  const config = JSON.parse(read(claudeJson));
  config.mcpServers.plans = RETIRED_SERVER;
  put(claudeJson, JSON.stringify(config, null, 2));
  const codexToml = join(box.home, ".codex/config.toml");
  put(
    codexToml,
    withBlock(
      CODEX_BEFORE,
      '[mcp_servers.plans]\ncommand = "agent-config"\nargs = ["plans", "mcp"]',
      RETIRED_MARKERS,
    ),
  );
  const base = {
    component: "catalog" as const,
    label: "plans MCP server agent-config plans mcp",
    item: RETIRED_ITEM,
    createdDirs: [] as string[],
  };
  addRecords([
    {
      ...base,
      kind: "json-set",
      runtime: "claude",
      path: claudeJson,
      pointer: ["mcpServers", "plans"],
      value: RETIRED_SERVER,
      prev: { present: false },
      existingDepth: 1,
    },
    {
      ...base,
      kind: "block",
      runtime: "codex",
      path: codexToml,
      trailingNewline: true,
      markers: RETIRED_MARKERS,
    },
  ]);
  return { claudeJson, codexToml };
}

describe("catalog items this version no longer has", () => {
  test("a full re-apply undoes them and keeps everything else", () => {
    const entry = kaneoEntry(["claude"]);
    const config = withEntry(entry);
    put(join(box.home, ".claude.json"), '{"mcpServers":{"other":{"type":"stdio"}},"x":1}');
    install(config, entry);
    const { claudeJson, codexToml } = installRetired();

    const plan = buildPlan(config);
    const retired = plan.filter((p) => p.record?.item === RETIRED_ITEM);
    expect(retired.map((p) => p.action)).toEqual(["remove", "remove"]);
    expect(applyPlan(plan).errors).toEqual([]);

    const after = JSON.parse(read(claudeJson));
    expect(after.mcpServers.plans).toBeUndefined();
    expect(after.mcpServers.other).toEqual({ type: "stdio" });
    expect(after.mcpServers.kaneo).toEqual({ type: "http", url: MCP });
    expect(after.x).toBe(1);
    expect(read(codexToml)).toBe(CODEX_BEFORE);
    expect(loadManifest().records.filter((r) => r.item === RETIRED_ITEM)).toEqual([]);
    expect(buildPlan(config).every((p) => p.action === "unchanged")).toBe(true);
  });

  test("installing one item leaves them alone", () => {
    const entry = kaneoEntry(["claude"]);
    const config = withEntry(entry);
    put(join(box.home, ".claude.json"), "{}");
    install(config, entry);
    const { claudeJson } = installRetired();

    const plan = buildPlan(config, [entryKey(entry)]);
    expect(plan.filter((p) => p.record?.item === RETIRED_ITEM)).toEqual([]);
    expect(applyPlan(plan).errors).toEqual([]);
    expect(JSON.parse(read(claudeJson)).mcpServers.plans).toEqual(RETIRED_SERVER);
  });

  test("leaves them alone in a project whose directory is gone", () => {
    const gone = join(box.home, "gone-repo");
    addRecords([
      {
        kind: "json-set",
        runtime: "claude",
        component: "catalog",
        path: join(gone, ".mcp.json"),
        label: "plans MCP server agent-config plans mcp",
        item: `plans-mcp@${gone}`,
        pointer: ["mcpServers", "plans"],
        value: RETIRED_SERVER,
        prev: { present: false },
        existingDepth: 0,
        createdFile: true,
      },
    ]);
    expect(buildPlan(defaultConfig()).filter((p) => p.op.path.startsWith(gone))).toEqual([]);
  });
});

describe("catalog items this version no longer has, by scope and version", () => {
  function retiredRecord(item: string, path: string, version?: string): ManifestRecord {
    return {
      kind: "json-set",
      runtime: "claude",
      component: "catalog",
      path,
      label: "plans MCP server agent-config plans mcp",
      item,
      pointer: ["mcpServers", "plans"],
      value: RETIRED_SERVER,
      prev: { present: false },
      existingDepth: 0,
      createdFile: true,
      ...(version ? { version } : {}),
    };
  }

  test("undoes them in a project whose directory still exists", () => {
    project = mkdtempSync(join(tmpdir(), "agent-config-project-"));
    const mcpJson = join(project, ".mcp.json");
    put(mcpJson, JSON.stringify({ mcpServers: { plans: RETIRED_SERVER } }));
    addRecords([retiredRecord(`plans-mcp@${project}`, mcpJson)]);

    const plan = buildPlan(defaultConfig());
    expect(plan.filter((p) => p.op.path === mcpJson).map((p) => p.action)).toEqual(["remove"]);
    expect(applyPlan(plan).errors).toEqual([]);
    expect(existsSync(mcpJson)).toBe(false);
    expect(loadManifest().records).toEqual([]);
  });

  test("keeps an item a newer agent-config installed, which this version does not know yet", () => {
    const claudeJson = join(box.home, ".claude.json");
    put(claudeJson, JSON.stringify({ mcpServers: { plans: RETIRED_SERVER } }));
    addRecords([retiredRecord("plans-mcp@user", claudeJson, "99.0.0")]);

    expect(buildPlan(defaultConfig()).filter((p) => p.op.path === claudeJson)).toEqual([]);
  });
});

describe("installed version", () => {
  const check = () => doctor().find((c) => c.name === "installed version");

  test("every installed record carries the version that wrote it", () => {
    const entry = kaneoEntry(["claude", "opencode"]);
    install(withEntry(entry), entry);
    const records = loadManifest().records;
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.version === VERSION)).toBe(true);
    expect(check()).toEqual({ name: "installed version", ok: true, detail: `all at ${VERSION}` });
  });

  test("doctor names files from another version, and a re-apply brings them to this one", () => {
    const entry = kaneoEntry(["claude"]);
    const config = withEntry(entry);
    install(config, entry);
    const [first, second, ...rest] = loadManifest().records;
    const { version: _, ...unrecorded } = first!;
    saveManifest({ version: 1, records: [unrecorded, { ...second!, version: "0.14.0" }, ...rest] });

    expect(check()).toEqual({
      name: "installed version",
      ok: false,
      detail: `2 installed by another version (0.14.0, unrecorded); run \`agent-config install\` to bring them to ${VERSION}`,
    });
    expect(applyPlan(buildPlan(config)).errors).toEqual([]);
    expect(check()?.ok).toBe(true);
  });

  test("a skipped op keeps the version of the agent-config that last wrote it", () => {
    const entry = kaneoEntry(["claude"]);
    const config = withEntry(entry);
    install(config, entry);
    const records = loadManifest().records.map((r) => ({ ...r, version: "0.14.0" }));
    saveManifest({ version: 1, records });
    const planned = buildPlan(config).find((p) => p.op.path === records[0]!.path)!;

    expect(applyPlan([{ ...planned, action: "skip", reason: "test" }]).errors).toEqual([]);
    expect(loadManifest().records.find((r) => r.path === planned.op.path)?.version).toBe("0.14.0");
  });
});

test("isNewer compares release numbers, not text", () => {
  expect(isNewer("0.15.0", "0.14.0")).toBe(true);
  expect(isNewer("0.9.0", "0.11.0")).toBe(false);
  expect(isNewer("1.0.0", "0.99.9")).toBe(true);
  expect(isNewer("0.15.0", "0.15.0")).toBe(false);
});
