// The catalog: optional abilities installed on demand (`agent-config install kaneo`), either at
// user scope (each runtime's home config) or at project scope (one repository). An item is
// rendered into ordinary ops, so status, updates and uninstall treat it like the ladder.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { Config } from "./config.ts";
import {
  KANEO_MCP,
  KANEO_SKILL,
  KANEO_TOOLS,
  SCRIBE,
  SCRIBE_BODY,
  SCRIBE_DESCRIPTION,
  kaneoBaseUrl,
  kaneoInstructionsBlock,
  kaneoMcpUrl,
  kaneoSkillMarkdown,
  kaneoUrlWarning,
} from "./kaneo.ts";
import { opKey, type Op } from "./ops.ts";
import { claudeDir, claudeJsonPath, codexDir, opencodeDir, piDir } from "./paths.ts";
import { opencodeConfigPath, tomlMultiline } from "./runtimes.ts";
import type { Runtime, TierMap } from "./tiers.ts";

export type Scope = "user" | "project";

/** One installed catalog item: where it goes, for which runtimes, with which settings. */
export interface CatalogEntry {
  item: string;
  /** Absolute repository directory for project scope; absent for user scope. */
  project?: string;
  runtimes: Runtime[];
  settings: Record<string, string>;
}

export interface CatalogSetting {
  key: string;
  /** The CLI flag that sets it, without dashes. */
  flag: string;
  message: string;
  placeholder: string;
  /** Returns the value to store, or undefined when the input is not valid. */
  normalize: (raw: string) => string | undefined;
  /** A caution about a valid value, such as a URL without TLS. */
  warning?: (value: string) => string | undefined;
}

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  settings: CatalogSetting[];
  /** Setting values already configured on this machine, offered as defaults. */
  discover: () => Record<string, string>;
  ops: (entry: CatalogEntry, runtime: Runtime, tiers: TierMap) => Op[];
}

/** Identifies an entry in the config and its ops in the manifest: "kaneo@user" or "kaneo@/repo". */
export function entryKey(entry: { item: string; project?: string }): string {
  return `${entry.item}@${entry.project ?? "user"}`;
}

export function scopeLabel(entry: { project?: string }): string {
  return entry.project ? `project ${entry.project}` : "user";
}

interface Layout {
  skills: string;
  agents: string;
  instructions: string;
}

/** Where a runtime reads skills, agents and instructions at user or project scope. */
function layout(runtime: Runtime, project?: string): Layout {
  if (!project) {
    const root = { claude: claudeDir(), opencode: opencodeDir(), codex: codexDir(), pi: piDir() }[
      runtime
    ];
    const memory = runtime === "claude" ? "CLAUDE.md" : "AGENTS.md";
    return {
      skills: join(root, "skills"),
      agents: join(root, "agents"),
      instructions: join(root, memory),
    };
  }
  switch (runtime) {
    case "claude":
      return {
        skills: join(project, ".claude", "skills"),
        agents: join(project, ".claude", "agents"),
        instructions: join(project, "CLAUDE.md"),
      };
    case "opencode":
      return {
        skills: join(project, ".opencode", "skills"),
        agents: join(project, ".opencode", "agents"),
        instructions: join(project, "AGENTS.md"),
      };
    case "codex":
      return {
        skills: join(project, ".agents", "skills"),
        agents: join(project, ".codex", "agents"),
        instructions: join(project, "AGENTS.md"),
      };
    case "pi":
      return {
        skills: join(project, ".pi", "skills"),
        agents: join(project, ".pi", "agents"),
        instructions: join(project, "AGENTS.md"),
      };
  }
}

/** Markers of an item's managed block in Markdown and in TOML. */
function blockMarkers(id: string, comment: "html" | "hash"): [string, string] {
  const note = "managed by agent-config, edits inside this block are overwritten";
  return comment === "html"
    ? [`<!-- BEGIN agent-config:${id}: ${note} -->`, `<!-- END agent-config:${id} -->`]
    : [`# BEGIN agent-config:${id}: ${note}`, `# END agent-config:${id}`];
}

function readJson(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"), [], { allowTrailingComma: true });
  } catch {
    return undefined;
  }
}

