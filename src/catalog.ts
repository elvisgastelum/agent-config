// The catalog: abilities installed on demand (`agent-config install model-ladder`, `... kaneo`),
// either at user scope (each runtime's home config) or at project scope (one repository). An
// item is rendered into ordinary ops, so status, updates and uninstall treat every item alike.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import {
  COMMIT_GUARD_FILE,
  COMMIT_SKILL,
  COMMIT_WRITER,
  WRITER_BODY,
  WRITER_DESCRIPTION,
  commitInstructionsBlock,
  commitSkillMarkdown,
} from "./commit.ts";
import type { Config } from "./config.ts";
import { teamSection } from "./content.ts";
import { CODEX_POLICY, CONTINUE, continueMarkdown } from "./continue.ts";
import {
  KANEO_ITEM,
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
import { LADDER_ITEM, opKey, type Op } from "./ops.ts";
import { BRIEF, BRIEF_GUARD_FILE, BRIEF_GUARD_MATCHER, briefMarkdown } from "./brief.ts";
import {
  claudeDir,
  claudeJsonPath,
  codexDir,
  home,
  briefsDir,
  opencodeDir,
  piDir,
} from "./paths.ts";
import {
  PLANNING,
  PLANNING_INSTRUCTIONS_BLOCK,
  plannerBody,
  plannerDescription,
  plannerName,
  planningMarkdown,
} from "./planning.ts";
import { assetSource, opencodeConfigPath, runtimeOps, tomlMultiline } from "./runtimes.ts";
import { TIERS, type Effort, type Runtime, type Tier, type TierMap } from "./tiers.ts";

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
  /** Installs into each runtime's home config only; `--project` is refused. */
  userOnly?: boolean;
  /** The only runtimes it supports; absent means all of them. */
  runtimes?: Runtime[];
  /** Setting values already configured on this machine, offered as defaults. */
  discover: () => Record<string, string>;
  ops: (entry: CatalogEntry, runtime: Runtime, config: Config) => Op[];
}

/** Identifies an entry in the config and its ops in the manifest: "kaneo@user" or "kaneo@/repo". */
export function entryKey(entry: { item: string; project?: string }): string {
  return `${entry.item}@${entry.project ?? "user"}`;
}

