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

function gitError(error: unknown): string {
  const stderr = (error as { stderr?: string | Buffer } | undefined)?.stderr?.toString().trim();
  if (stderr) return stderr.split("\n").slice(-2).join(" ");
  return error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
}

export function checkForUpdate(root = checkoutRoot()): UpdateCheck {
  const base = { ref: "", current: { version: VERSION, commit: "" }, behind: 0 };
  const refuse = (reason: string, extra: Partial<UpdateCheck> = {}): UpdateCheck => ({
    ...base,
    ...extra,
    updatable: false,
    reason,
  });
  if (!existsSync(join(root, ".git")))
    return refuse("not a git checkout; re-run the install one-liner");
  if (!samePath(root, installHome())) {
    return refuse(
      `running from ${root}, not the installed copy (${installHome()}); use git pull here`,
    );
  }
  let ref: string;
  let current: UpdateCheck["current"];
  try {
    ref = git(root, "rev-parse", "--abbrev-ref", "HEAD");
    current = { version: VERSION, commit: git(root, "rev-parse", "--short", "HEAD") };
  } catch (error) {
    return refuse(`cannot read the installed checkout: ${gitError(error)}`);
  }
  if (ref === "HEAD") {
    return refuse(
      "the installed copy is pinned to a fixed commit or tag (detached HEAD); re-run the installer with MODEL_LADDER_REF=<branch> to follow a branch",
      { current },
    );
  }
  try {
    git(root, "fetch", "--quiet", "origin", ref);
  } catch (error) {
    return refuse(`could not fetch origin/${ref}: ${gitError(error)}`, { ref, current });
  }
  try {
    const behind = Number(git(root, "rev-list", "--count", `HEAD..origin/${ref}`)) || 0;
    let version = current.version;
    try {
      version = JSON.parse(git(root, "show", `origin/${ref}:package.json`)).version ?? version;
    } catch {
      // Keep the current version label when the remote package.json cannot be read.
    }
    const latest = { version, commit: git(root, "rev-parse", "--short", `origin/${ref}`) };
    return { updatable: true, ref, current, latest, behind };
  } catch (error) {
    return refuse(`cannot compare with origin/${ref}: ${gitError(error)}`, { ref, current });
  }
}

export interface UpdateResult {
  ok: boolean;
  /** What happened, in one sentence for the user. */
  message: string;
  /** The installer's messages (its stderr), for showing on failure. */
  log: string;
  commit?: string;
}

const ENTRY = join("dist", "cli.mjs");

function runs(root: string): boolean {
  return (
    spawnSync(process.execPath, [join(root, ENTRY), "--version"], {
      stdio: "ignore",
      timeout: 30_000,
    }).status === 0
  );
}

export function runUpdate(check: UpdateCheck, root = checkoutRoot()): UpdateResult {
  const before = check.current.commit;
  const res = spawnSync("bash", [join(root, "install.sh")], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    // Generous: git and the installer bound their own work. A kill is reported truthfully below.
    timeout: 900_000,
    env: {
      ...process.env,
      // The path as configured (checkForUpdate verified it is this checkout), not its realpath.
      MODEL_LADDER_HOME: installHome(),
      MODEL_LADDER_REF: check.ref,
      MODEL_LADDER_NO_RUN: "1",
      NO_COLOR: "1",
    },
  });
  const log = res.stderr ?? "";
  let after = "";
  try {
    after = git(root, "rev-parse", "--short", "HEAD");
  } catch {
    // Reported below as an inconsistent install.
  }
  if (res.status === 0) {
    return {
      ok: true,
      message: `Updated to v${check.latest?.version} (${after})`,
      log,
      commit: after,
    };
  }
  const killed = res.error || res.signal ? " (the installer was interrupted)" : "";
  // Only claim the previous version is installed when that is what is on disk and it runs.
  if (after === before && runs(root)) {
    return {
      ok: false,
      message: `Update failed${killed}; the previous version is still installed.`,
      log,
    };
  }
  return {
    ok: false,
    message: `Update failed${killed} and the installed copy may be inconsistent (at ${after || "an unknown commit"}); re-run the install one-liner to repair it.`,
    log,
  };
}

/** Re-applies the saved configuration with the freshly installed CLI (new prompts and agents). */
export function reapplyWithNewVersion(root = checkoutRoot()): number {
  const res = spawnSync(process.execPath, [join(root, ENTRY), "install", "--yes"], {
    stdio: "inherit",
  });
  return res.status ?? 1;
}
