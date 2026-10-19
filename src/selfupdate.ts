// Updates model-ladder itself. The installed copy is a git checkout; updating reuses its
// install.sh, which pulls, checks the new dist runs, and rolls back when it does not.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { home } from "./paths.ts";
import { VERSION } from "./version.ts";

/** The checkout this CLI runs from (dist/cli.mjs and src/selfupdate.ts sit one level below). */
export function checkoutRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function installHome(): string {
  return process.env.MODEL_LADDER_HOME || join(home(), ".local", "share", "model-ladder");
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export interface UpdateCheck {
  /** False when this copy cannot update itself; `reason` says why. */
  updatable: boolean;
  reason?: string;
  ref: string;
  current: { version: string; commit: string };
  latest?: { version: string; commit: string };
  /** Commits on the remote that this copy does not have. */
  behind: number;
}

export function checkForUpdate(root = checkoutRoot()): UpdateCheck {
  const base = { ref: "", current: { version: VERSION, commit: "" }, behind: 0 };
  if (!existsSync(join(root, ".git"))) {
    return {
      ...base,
      updatable: false,
      reason: "not a git checkout; re-run the install one-liner",
    };
  }
  if (!samePath(root, installHome())) {
    return {
      ...base,
      updatable: false,
      reason: `running from ${root}, not the installed copy (${installHome()}); use git pull here`,
    };
  }
  const ref = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const current = { version: VERSION, commit: git(root, "rev-parse", "--short", "HEAD") };
  try {
    git(root, "fetch", "--quiet", "origin", ref);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { ...base, ref, current, updatable: false, reason: `could not reach origin: ${detail}` };
  }
  const behind = Number(git(root, "rev-list", "--count", `HEAD..origin/${ref}`)) || 0;
  let version = current.version;
  try {
    version = JSON.parse(git(root, "show", `origin/${ref}:package.json`)).version ?? version;
  } catch {
    // Keep the current version label when the remote package.json cannot be read.
  }
  const latest = { version, commit: git(root, "rev-parse", "--short", `origin/${ref}`) };
  return { updatable: true, ref, current, latest, behind };
}

export interface UpdateResult {
  ok: boolean;
  /** The installer's messages (its stderr), for showing on failure. */
  log: string;
  commit?: string;
}

export function runUpdate(check: UpdateCheck, root = checkoutRoot()): UpdateResult {
  const res = spawnSync("bash", [join(root, "install.sh")], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 300_000,
    env: {
      ...process.env,
      // The path as configured (checkForUpdate verified it is this checkout), not its realpath.
      MODEL_LADDER_HOME: installHome(),
      MODEL_LADDER_REF: check.ref,
      MODEL_LADDER_NO_RUN: "1",
      NO_COLOR: "1",
    },
  });
  const ok = res.status === 0;
  return {
    ok,
    log: res.stderr ?? "",
    ...(ok ? { commit: git(root, "rev-parse", "--short", "HEAD") } : {}),
  };
}

/** Re-applies the saved configuration with the freshly installed CLI (new prompts and agents). */
export function reapplyWithNewVersion(root = checkoutRoot()): number {
  const res = spawnSync("node", [join(root, "dist", "cli.mjs"), "install", "--yes"], {
    stdio: "inherit",
  });
  return res.status ?? 1;
}
