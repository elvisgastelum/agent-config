// Shared logic behind both the TUI and the non-interactive CLI.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogOps, entryKey } from "./catalog.ts";
import type { Config } from "./config.ts";
import {
  applyPlan,
  type ApplyResult,
  loadManifest,
  opKey,
  planOp,
  planRemoval,
  recordKey,
  recordState,
  type ManifestRecord,
  type PlannedOp,
  type RecordState,
} from "./ops.ts";
import { codexDir, home, piDir, RUNTIME_BIN, runtimeDir } from "./paths.ts";
import { allOps } from "./runtimes.ts";
import { defaultInstallHome, legacyInstallHome } from "./selfupdate.ts";
import { RUNTIMES, type Runtime } from "./tiers.ts";

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
 * Plans the whole saved configuration, or with `only` just those catalog entries (keys such as
 * "kaneo@user"), leaving the ladder and other entries alone.
 */
export function buildPlan(config: Config, only?: string[]): PlannedOp[] {
  const manifest = loadManifest().records;
  const records = new Map(manifest.map((r) => [recordKey(r), r]));
  const ladder = only ? [] : allOps(config);
  const catalog = catalogOps(config, only);
  const ops = [...ladder, ...catalog];
  const wanted = new Set(ops.map(opKey));
  const planned = new Set(only ?? config.catalog.map(entryKey));
  // Installed items of the selected runtimes and parts that the configuration no longer
  // produces (a moved hook, a renamed setting, a runtime dropped from a catalog entry) are
  // undone, so nothing stale stays behind. Parts that were not selected are left alone.
  const stale = manifest
    .filter((r) =>
      r.component === "catalog"
        ? r.item !== undefined && planned.has(r.item) && !wanted.has(recordKey(r))
        : !only &&
          config.runtimes.includes(r.runtime) &&
          config.components.includes(r.component) &&
          !wanted.has(recordKey(r)),
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
  return applyPlan(plan.filter((x) => x.action === "create" && paths.has(x.op.path))).errors;
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
  const drifted = status().filter((s) => s.state !== "ok");
  checks.push({
    name: "managed files",
    ok: drifted.length === 0,
    detail:
      drifted.length === 0
        ? "all as installed"
        : `${drifted.length} changed or missing (often \`gentle-ai sync\` resetting review models); run \`agent-config install\` to reapply`,
  });
  return checks;
}
