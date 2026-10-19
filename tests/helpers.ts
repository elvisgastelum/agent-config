import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const VARS = [
  "HOME",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "PI_CODING_AGENT_DIR",
];

/** Points every path agent-config resolves at a fresh temporary HOME. */
export function sandbox(): { home: string; restore: () => void } {
  const saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  const home = mkdtempSync(join(tmpdir(), "model-ladder-test-"));
  for (const v of VARS) delete process.env[v];
  process.env.HOME = home;
  return {
    home,
    restore: () => {
      for (const v of VARS) {
        if (saved[v] === undefined) delete process.env[v];
        else process.env[v] = saved[v];
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}
