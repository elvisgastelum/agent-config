// One-time move from the pre-rename layout (model-ladder) to agent-config. Runs at startup,
// is a no-op once done (the old state folder never survives a run), never overwrites
// anything already in the new location, and never stops a command: problems are returned as
// warnings and the current layout keeps working.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { configPath, legacyDirs, statePaths } from "./paths.ts";

type Rec = Record<string, unknown> & {
  kind: string;
  path: string;
  pointer?: string[];
  key?: string;
  command?: string;
  backup?: string;
};

interface ManifestFile {
  records?: Rec[];
  [field: string]: unknown;
}

/** The fields that describe what was there before any install touched the target. */
const ORIGINAL_FIELDS = [
  "backup",
  "createdFile",
  "createdDirs",
  "trailingNewline",
  "prev",
  "existingDepth",
  "hookCreated",
] as const;

function key(r: Rec): string {
  return [r.kind, r.path, r.pointer?.join("/") ?? r.key ?? r.command ?? ""].join("\u0000");
}

function readManifest(path: string): ManifestFile | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ManifestFile;
}

/** Writes the records back, keeping every other top-level field of the manifest. */
function writeManifest(path: string, base: ManifestFile | undefined, records: Rec[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, ...base, records }, null, 2)}\n`);
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  for (let i = 2; ; i++) if (!existsSync(`${path}-${i}`)) return `${path}-${i}`;
}

/** Old backup paths point into the old state folder; map them to where the backups are now. */
export function resolveBackup(path: string): string {
  if (existsSync(path)) return path;
  const legacy = legacyDirs().state;
  if (!path.startsWith(`${legacy}/`)) return path;
  return statePaths().dir + path.slice(legacy.length);
}

/**
 * Both installs managed the same target: keep the current record, but with what the older
 * install saw before it touched the target, since that is the user's original.
 */
function withOriginal(current: Rec, older: Rec): Rec {
  const merged: Record<string, unknown> = { ...current };
  for (const field of ORIGINAL_FIELDS) {
    if (field in older) merged[field] = older[field];
    else delete merged[field];
  }
  return merged as Rec;
}

/** Merges an old state folder into an existing new one and removes the old one. */
function mergeState(legacy: string, warnings: string[]): void {
  const state = statePaths();
  const legacyManifest = join(legacy, "manifest.json");
  const old = readManifest(legacyManifest);
  const current = readManifest(state.manifest);

  // Move each old backup stamp, renaming it when the new folder already has that stamp.
  const moves = new Map<string, string>();
  const legacyBackups = join(legacy, "backups");
  if (existsSync(legacyBackups)) {
    for (const stamp of readdirSync(legacyBackups)) {
      const to = uniquePath(join(state.backups, stamp));
      mkdirSync(state.backups, { recursive: true });
      renameSync(join(legacyBackups, stamp), to);
      moves.set(join(legacyBackups, stamp), to);
    }
  }
  const relocate = (backup: string | undefined): string | undefined => {
    if (!backup) return backup;
    for (const [from, to] of moves)
      if (backup.startsWith(`${from}/`)) return to + backup.slice(from.length);
    return backup;
  };

  const olderByKey = new Map(
    (old?.records ?? []).map((r) => [key(r), { ...r, backup: relocate(r.backup) }]),
  );
  const records = (current?.records ?? []).map((r) => {
    const older = olderByKey.get(key(r));
    if (!older) return r;
    olderByKey.delete(key(r));
    return withOriginal(r, older);
  });
  writeManifest(state.manifest, current, [...records, ...olderByKey.values()]);

  rmSync(legacyManifest, { force: true });
  try {
    rmdirSync(legacyBackups);
  } catch {
    // Already gone.
  }
  // Anything else in the old folder is kept, but out of the way, so this runs only once.
  const leftovers = existsSync(legacy) ? readdirSync(legacy) : [];
  if (leftovers.length > 0) {
    const aside = uniquePath(join(state.dir, "model-ladder-leftovers"));
    renameSync(legacy, aside);
    warnings.push(`kept unrecognized files from ${legacy} in ${aside}`);
  } else if (existsSync(legacy)) {
    rmdirSync(legacy);
  }
}

export interface MigrationResult {
  moved: string[];
  warnings: string[];
}

export function migrateLegacyLayout(): MigrationResult {
  const result: MigrationResult = { moved: [], warnings: [] };
  const legacy = legacyDirs();
  const config = dirname(configPath());
  const state = statePaths();
  try {
    if (existsSync(legacy.config) && !existsSync(config)) {
      mkdirSync(dirname(config), { recursive: true });
      renameSync(legacy.config, config);
      result.moved.push(legacy.config);
    }
  } catch (error) {
    result.warnings.push(`could not move ${legacy.config}: ${(error as Error).message}`);
  }
  if (!existsSync(legacy.state)) return result;
  if (!existsSync(state.dir)) {
    try {
      mkdirSync(dirname(state.dir), { recursive: true });
      renameSync(legacy.state, state.dir);
    } catch (error) {
      result.warnings.push(`could not move ${legacy.state}: ${(error as Error).message}`);
      return result;
    }
    result.moved.push(legacy.state);
    // The move is done; updating backup paths is a convenience (they also resolve when used).
    try {
      const manifest = readManifest(state.manifest);
      if (manifest) {
        const records = (manifest.records ?? []).map((r) => ({
          ...r,
          backup: r.backup && resolveBackup(r.backup),
        }));
        writeManifest(state.manifest, manifest, records);
      }
    } catch (error) {
      result.warnings.push(
        `moved ${legacy.state}, but could not update the backup paths in its manifest (${(error as Error).message}); they are resolved when used`,
      );
    }
    return result;
  }
  try {
    mergeState(legacy.state, result.warnings);
    result.moved.push(legacy.state);
  } catch (error) {
    result.warnings.push(`could not merge ${legacy.state}: ${(error as Error).message}`);
  }
  return result;
}