/** The item and project an entry key names; the inverse of `entryKey`. */
export function parseEntryKey(key: string): { item: string; project?: string } {
  const at = key.indexOf("@");
  const scope = key.slice(at + 1);
  return { item: key.slice(0, at), ...(scope === "user" ? {} : { project: scope }) };
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

function modelName(
  runtime: Runtime,
  tiers: TierMap,
  effort: Effort = tiers.fast.effort,
  tier: Tier = "fast",
): string {
  const { model } = tiers[tier];
  if (runtime === "codex" || !model) return `${model || "session model"}, ${effort} effort`;
  return model;
}

/** A catalog agent on one rung (fast unless `tier` says otherwise), and what it may do in each runtime. */
interface CatalogAgent {
  name: string;
  description: string;
  body: string;
  /** The rung whose model and effort it runs on; fast when unset. */
  tier?: Tier;
  /** Thinking effort; defaults to the rung's. */
  effort?: Effort;
  claudeTools: string[];
  /** OpenCode permissions, each denied. */
  opencodeDeny: string[];
  codexSandbox: "read-only" | "workspace-write";
  piTools: string[];
}

function catalogAgent(
  runtime: Runtime,
  dir: string,
  tiers: TierMap,
  agent: CatalogAgent,
): { path: string; content: string } {
  const { model } = tiers[agent.tier ?? "fast"];
  const effort = agent.effort ?? tiers[agent.tier ?? "fast"].effort;
  const { name } = agent;
  const body = `${agent.body.trimEnd()}\n\n${teamSection()}\n`;
  const description = JSON.stringify(agent.description);
  switch (runtime) {
    case "claude": {
      const lines = ["---", `name: ${name}`, `description: ${description}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(`tools: ${agent.claudeTools.join(", ")}`, "---", "", body);
      return { path: join(dir, `${name}.md`), content: lines.join("\n") };
    }
    case "opencode": {
      const lines = ["---", `description: ${description}`, "mode: subagent"];
      if (model) lines.push(`model: ${model}`);
      lines.push("permission:", ...agent.opencodeDeny.map((p) => `  ${p}: deny`), "---", "", body);
      return { path: join(dir, `${name}.md`), content: lines.join("\n") };
    }
    case "codex": {
      const lines = [`name = ${JSON.stringify(name)}`, `description = ${description}`];
      if (model) lines.push(`model = ${JSON.stringify(model)}`);
      lines.push(
        `model_reasoning_effort = ${JSON.stringify(effort)}`,
        `sandbox_mode = ${JSON.stringify(agent.codexSandbox)}`,
        `developer_instructions = ${tomlMultiline(body)}`,
        "",
      );
      return { path: join(dir, `${name}.toml`), content: lines.join("\n") };
    }
    case "pi": {
      const lines = ["---", `name: ${name}`, `description: ${description}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(
        `thinking: ${effort}`,
        "tools:",
        ...agent.piTools.map((t) => `  - ${t}`),
        "---",
        "",
        body,
      );
      return { path: join(dir, `${name}.md`), content: lines.join("\n") };
    }
  }
}

// ---------------------------------------------------------------- kaneo

/** The block that the standalone kaneo-work-tracking-skill installer wrote; replaced in place. */
const KANEO_LEGACY_BLOCK: [string, string] = [
  "<!-- BEGIN kaneo-work-tracking-skill: managed by install.sh, edits inside this block are overwritten -->",
  "<!-- END kaneo-work-tracking-skill -->",
];

const SCRIBE_AGENT: CatalogAgent = {
  name: SCRIBE,
  description: SCRIBE_DESCRIPTION,
  body: SCRIBE_BODY,
  claudeTools: KANEO_TOOLS,
  opencodeDeny: ["edit", "bash", "task"],
  codexSandbox: "read-only",
  // Pi keeps MCP tools undeclared (codemode exposure); tool_search loads only those, so the
  // scribe reaches Kaneo without read, edit, bash or codemode (whose scripts can run bash).
  piTools: ["tool_search"],
};

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

/**
 * The model ladder: ladder agents, routing skill, instructions, read guard and review models.
 * Its parts, rungs and models are the top-level ladder settings of the saved configuration.
 */
const modelLadder: CatalogItem = {
  id: LADDER_ITEM,
  title: "Model ladder",
  description:
    "Route reads and edits to the cheapest capable model (fast → balanced → deep): ladder agents, skill, instructions, read guard, review models.",
  settings: [],
  userOnly: true,
  discover: () => ({}),
  ops: (_entry, runtime, config) => runtimeOps(runtime, config),
};

const kaneo: CatalogItem = {
  id: KANEO_ITEM,
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
  ops: (entry, runtime, config) => {
    const tiers = config.tiers[runtime];
    const where = layout(runtime, entry.project);
    const scribe = catalogAgent(runtime, where.agents, tiers, SCRIBE_AGENT);
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

// ---------------------------------------------------------------- commit

/** The block that the standalone claude-commit-skill installer wrote; replaced in place. */
const COMMIT_LEGACY_BLOCK: [string, string] = [
  "<!-- BEGIN claude-commit-skill: managed by install.sh, edits inside this block are overwritten -->",
  "<!-- END claude-commit-skill -->",
];

/** Commit titles are short pattern work: the fast model, always at low effort. */
const WRITER_EFFORT: Effort = "low";

const WRITER_AGENT: CatalogAgent = {
  name: COMMIT_WRITER,
  description: WRITER_DESCRIPTION,
  body: WRITER_BODY,
  effort: WRITER_EFFORT,
  claudeTools: ["Bash", "Read", "Grep", "Glob"],
  opencodeDeny: ["edit", "task"],
  codexSandbox: "read-only",
  piTools: ["read", "grep", "find", "ls", "bash"],
};

export const SHELL_SPLIT_FILE = "shell-split.mjs";
const SHELL_SPLIT_IMPORT = new RegExp(
  `^import\\s*\\{[^}]*\\}\\s*from\\s*["']\\./${SHELL_SPLIT_FILE.replace(".", "\\.")}["'];?[ \\t]*\\r?\\n?`,
  "m",
);
/** `import { a, b } from "node:x";`, possibly across lines inside the braces. */
const NAMED_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2;?[ \t]*$/gm;
/** Any import statement, to find the ones the module may not have. */
const ANY_IMPORT = /^import\b[^;]*?(?:;|$)/gm;
const EXPORT_KEYWORD = /^export (?=(?:const|async function|function|let|class)\b)/gm;
/** Any `export` left at a line start after the supported forms are stripped. */
const LEFTOVER_EXPORT = /^export\b.*/m;
/** A top-level declaration at a line start; capture 1 is the declared name. */
const TOP_LEVEL_DECLARATION =
  /^(?:async\s+function|const|let|class|function)\s+([A-Za-z_$][\w$]*)/gm;
const SHEBANG_LINE = /^#![^\n]*\n/;
const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const REGEX_ESCAPE_REPLACEMENT = "\\$&";
const IMPORT_NAME_SEPARATOR = ",";
const IMPORT_NAME_LIST = /\s*,\s*/;
const NODE_SPECIFIER_PREFIX = "node:";

/**
 * Inlines the shell splitter module into a hook that imports it from `./shell-split.mjs`, so an
 * installed hook stays one self-contained file. The module may only import named values from node
 * built-ins; those merge into the hook's own imports, one statement per module.
 */
export function inlineShellSplit(hook: string, module: string): string {
  if (!SHELL_SPLIT_IMPORT.test(hook)) return hook;
  const nodeImports = new Map<string, Set<string>>();
  const body = module
    .replace(NAMED_IMPORT, (statement, names: string, _quote, specifier: string) => {
      if (!specifier.startsWith(NODE_SPECIFIER_PREFIX)) return statement;
      const set = nodeImports.get(specifier) ?? new Set<string>();
      for (const name of names.split(IMPORT_NAME_SEPARATOR)) if (name.trim()) set.add(name.trim());
      nodeImports.set(specifier, set);
      return "";
    })
    .replace(EXPORT_KEYWORD, "");
  const leftover = body.match(ANY_IMPORT);
  if (leftover)
    throw new Error(`${SHELL_SPLIT_FILE} may only import named node: modules: ${leftover[0]}`);
  const leftoverExport = body.match(LEFTOVER_EXPORT);
  if (leftoverExport)
    throw new Error(
      `${SHELL_SPLIT_FILE} has an export form that cannot be inlined: ${leftoverExport[0]}`,
    );
  const hookNames = new Set([...hook.matchAll(TOP_LEVEL_DECLARATION)].map((m) => m[1]));
  for (const m of body.matchAll(TOP_LEVEL_DECLARATION))
    if (hookNames.has(m[1]))
      throw new Error(`${SHELL_SPLIT_FILE} declares ${m[1]}, which the hook already declares`);
  let out = hook.replace(SHELL_SPLIT_IMPORT, () => `${body.trim()}\n\n`);
  for (const [specifier, names] of nodeImports) {
    const own = [...out.matchAll(NAMED_IMPORT)].find((m) => m[3] === specifier);
    const escaped = specifier.replace(REGEX_ESCAPE, REGEX_ESCAPE_REPLACEMENT);
    if (!own && new RegExp(`^import\\b[^;]*?["']${escaped}["']`, "m").test(out))
      throw new Error(`the hook imports ${specifier} in a form that cannot be merged`);
    const merged = new Set(names);
    if (own) for (const n of own[1].split(IMPORT_NAME_LIST)) if (n.trim()) merged.add(n.trim());
    const statement = `import { ${[...merged].sort().join(", ")} } from ${JSON.stringify(specifier)};`;
    if (own) {
      out = out.replace(own[0], () => statement);
    } else {
      const last = [...out.matchAll(NAMED_IMPORT)].at(-1);
      if (last) {
        const at = last.index + last[0].length;
        out = `${out.slice(0, at)}\n${statement}${out.slice(at)}`;
      } else {
        const at = out.match(SHEBANG_LINE)?.[0].length ?? 0;
        out = `${out.slice(0, at)}${statement}\n${out.slice(at)}`;
      }
    }
  }
  return out;
}

/** A hook asset as installed: self-contained, with an import of ./shell-split.mjs inlined. */
function renderHook(file: string): string {
  const hook = assetSource(file);
  return SHELL_SPLIT_IMPORT.test(hook)
    ? inlineShellSplit(hook, assetSource(SHELL_SPLIT_FILE))
    : hook;
}

/**
 * Claude only: copies a hook script asset, rendered self-contained (an import of ./shell-split.mjs
 * is inlined), into the hooks folder and registers it as a PreToolUse hook for the matcher. A project's settings are committed, so its hook finds the script from the
 * project root.
 */
function guardHookOps(
  project: string | undefined,
  file: string,
  matcher: string,
  scriptLabel: string,
  hookLabel: string,
): Op[] {
  const base = { runtime: "claude" as const, component: "catalog" as const };
  const dir = project ? join(project, ".claude") : claudeDir();
  const script = join(dir, "hooks", "agent-config", file);
  const settings = join(dir, "settings.json");
  const command = project
    ? `node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-config/${file}"`
    : `node "${script}"`;
  return [
    {
      ...base,
      kind: "file",
      path: script,
      content: renderHook(file),
      executable: true,
      label: scriptLabel,
    },
    {
      ...base,
      kind: "json-hook",
      path: settings,
      event: "PreToolUse",
      matcher,
      command,
      label: hookLabel,
    },
  ];
}

/** Claude only: the commit guard hook and the settings that drop commit and PR attribution. */
function commitGuardOps(project: string | undefined): Op[] {
  const base = { runtime: "claude" as const, component: "catalog" as const };
  const dir = project ? join(project, ".claude") : claudeDir();
  const settings = join(dir, "settings.json");
  return [
    ...guardHookOps(
      project,
      COMMIT_GUARD_FILE,
      "Bash",
      "commit-guard hook script",
      "PreToolUse hook (Bash) commit guard",
    ),
    {
      ...base,
      kind: "json-set",
      path: settings,
      pointer: ["attribution", "commit"],
      value: "",
      label: 'attribution.commit = ""',
    },
    {
      ...base,
      kind: "json-set",
      path: settings,
      pointer: ["attribution", "pr"],
      value: "",
      label: 'attribution.pr = ""',
    },
    {
      ...base,
      kind: "json-set",
      path: settings,
      pointer: ["includeCoAuthoredBy"],
      value: false,
      label: "includeCoAuthoredBy = false",
    },
  ];
}

const commit: CatalogItem = {
  id: "commit",
  title: "Commit titles",
  description:
    "title-only commit skill, no-AI-attribution rules, a cheap low-thinking commit-writer agent that drafts the title, and a Claude commit guard",
  settings: [],
  discover: () => ({}),
  ops: (entry, runtime, config) => {
    const tiers = config.tiers[runtime];
    const where = layout(runtime, entry.project);
    const writer = catalogAgent(runtime, where.agents, tiers, WRITER_AGENT);
    const model = modelName(runtime, tiers, WRITER_EFFORT);
    const ops: Op[] = [
      {
        runtime,
        component: "catalog",
        kind: "file",
        path: join(where.skills, COMMIT_SKILL, "SKILL.md"),
        content: commitSkillMarkdown(runtime, model),
        label: `commit skill ${COMMIT_SKILL}`,
      },
      {
        runtime,
        component: "catalog",
        kind: "file",
        path: writer.path,
        content: writer.content,
        label: `commit agent ${COMMIT_WRITER} (${model})`,
      },
      {
        runtime,
        component: "catalog",
        kind: "block",
        path: where.instructions,
        content: commitInstructionsBlock(
          entry.runtimes.filter(
            (r) => layout(r, entry.project).instructions === where.instructions,
          ),
        ),
        markers: [blockMarkers("commit", "html"), COMMIT_LEGACY_BLOCK],
        label: "commit instructions block",
      },
    ];
    if (runtime === "claude") ops.push(...commitGuardOps(entry.project));
    return ops;
  },
};

// ---------------------------------------------------------------- continue

/**
 * Where each runtime reads a manual-only action: a Claude skill that the model never invokes, an
 * OpenCode command, a Codex skill with implicit invocation off, a Pi prompt template.
 */
function actionOps(
  runtime: Runtime,
  project: string | undefined,
  name: string,
  content: string,
  label: string,
): Op[] {
  const base = { runtime, component: "catalog" as const, label: `${label} action` };
  const skill = join(layout(runtime, project).skills, name);
  switch (runtime) {
    case "claude":
      return [{ ...base, kind: "file", path: join(skill, "SKILL.md"), content }];
    case "opencode": {
      const dir = project ? join(project, ".opencode") : opencodeDir();
      return [{ ...base, kind: "file", path: join(dir, "commands", `${name}.md`), content }];
    }
    case "codex":
      return [
        { ...base, kind: "file", path: join(skill, "SKILL.md"), content },
        {
          ...base,
          kind: "file",
          path: join(skill, "agents", "openai.yaml"),
          content: CODEX_POLICY,
          label: `${label} action policy (explicit invocation only)`,
        },
      ];
    case "pi": {
      const dir = project ? join(project, ".pi") : piDir();
      return [{ ...base, kind: "file", path: join(dir, "prompts", `${name}.md`), content }];
    }
  }
}

function continueOps(runtime: Runtime, project: string | undefined, config: Config): Op[] {
  const tiers = config.tiers[runtime];
  const content = continueMarkdown(
    runtime,
    {
      fast: modelName(runtime, tiers),
      balanced: modelName(runtime, tiers, tiers.balanced.effort, "balanced"),
      deep: modelName(runtime, tiers, tiers.deep.effort, "deep"),
    },
    briefDirText(project),
  );
  return actionOps(runtime, project, CONTINUE, content, "continue");
}

// ---------------------------------------------------------------- brief

/** How the skill shows the home directory. */
const HOME_SHORTHAND = "~";

/**
 * `briefsDir()` as a shell path, for a committed project skill that other machines run: it names
 * no one's state directory.
 */
const PORTABLE_BRIEF_DIR = "${XDG_STATE_HOME:-~/.local/state}/agent-config/briefs";

/**
 * The brief folder as the skill shows it: portable in a project, and under the home directory it
 * reads `~/...`.
 */
function briefDirText(project: string | undefined): string {
  if (project) return PORTABLE_BRIEF_DIR;
  const dir = briefsDir();
  const root = home();
  return dir.startsWith(`${root}/`) ? `${HOME_SHORTHAND}${dir.slice(root.length)}` : dir;
}

/** Claude only: the guard that keeps phase rungs and the brief structure honest. */
function briefGuardOps(project: string | undefined): Op[] {
  return guardHookOps(
    project,
    BRIEF_GUARD_FILE,
    BRIEF_GUARD_MATCHER,
    "brief-guard hook script",
    `PreToolUse hook (${BRIEF_GUARD_MATCHER}) brief guard`,
  );
}

function briefOps(runtime: Runtime, project: string | undefined, config: Config): Op[] {
  const tiers = config.tiers[runtime];
  const content = briefMarkdown(
    runtime,
    {
      fast: modelName(runtime, tiers),
      balanced: modelName(runtime, tiers, tiers.balanced.effort, "balanced"),
      deep: modelName(runtime, tiers, tiers.deep.effort, "deep"),
    },
    briefDirText(project),
  );
  const ops = actionOps(runtime, project, BRIEF, content, "brief");
  if (runtime === "claude") ops.push(...briefGuardOps(project));
  return ops;
}

/** What the planner agents may use: read the repository and run commands, never edit it. */
const PLANNER_CLAUDE_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const PLANNER_OPENCODE_DENY = ["edit", "task"];
const PLANNER_PI_TOOLS = ["read", "grep", "find", "ls", "bash"];

function planningOps(entry: CatalogEntry, runtime: Runtime, config: Config): Op[] {
  const project = entry.project;
  const tiers = config.tiers[runtime];
  const content = planningMarkdown(runtime, {
    fast: modelName(runtime, tiers),
    balanced: modelName(runtime, tiers, tiers.balanced.effort, "balanced"),
    deep: modelName(runtime, tiers, tiers.deep.effort, "deep"),
  });
  const ops = actionOps(runtime, project, PLANNING, content, "planning");
  for (const tier of TIERS) {
    const name = plannerName(tier);
    const agent = catalogAgent(runtime, layout(runtime, project).agents, tiers, {
      name,
      description: plannerDescription(tier, tiers[tier].model),
      body: plannerBody(tier),
      tier,
      claudeTools: PLANNER_CLAUDE_TOOLS,
      opencodeDeny: PLANNER_OPENCODE_DENY,
      codexSandbox: "workspace-write",
      piTools: PLANNER_PI_TOOLS,
    });
    ops.push({
      runtime,
      component: "catalog",
      kind: "file",
      path: agent.path,
      content: agent.content,
      label: `planning agent ${name} (${modelName(runtime, tiers, tiers[tier].effort, tier)})`,
    });
  }
  // Runtime-neutral text, so runtimes that share this file (AGENTS.md in a project) write one block.
  ops.push({
    runtime,
    component: "catalog",
    kind: "block",
    path: layout(runtime, project).instructions,
    content: PLANNING_INSTRUCTIONS_BLOCK,
    markers: [blockMarkers(PLANNING, "html")],
    label: "planning instructions block",
  });
  return ops;
}

// ---------------------------------------------------------------- statusline

export const STATUSLINE_FILE = "statusline.sh";

const statusline: CatalogItem = {
  id: "statusline",
  title: "Status line",
  description:
    "compact Claude Code status line: directory, git branch and dirty mark, model, context and rate-limit usage",
  settings: [],
  userOnly: true,
  runtimes: ["claude"],
  discover: () => ({}),
  // The path the standalone claude-statusline installer used, so its copy is taken over in place.
  ops: () => {
    const base = { runtime: "claude" as const, component: "catalog" as const };
    const script = join(claudeDir(), STATUSLINE_FILE);
    return [
      {
        ...base,
        kind: "file",
        path: script,
        content: assetSource(STATUSLINE_FILE),
        executable: true,
        label: "status line script",
      },
      {
        ...base,
        kind: "json-set",
        path: join(claudeDir(), "settings.json"),
        pointer: ["statusLine"],
        value: { type: "command", command: `bash "${script}"` },
        label: "statusLine command",
      },
    ];
  },
};

// ---------------------------------------------------------------- bypass permissions

const bypassPermissions: CatalogItem = {
  id: "bypass-permissions",
  title: "Bypass permissions by default",
  description:
    "starts every Claude Code session on this computer with bypass permissions on, so tools run without permission prompts; uninstall restores the previous mode",
  settings: [],
  userOnly: true,
  runtimes: ["claude"],
  discover: () => ({}),
  ops: () => {
    const base = {
      runtime: "claude" as const,
      component: "catalog" as const,
      kind: "json-set" as const,
    };
    const settings = join(claudeDir(), "settings.json");
    return [
      {
        ...base,
        path: settings,
        pointer: ["permissions", "defaultMode"],
        value: "bypassPermissions",
        label: 'permissions.defaultMode = "bypassPermissions"',
      },
      // Without it Claude Code asks to confirm bypass mode at the start of each session.
      {
        ...base,
        path: settings,
        pointer: ["skipDangerousModePermissionPrompt"],
        value: true,
        label: "skipDangerousModePermissionPrompt = true",
      },
    ];
  },
};

const continueItem: CatalogItem = {
  id: CONTINUE,
  title: "Continue Kaneo or plan store tickets",
  description:
    "manual /continue action that works the next Kaneo ticket, or a ticket ID from a .plans store, (or several in parallel worktrees) end to end, handing reads, edits, ticket writes and commit titles to cheap agents",
  settings: [],
  discover: () => ({}),
  ops: (entry, runtime, config) => continueOps(runtime, entry.project, config),
};

const briefItem: CatalogItem = {
  id: BRIEF,
  title: "Brief a Kaneo epic or plan store ticket for a fresh session",
  description:
    "manual /brief action that diagnoses what a Kaneo epic, or a ticket ID from a .plans store, is missing on the deep rung, asks how to run it and copies a /continue brief that works the whole epic in a fresh session, with risk-routed reviews and a Claude guard hook",
  settings: [],
  discover: () => ({}),
  ops: (entry, runtime, config) => briefOps(runtime, entry.project, config),
};

const planningItem: CatalogItem = {
  id: PLANNING,
  title: "Plan work with you",
  description:
    "manual /planning action that interviews you about a project, epic, feature, fix or ticket, finds gaps and red flags on the deep rung, keeps the plan in a SQLite store under .plans and writes Kaneo epics in parallel waves when kaneo is installed, and installs the planner-fast, planner-balanced and planner-deep agents, one per rung, and an always-on instructions block saying planning reports do not authorize changes",
  settings: [],
  discover: () => ({}),
  ops: (entry, runtime, config) => planningOps(entry, runtime, config),
};

export const CATALOG: CatalogItem[] = [
  modelLadder,
  kaneo,
  commit,
  continueItem,
  briefItem,
  planningItem,
  statusline,
  bypassPermissions,
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

/** The runtimes the model ladder is installed for; empty when it is not installed. */
export function ladderRuntimes(config: Config): Runtime[] {
  return config.catalog.find((e) => e.item === LADDER_ITEM)?.runtimes ?? [];
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
 * scope several runtimes share AGENTS.md; that block is planned once, for the first runtime. The
 * ladder is planned first, as it was before it became a catalog item.
 */
export function catalogOps(config: Config, keys?: string[]): Op[] {
  const ops = new Map<string, Op>();
  const missing = new Set(missingProjects(config).map(entryKey));
  const entries = [
    ...config.catalog.filter((e) => e.item === LADDER_ITEM),
    ...config.catalog.filter((e) => e.item !== LADDER_ITEM),
  ];
  for (const entry of entries) {
    const key = entryKey(entry);
    const item = catalogItem(entry.item);
    if (!item || (keys && !keys.includes(key)) || missing.has(key)) continue;
    for (const runtime of entry.runtimes) {
      for (const op of item.ops(entry, runtime, config)) {
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
 * the saved entry, else the ladder's runtimes, else detection; settings from the saved entry,
 * else what this machine already has configured.
 */
export function entryDefaults(
  item: CatalogItem,
  project: string | undefined,
  config: Config,
  detected: () => Runtime[],
): EntryDefaults {
  const saved = config.catalog.find((e) => entryKey(e) === entryKey({ item: item.id, project }));
  const ladder = ladderRuntimes(config);
  const runtimes =
    item.runtimes?.length === 1
      ? item.runtimes
      : (saved?.runtimes.length ? saved.runtimes : ladder.length > 0 ? ladder : detected()).filter(
          (r) => !item.runtimes || item.runtimes.includes(r),
        );
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