function at(root: unknown, pointer: string[]): unknown {
  let node = root;
  for (const seg of pointer) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function modelName(runtime: Runtime, tiers: TierMap): string {
  const { model, effort } = tiers.fast;
  if (runtime === "codex" || !model) return `${model || "session model"}, ${effort} effort`;
  return model;
}

// ---------------------------------------------------------------- kaneo

/** The block that the standalone kaneo-work-tracking-skill installer wrote; replaced in place. */
const KANEO_LEGACY_BLOCK: [string, string] = [
  "<!-- BEGIN kaneo-work-tracking-skill: managed by install.sh, edits inside this block are overwritten -->",
  "<!-- END kaneo-work-tracking-skill -->",
];

function scribeAgent(
  runtime: Runtime,
  dir: string,
  tiers: TierMap,
): { path: string; content: string } {
  const { model, effort } = tiers.fast;
  const description = JSON.stringify(SCRIBE_DESCRIPTION);
  switch (runtime) {
    case "claude": {
      const lines = ["---", `name: ${SCRIBE}`, `description: ${description}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(`tools: ${KANEO_TOOLS.join(", ")}`, "---", "", SCRIBE_BODY);
      return { path: join(dir, `${SCRIBE}.md`), content: lines.join("\n") };
    }
    case "opencode": {
      const lines = ["---", `description: ${description}`, "mode: subagent"];
      if (model) lines.push(`model: ${model}`);
      lines.push(
        "permission:",
        "  edit: deny",
        "  bash: deny",
        "  task: deny",
        "---",
        "",
        SCRIBE_BODY,
      );
      return { path: join(dir, `${SCRIBE}.md`), content: lines.join("\n") };
    }
    case "codex": {
      const lines = [`name = ${JSON.stringify(SCRIBE)}`, `description = ${description}`];
      if (model) lines.push(`model = ${JSON.stringify(model)}`);
      lines.push(
        `model_reasoning_effort = ${JSON.stringify(effort)}`,
        `sandbox_mode = "read-only"`,
        `developer_instructions = ${tomlMultiline(SCRIBE_BODY)}`,
        "",
      );
      return { path: join(dir, `${SCRIBE}.toml`), content: lines.join("\n") };
    }
    case "pi": {
      // Pi keeps MCP tools undeclared (codemode exposure); tool_search loads only those, so the
      // scribe reaches Kaneo without read, edit, bash or codemode (whose scripts can run bash).
      const lines = ["---", `name: ${SCRIBE}`, `description: ${description}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(`thinking: ${effort}`, "tools:", "  - tool_search", "---", "", SCRIBE_BODY);
      return { path: join(dir, `${SCRIBE}.md`), content: lines.join("\n") };
    }
  }
}

function kaneoMcpOp(runtime: Runtime, project: string | undefined, url: string): Op {
  const base = { runtime, component: "catalog" as const, label: `kaneo MCP server ${url}` };
  switch (runtime) {
    case "claude":
      return {
        ...base,
        kind: "json-set",
        path: project ? join(project, ".mcp.json") : claudeJsonPath(),
        pointer: ["mcpServers", KANEO_MCP],
        value: { type: "http", url },
      };
    case "opencode":
      return {
        ...base,
        kind: "json-set",
        path: opencodeConfigPath(project),
        pointer: ["mcp", KANEO_MCP],
        value: { enabled: true, type: "remote", url },
      };
    case "codex": {
      const table = `[mcp_servers.${KANEO_MCP}]`;
      return {
        ...base,
        kind: "block",
        path: join(project ? join(project, ".codex") : codexDir(), "config.toml"),
        content: `${table}\nurl = ${JSON.stringify(url)}`,
        markers: [blockMarkers("kaneo", "hash")],
        conflict: table,
      };
    }
    case "pi":
      return {
        ...base,
        kind: "json-set",
        path: project ? join(project, ".pi", "mcp.json") : join(piDir(), "mcp.json"),
        pointer: ["mcpServers", KANEO_MCP],
        value: { url },
      };
  }
}

const kaneo: CatalogItem = {
  id: "kaneo",
  title: "Kaneo work tracking",
  description:
    "kaneo-work-tracking skill, always-on rules, the kaneo MCP server and a cheap kaneo-scribe agent that saves tickets",
  settings: [
    {
      key: "url",
      flag: "url",
      message: "Kaneo base URL",
      placeholder: "https://kaneo.example.com",
      normalize: kaneoBaseUrl,
      warning: kaneoUrlWarning,
    },
  ],
  discover: (): Record<string, string> => {
    const found = [
      at(readJson(claudeJsonPath()), ["mcpServers", KANEO_MCP, "url"]),
      at(readJson(opencodeConfigPath()), ["mcp", KANEO_MCP, "url"]),
      at(readJson(join(piDir(), "mcp.json")), ["mcpServers", KANEO_MCP, "url"]),
    ].find((u): u is string => typeof u === "string");
    const url = found && kaneoBaseUrl(found);
    return url ? { url } : {};
  },
  ops: (entry, runtime, tiers) => {
    const where = layout(runtime, entry.project);
    const scribe = scribeAgent(runtime, where.agents, tiers);
    const ops: Op[] = [
      {
        runtime,
        component: "catalog",
        kind: "file",
        path: join(where.skills, KANEO_SKILL, "SKILL.md"),
        content: kaneoSkillMarkdown(runtime, modelName(runtime, tiers)),
        label: `kaneo skill ${KANEO_SKILL}`,
      },
      {
        runtime,
        component: "catalog",
        kind: "file",
        path: scribe.path,
        content: scribe.content,
        label: `kaneo agent ${SCRIBE} (${modelName(runtime, tiers)})`,
      },
      {
        runtime,
        component: "catalog",
        kind: "block",
        path: where.instructions,
        // Runtimes that share this file (AGENTS.md in a project) get one block naming them all, so
        // its text does not depend on which runtime planned it.
        content: kaneoInstructionsBlock(
          entry.runtimes.filter(
            (r) => layout(r, entry.project).instructions === where.instructions,
          ),
        ),
        markers: [blockMarkers("kaneo", "html"), KANEO_LEGACY_BLOCK],
        label: "kaneo instructions block",
      },
    ];
    const url = entry.settings.url;
    if (url) ops.push(kaneoMcpOp(runtime, entry.project, kaneoMcpUrl(url)));
    return ops;
  },
};

export const CATALOG: CatalogItem[] = [kaneo];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

/** One line per skipped project entry, telling how to forget it. */
export function missingProjectWarnings(config: Config): string[] {
  return missingProjects(config).map(
    (e) =>
      `${e.item}: project directory ${e.project} is gone; skipped. Run \`agent-config uninstall ${e.item} --project ${e.project}\` to forget it.`,
  );
}

/** Project entries whose repository directory no longer exists; they are skipped, not recreated. */
export function missingProjects(config: Config): CatalogEntry[] {
  return config.catalog.filter((e) => e.project !== undefined && !existsSync(e.project));
}

/**
 * Ops for the saved catalog entries (only those whose key is in `keys`, when given). At project
 * scope several runtimes share AGENTS.md; that block is planned once, for the first runtime.
 */
export function catalogOps(config: Config, keys?: string[]): Op[] {
  const ops = new Map<string, Op>();
  const missing = new Set(missingProjects(config).map(entryKey));
  for (const entry of config.catalog) {
    const key = entryKey(entry);
    const item = catalogItem(entry.item);
    if (!item || (keys && !keys.includes(key)) || missing.has(key)) continue;
    for (const runtime of entry.runtimes) {
      for (const op of item.ops(entry, runtime, config.tiers[runtime])) {
        const tagged = { ...op, item: key } as Op;
        if (!ops.has(opKey(tagged))) ops.set(opKey(tagged), tagged);
      }
    }
  }
  return [...ops.values()];
}

export interface EntryDefaults {
  saved?: CatalogEntry;
  runtimes: Runtime[];
  /** Each setting's default and where it came from. */
  settings: Record<string, { value: string; source: "saved" | "discovered" }>;
}

/**
 * Defaults for installing an item at a scope, shared by the CLI and the TUI: runtimes come from
 * the saved entry, else the configured runtimes, else detection; settings from the saved entry,
 * else what this machine already has configured.
 */
export function entryDefaults(
  item: CatalogItem,
  project: string | undefined,
  config: Config,
  detected: () => Runtime[],
): EntryDefaults {
  const saved = config.catalog.find((e) => entryKey(e) === entryKey({ item: item.id, project }));
  const runtimes = saved?.runtimes.length
    ? saved.runtimes
    : config.runtimes.length > 0
      ? config.runtimes
      : detected();
  const discovered = item.discover();
  const settings: EntryDefaults["settings"] = {};
  for (const s of item.settings) {
    const own = saved?.settings[s.key];
    if (own) settings[s.key] = { value: own, source: "saved" };
    else if (discovered[s.key])
      settings[s.key] = { value: discovered[s.key]!, source: "discovered" };
  }
  return { ...(saved ? { saved } : {}), runtimes, settings };
}

/** Adds or replaces the entry with the same item and scope. */
export function upsertEntry(config: Config, entry: CatalogEntry): void {
  const key = entryKey(entry);
  config.catalog = [...config.catalog.filter((e) => entryKey(e) !== key), entry];
}

/** Drops uninstalled runtimes from catalog entries, and entries left with none. */
export function forgetCatalog(
  config: Config,
  match: (e: CatalogEntry) => boolean,
  runtimes: string[],
): void {
  config.catalog = config.catalog.flatMap((e) => {
    if (!match(e)) return [e];
    const left = runtimes.length === 0 ? [] : e.runtimes.filter((r) => !runtimes.includes(r));
    return left.length > 0 ? [{ ...e, runtimes: left }] : [];
  });
}
