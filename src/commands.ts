// Shared logic behind both the TUI and the non-interactive CLI.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogItem,
  catalogOps,
  entryKey,
  forgetCatalog,
  ladderRuntimes,
  missingProjects,
  parseEntryKey,
} from "./catalog.ts";
import { loadConfig, saveConfig, type Config } from "./config.ts";
import {
  applyPlan,
  type ApplyResult,
  loadManifest,
  opKey,
  planOp,
  planRemoval,
  LADDER_ITEM,
  LADDER_KEY,
  recordKey,
  recordState,
  type ManifestRecord,
  type PlannedOp,
  type RecordState,
  type UndoResult,
  uninstall,
} from "./ops.ts";
import { codexDir, home, piDir, RUNTIME_BIN, runtimeDir } from "./paths.ts";
import { defaultInstallHome, legacyInstallHome } from "./selfupdate.ts";
import { RUNTIMES, type Runtime } from "./tiers.ts";
import { VERSION } from "./version.ts";

/** The user cancelled a prompt (Ctrl+C); the CLI exits 130. */
export class Cancelled extends Error {}

export function onPath(bin: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface Detection {
  runtime: Runtime;
  bin: boolean;
  dir: boolean;
}

export function detect(): Detection[] {
  return RUNTIMES.map((runtime) => ({
    runtime,
    bin: onPath(RUNTIME_BIN[runtime]),
    dir: existsSync(runtimeDir(runtime)),
  }));
}

export function detectedRuntimes(): Runtime[] {
  return detect()
    .filter((d) => d.bin || d.dir)
    .map((d) => d.runtime);
}

/**
 * Plans every saved catalog entry, or with `only` just those (keys such as "kaneo@user" or
 * "model-ladder@user"), leaving the other entries alone.
 */
export function buildPlan(config: Config, only?: string[]): PlannedOp[] {
  const manifest = loadManifest().records;
  const records = new Map(manifest.map((r) => [recordKey(r), r]));
  const ops = catalogOps(config, only);
  const wanted = new Set(ops.map(opKey));
  // Entries whose project directory is gone are neither applied nor cleaned up from here.
  const missing = new Set(missingProjects(config).map(entryKey));
  const planned = new Set((only ?? config.catalog.map(entryKey)).filter((k) => !missing.has(k)));
  const ladder = ladderRuntimes(config);
  // A full re-apply also undoes what a catalog item this version does not have installed (such
  // as plans-mcp from 0.12.0-0.14.0), since nothing can produce it any more. A project whose
  // directory is gone is left alone, as above.
  const retired = (key: string) => {
    const { item, project } = parseEntryKey(key);
    return !catalogItem(item) && (project === undefined || existsSync(project));
  };
  // Installed parts of the planned entries that the configuration no longer produces (a moved
  // hook, a renamed setting, a runtime dropped from a catalog entry) are undone, so nothing
  // stale stays behind. Ladder parts or runtimes that were deselected are left alone.
  const stale = manifest
    .filter(
      (r) =>
        r.item !== undefined &&
        (planned.has(r.item) || (!only && retired(r.item))) &&
        !wanted.has(recordKey(r)) &&
        (r.item !== LADDER_KEY ||
          (ladder.includes(r.runtime) && (config.components as string[]).includes(r.component))),
    )
    .map(planRemoval);
  return [...stale, ...ops.map((op) => planOp(op, records.get(opKey(op))))];
}

/**
 * After uninstalling some runtimes, puts back catalog files the remaining runtimes still use: a
 * project's AGENTS.md block is shared by OpenCode, Codex and Pi but recorded under one of them.
 */
export function restoreShared(config: Config, removed: string[]): ApplyResult["errors"] {
  const paths = new Set(removed);
  const plan = buildPlan(config, config.catalog.map(entryKey));
  // A block stripped from a file that stays (a project's own AGENTS.md) plans as an update.
  const back = plan.filter(
    (x) => (x.action === "create" || x.action === "update") && paths.has(x.op.path),
  );
  return applyPlan(back).errors;
}

export interface UninstallOutcome {
  results: UndoResult[];
  /** Shared files the remaining runtimes need that could not be put back. */
  restoreErrors: ApplyResult["errors"];
}

/**
 * Undoes what agent-config installed, limited to one catalog entry (`key`) and/or some runtimes,
 * then updates the saved configuration so `install` does not bring it back. An entry whose files
 * were kept because the user changed them stays saved, so a later `--force` run can remove them.
 */
export function uninstallSelection(
  selection: { key?: string; runtimes: string[] },
  force = false,
): UninstallOutcome {
  const { key, runtimes } = selection;
  const results = uninstall(
    (r) =>
      (key === undefined || r.item === key) &&
      (runtimes.length === 0 || runtimes.includes(r.runtime)),
    force,
  );
  const kept = new Set(
    results.filter((r) => r.outcome === "kept-modified").map((r) => r.record.item),
  );
  const config = loadConfig();
  // The ladder forgets its runtimes even when it kept edited files, as it did before it became a
  // catalog item: its kept files stay in the manifest for `--force`, and `restoreShared` must not
  // put the removed ones back.
  forgetCatalog(
    config,
    (e) =>
      (key === undefined || entryKey(e) === key) &&
      (e.item === LADDER_ITEM || !kept.has(entryKey(e))),
    runtimes,
  );
  saveConfig(config);
  // Only a partial uninstall can leave other runtimes needing a file it removed.
  const removed = results.filter((r) => r.outcome !== "kept-modified").map((r) => r.record.path);
  const restoreErrors = runtimes.length > 0 ? restoreShared(config, removed) : [];
  return { results, restoreErrors };
}

export function tildify(path: string): string {
  const h = home();
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

export interface StatusEntry {
  record: ManifestRecord;
  state: RecordState;
}

export function status(): StatusEntry[] {
  return loadManifest().records.map((record) => ({ record, state: recordState(record) }));
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function doctor(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push({
    name: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 22,
    detail: process.version,
  });
  for (const d of detect()) {
    checks.push({
      name: d.runtime,
      ok: d.bin || d.dir,
      detail:
        d.bin || d.dir
          ? `${d.bin ? "cli on PATH" : "cli not on PATH"}, ${tildify(runtimeDir(d.runtime))}`
          : "not installed",
    });
  }
  const codexConfig = join(codexDir(), "config.toml");
  if (existsSync(codexConfig)) {
    const text = readFileSync(codexConfig, "utf8");
    const enabled = /^\s*multi_agent\s*=\s*true/m.test(text);
    checks.push({
      name: "codex multi_agent",
      ok: enabled,
      detail: enabled
        ? "enabled"
        : "add `multi_agent = true` under [features] in ~/.codex/config.toml so Codex can spawn ladder agents",
    });
  }
  if (existsSync(piDir())) {
    const settings = join(piDir(), "settings.json");
    const text = existsSync(settings) ? readFileSync(settings, "utf8") : "";
    const subagents =
      /subagent|gentle-pi/.test(text) || existsSync(join(piDir(), "subagents.json"));
    checks.push({
      name: "pi subagents",
      ok: subagents,
      detail: subagents
        ? "subagent support found"
        : "install a Pi subagent extension (for example gentle-pi) so Pi can call ladder agents",
    });
  }
  if (existsSync(legacyInstallHome())) {
    checks.push({
      name: "install location",
      ok: false,
      detail: `${tildify(legacyInstallHome())} is the pre-rename location; run \`agent-config self-update\` or the install one-liner to move it to ${tildify(defaultInstallHome())}`,
    });
  }
  const gentle = onPath("gentle-ai");
  checks.push({
    name: "gentle-ai",
    ok: true,
    detail: gentle ? "installed (review-models applies)" : "not installed (review-models skips)",
  });
  const installed = status();
  const drifted = installed.filter((s) => s.state !== "ok");
  checks.push({
    name: "managed files",
    ok: drifted.length === 0,
    detail:
      drifted.length === 0
        ? "all as installed"
        : `${drifted.length} changed or missing (often \`gentle-ai sync\` resetting review models); run \`agent-config install\` to reapply`,
  });
  const others = installed.filter((s) => s.record.version !== VERSION);
  const versions = [...new Set(others.map((s) => s.record.version ?? "unrecorded"))].sort();
  checks.push({
    name: "installed version",
    ok: others.length === 0,
    detail:
      others.length === 0
        ? `all at ${VERSION}`
        : `${others.length} installed by another version (${versions.join(", ")}); run \`agent-config install\` to bring them to ${VERSION}`,
  });
  return checks;
}
