// Turns the config into the concrete file operations for each runtime.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentBody,
  agentDescription,
  instructionsBlock,
  orchestratorBody,
  orchestratorDescription,
  skillMarkdown,
  SKILL_NAME,
  type ModelNames,
} from "./content.ts";
import type { Config } from "./config.ts";
import type { Component, Op } from "./ops.ts";
import { claudeDir, codexDir, opencodeDir, piDir } from "./paths.ts";
import {
  ORCHESTRATOR,
  REVIEW_LENSES,
  ROLES,
  TIERS,
  agentName,
  type Effort,
  type Role,
  type Runtime,
  type Tier,
  type TierMap,
} from "./tiers.ts";

/** Which components mean something for each runtime. */
export const RUNTIME_COMPONENTS: Record<Runtime, Component[]> = {
  claude: ["agents", "skill", "instructions", "read-guard", "review-models"],
  opencode: ["agents", "skill", "instructions", "review-models"],
  codex: ["agents", "skill", "instructions"],
  pi: ["agents", "skill", "instructions", "review-models"],
};

export const READ_GUARD_FILE = "read-guard.mjs";

/** A file shipped in assets/, such as a hook script. */
export function assetSource(file: string): string {
  // dist/cli.mjs and src/runtimes.ts both sit one level below the package root.
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "assets", file), "utf8");
}

export function readGuardSource(): string {
  return assetSource(READ_GUARD_FILE);
}

