// Every location model-ladder reads or writes, resolved from HOME and XDG variables at
// call time so tests (and CLAUDE_CONFIG_DIR users) can point it elsewhere.

import { join } from "node:path";
import { homedir } from "node:os";
import type { Runtime } from "./tiers.ts";

export function home(): string {
  return process.env.HOME || homedir();
}

export function statePaths(): { dir: string; manifest: string; backups: string } {
  const dir = join(process.env.XDG_STATE_HOME || join(home(), ".local", "state"), "model-ladder");
  return { dir, manifest: join(dir, "manifest.json"), backups: join(dir, "backups") };
}

export function configPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(home(), ".config"),
    "model-ladder",
    "config.json",
  );
}

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
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
