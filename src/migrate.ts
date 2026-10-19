// One-time move from the pre-rename layout (model-ladder) to agent-config. Runs at startup,
// is a no-op once done, never overwrites anything already in the new location, and never
// stops a command: problems are returned as warnings and the current layout keeps working.

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

interface Record {
  kind: string;
  path: string;
  pointer?: string[];
  key?: string;
  command?: string;
  backup?: string;
}

function key(r: Record): string {
  return [r.kind, r.path, r.pointer?.join("/") ?? r.key ?? r.command ?? ""].join("\u0000");
}

function readRecords(manifest: string): Record[] | undefined {
  if (!existsSync(manifest)) return undefined;
  const data = JSON.parse(readFileSync(manifest, "utf8")) as { records?: Record[] };
  return Array.isArray(data.records) ? data.records : [];
}

function writeRecords(manifest: string, records: Record[]): void {
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, `${JSON.stringify({ version: 1, records }, null, 2)}\n`);
}

function removeIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Not there or not empty: leave it.
  }
}

/** Old backup paths point into the old state folder; map them to where the backups are now. */
export function resolveBackup(path: string): string {
  if (existsSync(path)) return path;
  const legacy = legacyDirs().state;
  if (!path.startsWith(`${legacy}/`)) return path;
  return statePaths().dir + path.slice(legacy.length);
}

/** Moves the old state folder, or merges it into an existing new one. */
function migrateState(moved: string[]): void {
  const legacy = legacyDirs().state;
  const state = statePaths();
  if (!existsSync(legacy)) return;
  if (!existsSync(state.dir)) {
    mkdirSync(dirname(state.dir), { recursive: true });
    renameSync(legacy, state.dir);
    moved.push(legacy);
    const records = readRecords(state.manifest);
    if (records)
      writeRecords(
        state.manifest,
        records.map((r) => ({ ...r, backup: r.backup && resolveBackup(r.backup) })),
      );
    return;
  }
  // Both exist (for example a fresh install next to an old one): merge the old records and
  // backups so everything the old install changed can still be undone.
  const legacyManifest = join(legacy, "manifest.json");
  const oldRecords = readRecords(legacyManifest) ?? [];
  const legacyBackups = join(legacy, "backups");
  if (existsSync(legacyBackups)) {
    for (const stamp of readdirSync(legacyBackups)) {
      const to = join(state.backups, stamp);
      if (existsSync(to)) continue;
      mkdirSync(state.backups, { recursive: true });
      renameSync(join(legacyBackups, stamp), to);
    }
  }
  const current = readRecords(state.manifest) ?? [];
  const known = new Set(current.map(key));
  const merged = [
    ...current,
    ...oldRecords
      .filter((r) => !known.has(key(r)))
      .map((r) => ({ ...r, backup: r.backup && resolveBackup(r.backup) })),
  ];
  writeRecords(state.manifest, merged);
  rmSync(legacyManifest, { force: true });
  removeIfEmpty(legacyBackups);
  removeIfEmpty(legacy);
  moved.push(legacy);
}

export interface MigrationResult {
  moved: string[];
  warnings: string[];
}

export function migrateLegacyLayout(): MigrationResult {
  const result: MigrationResult = { moved: [], warnings: [] };
  const legacy = legacyDirs();
  const config = dirname(configPath());
  try {
    if (existsSync(legacy.config) && !existsSync(config)) {
      mkdirSync(dirname(config), { recursive: true });
      renameSync(legacy.config, config);
      result.moved.push(legacy.config);
    }
  } catch (error) {
    result.warnings.push(`could not move ${legacy.config}: ${(error as Error).message}`);
  }
  try {
    migrateState(result.moved);
  } catch (error) {
    result.warnings.push(`could not move ${legacy.state}: ${(error as Error).message}`);
  }
  return result;
}