function modelNames(runtime: Runtime, tiers: TierMap): ModelNames {
  const name = (tier: Tier): string => {
    const t = tiers[tier];
    if (runtime === "codex" || !t.model) return `${t.model || "session model"}, ${t.effort} effort`;
    return t.model;
  };
  return { fast: name("fast"), balanced: name("balanced"), deep: name("deep") };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** A TOML multi-line basic string: escapes backslashes, quote runs and control characters. */
export function tomlMultiline(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '""\\"')
    .replace(/\r/g, "\\r")
    .replace(
      // oxlint-disable-next-line no-control-regex -- matching control characters is the point
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `"""\n${escaped}"""`;
}

const PI_THINKING: Record<Effort, string> = { low: "low", medium: "medium", high: "high" };

/** Read-only git commands a reviewer may run where the runtime can limit the shell. */
export const REVIEW_GIT_COMMANDS = ["git diff", "git log", "git show", "git status"];

/** Each role's tools in Claude Code's names. Edits add Bash; reviewers need git to read the diff. */
export const CLAUDE_TOOLS: Record<Role, string[]> = {
  read: ["Read", "Grep", "Glob"],
  explore: ["Read", "Grep", "Glob"],
  research: ["WebSearch", "WebFetch", "Read", "Grep", "Glob"],
  edit: ["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
  review: ["Read", "Grep", "Glob", "Bash"],
};

/** Each role's tools in Pi's names. Pi has no web tool and cannot limit bash: researchers and reviewers get it. */
export const PI_TOOLS: Record<Role, string[]> = {
  read: ["read", "grep", "find", "ls"],
  explore: ["read", "grep", "find", "ls"],
  research: ["read", "grep", "find", "ls", "bash"],
  edit: ["read", "grep", "find", "ls", "edit", "write", "bash"],
  review: ["read", "grep", "find", "ls", "bash"],
};

/** Roles that never write; Codex runs them in its read-only sandbox. */
export function readOnlyRole(role: Role): boolean {
  return role !== "edit";
}

/** OpenCode permission lines for a role, under `permission:`. */
function opencodePermissions(role: Role): string[] {
  switch (role) {
    case "read":
    case "explore":
    case "research":
      return ["  edit: deny", "  bash: deny", "  task: deny"];
    case "review":
      return [
        "  edit: deny",
        "  bash:",
        '    "*": deny',
        ...REVIEW_GIT_COMMANDS.map((c) => `    "${c}*": allow`),
        "  task: deny",
      ];
    case "edit":
      return ["  task: deny"];
  }
}

function agentFile(
  runtime: Runtime,
  role: Role,
  tier: Tier,
  tiers: TierMap,
): { path: string; content: string } {
  const name = agentName(role, tier);
  const { model, effort } = tiers[tier];
  const description = agentDescription(role, tier, model);
  const body = agentBody(role, tier);
  switch (runtime) {
    case "claude": {
      const lines = ["---", `name: ${name}`, `description: ${yamlString(description)}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(`tools: ${CLAUDE_TOOLS[role].join(", ")}`, "---", "", body);
      return { path: join(claudeDir(), "agents", `${name}.md`), content: lines.join("\n") };
    }
    case "opencode": {
      const lines = ["---", `description: ${yamlString(description)}`, "mode: subagent"];
      if (model) lines.push(`model: ${model}`);
      lines.push("permission:", ...opencodePermissions(role), "---", "", body);
      return { path: join(opencodeDir(), "agents", `${name}.md`), content: lines.join("\n") };
    }
    case "codex": {
      const lines = [
        `name = ${JSON.stringify(name)}`,
        `description = ${JSON.stringify(description)}`,
      ];
      if (model) lines.push(`model = ${JSON.stringify(model)}`);
      lines.push(
        `model_reasoning_effort = ${JSON.stringify(effort)}`,
        `sandbox_mode = ${JSON.stringify(readOnlyRole(role) ? "read-only" : "workspace-write")}`,
      );
      if (role === "research") lines.push('web_search = "live"');
      lines.push(`developer_instructions = ${tomlMultiline(body)}`, "");
      return { path: join(codexDir(), "agents", `${name}.toml`), content: lines.join("\n") };
    }
    case "pi": {
      const lines = ["---", `name: ${name}`, `description: ${yamlString(description)}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(
        `thinking: ${PI_THINKING[effort]}`,
        "tools:",
        ...PI_TOOLS[role].map((t) => `  - ${t}`),
        "---",
        "",
        body,
      );
      return { path: join(piDir(), "agents", `${name}.md`), content: lines.join("\n") };
    }
  }
}

/** The orchestrator runs on the deep rung with the runtime's full tool set, so it can delegate. */
function orchestratorFile(runtime: Runtime, tiers: TierMap): { path: string; content: string } {
  const { model, effort } = tiers.deep;
  const description = orchestratorDescription(model);
  const body = orchestratorBody(runtime, modelNames(runtime, tiers));
  switch (runtime) {
    case "claude": {
      const lines = ["---", `name: ${ORCHESTRATOR}`, `description: ${yamlString(description)}`];
      if (model) lines.push(`model: ${model}`);
      lines.push("---", "", body);
      return { path: join(claudeDir(), "agents", `${ORCHESTRATOR}.md`), content: lines.join("\n") };
    }
    case "opencode": {
      const lines = ["---", `description: ${yamlString(description)}`, "mode: subagent"];
      if (model) lines.push(`model: ${model}`);
      lines.push("---", "", body);
      return {
        path: join(opencodeDir(), "agents", `${ORCHESTRATOR}.md`),
        content: lines.join("\n"),
      };
    }
    case "codex": {
      const lines = [
        `name = ${JSON.stringify(ORCHESTRATOR)}`,
        `description = ${JSON.stringify(description)}`,
      ];
      if (model) lines.push(`model = ${JSON.stringify(model)}`);
      lines.push(
        `model_reasoning_effort = ${JSON.stringify(effort)}`,
        `sandbox_mode = "workspace-write"`,
        `developer_instructions = ${tomlMultiline(body)}`,
        "",
      );
      return {
        path: join(codexDir(), "agents", `${ORCHESTRATOR}.toml`),
        content: lines.join("\n"),
      };
    }
    case "pi": {
      const lines = ["---", `name: ${ORCHESTRATOR}`, `description: ${yamlString(description)}`];
      if (model) lines.push(`model: ${model}`);
      lines.push(`thinking: ${PI_THINKING[effort]}`, "---", "", body);
      return { path: join(piDir(), "agents", `${ORCHESTRATOR}.md`), content: lines.join("\n") };
    }
  }
}

function skillPath(runtime: Runtime): string {
  const root = { claude: claudeDir(), opencode: opencodeDir(), codex: codexDir(), pi: piDir() }[
    runtime
  ];
  return join(root, "skills", SKILL_NAME, "SKILL.md");
}

function instructionsPath(runtime: Runtime): string {
  switch (runtime) {
    case "claude":
      return join(claudeDir(), "CLAUDE.md");
    case "opencode":
      return join(opencodeDir(), "AGENTS.md");
    case "codex":
      return join(codexDir(), "AGENTS.md");
    case "pi":
      return join(piDir(), "AGENTS.md");
  }
}

/** opencode.jsonc when the directory has one, else opencode.json. */
export function opencodeConfigPath(dir = opencodeDir()): string {
  const jsonc = join(dir, "opencode.jsonc");
  return existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
}

function reviewOps(runtime: Runtime, config: Config): Op[] {
  const tiers = config.tiers[runtime];
  const ops: Op[] = [];
  const base = { runtime, component: "review-models" as const };
  for (const lens of REVIEW_LENSES) {
    const { model, effort } = tiers[config.reviewTiers[lens]];
    const label = `${lens} → ${config.reviewTiers[lens]} (${model || "session model"})`;
    switch (runtime) {
      case "claude":
        if (model) {
          ops.push({
            ...base,
            kind: "frontmatter",
            path: join(claudeDir(), "agents", `${lens}.md`),
            key: "model",
            value: model,
            label,
          });
        }
        break;
      case "opencode":
        if (model) {
          ops.push({
            ...base,
            kind: "json-set",
            path: opencodeConfigPath(),
            pointer: ["agent", lens, "model"],
            value: model,
            requireParent: true,
            label,
          });
        }
        break;
      case "pi": {
        const agentPath = join(piDir(), "agents", `${lens}.md`);
        const modelsPath = join(dirname(piDir()), "gentle-ai", "models.json");
        const profilesPath = join(piDir(), "subagents.json");
        if (model) {
          ops.push(
            { ...base, kind: "frontmatter", path: agentPath, key: "model", value: model, label },
            {
              ...base,
              kind: "json-set",
              path: modelsPath,
              pointer: [lens, "model"],
              value: model,
              requireParent: true,
              label: `${label} [models.json]`,
            },
            {
              ...base,
              kind: "json-set",
              path: profilesPath,
              pointer: ["model_profiles", lens, "model"],
              value: model,
              requireParent: true,
              label: `${label} [subagents.json]`,
            },
          );
        }
        ops.push(
          {
            ...base,
            kind: "frontmatter",
            path: agentPath,
            key: "thinking",
            value: PI_THINKING[effort],
            label: `${lens} thinking → ${effort}`,
          },
          {
            ...base,
            kind: "json-set",
            path: modelsPath,
            pointer: [lens, "thinking"],
            value: PI_THINKING[effort],
            requireParent: true,
            label: `${lens} thinking → ${effort} [models.json]`,
          },
          {
            ...base,
            kind: "json-set",
            path: profilesPath,
            pointer: ["model_profiles", lens, "effort"],
            value: effort,
            requireParent: true,
            label: `${lens} effort → ${effort} [subagents.json]`,
          },
        );
        break;
      }
      case "codex":
        break;
    }
  }
  return ops;
}

/** All operations for one runtime and the selected components, in apply order. */
export function runtimeOps(runtime: Runtime, config: Config): Op[] {
  const wanted = config.components.filter((c) => RUNTIME_COMPONENTS[runtime].includes(c));
  const tiers = config.tiers[runtime];
  const ops: Op[] = [];
  if (wanted.includes("agents")) {
    for (const role of ROLES) {
      for (const tier of TIERS) {
        const { path, content } = agentFile(runtime, role, tier, tiers);
        ops.push({
          runtime,
          component: "agents",
          kind: "file",
          path,
          content,
          label: `${agentName(role, tier)} (${tiers[tier].model || `session model, ${tiers[tier].effort}`})`,
        });
      }
    }
    const { path, content } = orchestratorFile(runtime, tiers);
    ops.push({
      runtime,
      component: "agents",
      kind: "file",
      path,
      content,
      label: `${ORCHESTRATOR} (${tiers.deep.model || `session model, ${tiers.deep.effort}`})`,
    });
  }
  if (wanted.includes("skill")) {
    ops.push({
      runtime,
      component: "skill",
      kind: "file",
      path: skillPath(runtime),
      content: skillMarkdown(runtime, modelNames(runtime, tiers), config.minLines),
      label: `skill ${SKILL_NAME}`,
    });
  }
  if (wanted.includes("instructions")) {
    ops.push({
      runtime,
      component: "instructions",
      kind: "block",
      path: instructionsPath(runtime),
      content: instructionsBlock(runtime, config.minLines),
      label: "instructions block",
    });
  }
  if (wanted.includes("read-guard") && runtime === "claude") {
    const script = join(claudeDir(), "hooks", "agent-config", READ_GUARD_FILE);
    const settings = join(claudeDir(), "settings.json");
    ops.push(
      {
        runtime,
        component: "read-guard",
        kind: "file",
        path: script,
        content: readGuardSource(),
        executable: true,
        label: "read-guard hook script",
      },
      {
        runtime,
        component: "read-guard",
        kind: "json-hook",
        path: settings,
        event: "PreToolUse",
        matcher: "Read|Bash",
        command: `node "${script}"`,
        label: "PreToolUse hook (Read|Bash)",
      },
      {
        runtime,
        component: "read-guard",
        kind: "json-set",
        path: settings,
        pointer: ["env", "AGENT_CONFIG_MIN_LINES"],
        value: String(config.minLines),
        label: `env AGENT_CONFIG_MIN_LINES=${config.minLines}`,
      },
    );
  }
  if (wanted.includes("review-models")) ops.push(...reviewOps(runtime, config));
  return ops;
}
