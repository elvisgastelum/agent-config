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
  const data = JSON.parse(readFileSync(path, "utf8")) as ManifestFile;
  // Same rule as the main loader: records that are not a list count as none.
  return { ...data, records: Array.isArray(data.records) ? data.records : [] };
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

interface Move {
  from: string;
  to: string;
}

/**
 * Where each old backup stamp goes, renamed when the new folder already has that stamp.
 * Saved to a journal before anything moves, so an interrupted merge resumes with the same
 * names instead of guessing: a renamed stamp must never be confused with the newer install's.
 */
function planMoves(legacy: string): Move[] {
  const journal = join(legacy, "migration.json");
  if (existsSync(journal))
    return (JSON.parse(readFileSync(journal, "utf8")) as { moves: Move[] }).moves;
  const state = statePaths();
  const legacyBackups = join(legacy, "backups");
  const taken = new Set<string>();
  const moves: Move[] = [];
  for (const stamp of existsSync(legacyBackups) ? readdirSync(legacyBackups) : []) {
    let to = join(state.backups, stamp);
    for (let i = 2; existsSync(to) || taken.has(to); i++) to = join(state.backups, `${stamp}-${i}`);
    taken.add(to);
    moves.push({ from: join(legacyBackups, stamp), to });
  }
  writeFileSync(journal, `${JSON.stringify({ moves }, null, 2)}\n`);
  return moves;
}

/** Merges an old state folder into an existing new one and removes the old one. */
function mergeState(legacy: string, warnings: string[]): void {
  const state = statePaths();
  const legacyManifest = join(legacy, "manifest.json");
  const old = readManifest(legacyManifest);
  const current = readManifest(state.manifest);

  const moves = planMoves(legacy);
  for (const { from, to } of moves) {
    // Already moved by an earlier, interrupted run.
    if (!existsSync(from) && existsSync(to)) continue;
    mkdirSync(state.backups, { recursive: true });
    renameSync(from, to);
  }
  const relocate = (backup: string | undefined): string | undefined => {
    if (!backup) return backup;
    for (const { from, to } of moves)
      if (backup.startsWith(`${from}/`)) return to + backup.slice(from.length);
    return backup;
  };

  // Every old record is kept; the first one for a target the new install also manages lends
  // that record its originals, the rest are added as they are.
  const older = (old?.records ?? []).map((r) => ({ ...r, backup: relocate(r.backup) }));
  const firstByKey = new Map<string, Rec>();
  for (const r of older) if (!firstByKey.has(key(r))) firstByKey.set(key(r), r);
  const used = new Set<Rec>();
  const records = (current?.records ?? []).map((r) => {
    const match = firstByKey.get(key(r));
    if (!match || used.has(match)) return r;
    used.add(match);
    return withOriginal(r, match);
  });
  // A resumed merge may find these already written; never add the same record twice.
  const present = new Set(records.map((r) => JSON.stringify(r)));
  const added = older.filter((r) => !used.has(r) && !present.has(JSON.stringify(r)));
  writeManifest(state.manifest, current, [...records, ...added]);

  rmSync(legacyManifest, { force: true });
  rmSync(join(legacy, "migration.json"), { force: true });
  try {
    rmdirSync(join(legacy, "backups"));
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
