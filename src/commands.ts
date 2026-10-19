// Shared logic behind both the TUI and the non-interactive CLI.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import {
  loadManifest,
  planOp,
  recordState,
  type ManifestRecord,
  type PlannedOp,
  type RecordState,
} from "./ops.ts";
import { codexDir, home, piDir, RUNTIME_BIN, runtimeDir } from "./paths.ts";
import { allOps } from "./runtimes.ts";
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

export function buildPlan(config: Config): PlannedOp[] {
  return allOps(config).map((op) => planOp(op));
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
        : `${drifted.length} changed or missing (often \`gentle-ai sync\` resetting review models); run \`model-ladder install\` to reapply`,
  });
  return checks;
}
