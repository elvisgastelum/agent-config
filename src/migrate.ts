// One-time move from the pre-rename layout (model-ladder) to agent-config. Runs at startup,
// is a no-op once done, and never overwrites anything already in the new location.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, legacyDirs, statePaths } from "./paths.ts";

function move(from: string, to: string): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

/** Returns what was moved, for one line of output; empty when there was nothing to do. */
export function migrateLegacyLayout(): string[] {
  const legacy = legacyDirs();
  const state = statePaths();
  const moved: string[] = [];
  if (move(legacy.config, dirname(configPath()))) moved.push(legacy.config);
  if (move(legacy.state, state.dir)) {
    moved.push(legacy.state);
    // Backup paths recorded in the manifest point into the old state folder.
    try {
      const manifest = JSON.parse(readFileSync(state.manifest, "utf8")) as {
        records?: { backup?: string }[];
      };
      for (const r of manifest.records ?? []) {
        if (r.backup?.startsWith(`${legacy.state}/`)) {
          r.backup = state.dir + r.backup.slice(legacy.state.length);
        }
      }
      writeFileSync(state.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch {
      // No manifest yet: nothing to rewrite.
    }
  }
  return moved;
}
