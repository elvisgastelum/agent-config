// Every location agent-config reads or writes, resolved from HOME and XDG variables at
// call time so tests (and CLAUDE_CONFIG_DIR users) can point it elsewhere.

import { join } from "node:path";
import { homedir } from "node:os";
import type { Runtime } from "./tiers.ts";

export function home(): string {
  return process.env.HOME || homedir();
}

/** The tool's name before it was renamed to agent-config; still read for compatibility. */
export const LEGACY_NAME = "model-ladder";

/** Reads AGENT_CONFIG_<name>, falling back to the pre-rename MODEL_LADDER_<name>. */
export function setting(name: string): string | undefined {
  return process.env[`AGENT_CONFIG_${name}`] || process.env[`MODEL_LADDER_${name}`] || undefined;
}

function stateRoot(): string {
  return process.env.XDG_STATE_HOME || join(home(), ".local", "state");
}

function configRoot(): string {
  return process.env.XDG_CONFIG_HOME || join(home(), ".config");
}

export function statePaths(): { dir: string; manifest: string; backups: string } {
  const dir = join(stateRoot(), "agent-config");
  return { dir, manifest: join(dir, "manifest.json"), backups: join(dir, "backups") };
}

/** Where the brief action leaves the briefs it writes. */
export function briefsDir(): string {
  return join(statePaths().dir, "briefs");
}

export function configPath(): string {
  return join(configRoot(), "agent-config", "config.json");
}

/** Where the pre-rename tool kept its state and configuration. */
export function legacyDirs(): { state: string; config: string } {
  return { state: join(stateRoot(), LEGACY_NAME), config: join(configRoot(), LEGACY_NAME) };
}

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
}

/** Claude Code's user-scope MCP servers live in .claude.json, beside (not inside) ~/.claude. */
export function claudeJsonPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  return dir ? join(dir, ".claude.json") : join(home(), ".claude.json");
}

export function opencodeDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "opencode");
}

export function codexDir(): string {
  return process.env.CODEX_HOME || join(home(), ".codex");
}

export function piDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(home(), ".pi", "agent");
}

/** The directory whose presence means the runtime is set up on this machine. */
export function runtimeDir(runtime: Runtime): string {
  switch (runtime) {
    case "claude":
      return claudeDir();
    case "opencode":
      return opencodeDir();
    case "codex":
      return codexDir();
    case "pi":
      return piDir();
  }
}

/** The runtime's CLI binary, used only to report whether it is installed. */
export const RUNTIME_BIN: Record<Runtime, string> = {
  claude: "claude",
  opencode: "opencode",
  codex: "codex",
  pi: "pi",
};
