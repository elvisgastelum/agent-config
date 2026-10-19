import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

// A fake GitHub origin holding the shipped files, and an installed clone under a temp HOME.
const repo = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "model-ladder-update-"));
const origin = join(root, "origin");
const home = join(root, "home");
const installed = join(home, ".local", "share", "model-ladder");
const gitEnv = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...gitEnv },
  }).trim();
}

function commitToOrigin(message: string, change: () => void): void {
  change();
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", message);
}

function cli(entry: string, ...args: string[]) {
  return cliIn({}, entry, ...args);
}

function cliIn(extra: Record<string, string>, entry: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1", ...extra },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const installedCli = join(installed, "dist", "cli.mjs");
let firstCommit = "";

beforeAll(() => {
  mkdirSync(origin, { recursive: true });
  for (const f of ["dist", "assets", "package.json", "install.sh"]) {
    cpSync(join(repo, f), join(origin, f), { recursive: true });
  }
  git(origin, "init", "-q", "-b", "main");
  commitToOrigin("v1", () => {});
  firstCommit = git(origin, "rev-parse", "HEAD");
  mkdirSync(join(home, ".local", "share"), { recursive: true });
  git(root, "clone", "-q", origin, installed);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("reports up to date when origin has nothing new", () => {
  const res = cli(installedCli, "self-update", "--dry-run", "--json");
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout).check).toMatchObject({ updatable: true, behind: 0 });
});

test("pulls a newer version and rewrites the command", () => {
  commitToOrigin("v9.9.9", () => {
    const pkg = JSON.parse(readFileSync(join(origin, "package.json"), "utf8"));
    writeFileSync(
      join(origin, "package.json"),
      `${JSON.stringify({ ...pkg, version: "9.9.9" }, null, 2)}\n`,
    );
  });
  const check = JSON.parse(cli(installedCli, "self-update", "--dry-run", "--json").stdout).check;
  expect(check).toMatchObject({ behind: 1, latest: { version: "9.9.9" } });

  const refused = cli(installedCli, "self-update");
  expect(refused.code).toBe(2);
  expect(refused.stderr).toContain("refusing to update without --yes outside a terminal");

  const res = cli(installedCli, "self-update", "--yes", "--json");
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout).updated).toBe(true);
  expect(git(installed, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "HEAD"));
  const wrapper = readFileSync(join(home, ".local", "bin", "model-ladder"), "utf8");
  expect(wrapper).toContain(`export MODEL_LADDER_HOME='${installed}'`);
});

test("rolls back when the new version does not run", () => {
  const before = git(installed, "rev-parse", "HEAD");
  commitToOrigin("broken", () =>
    writeFileSync(join(origin, "dist", "cli.mjs"), "process.exit(1);\n"),
  );
  const res = cli(installedCli, "self-update", "--yes");
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("previous version is still installed");
  expect(git(installed, "rev-parse", "HEAD")).toBe(before);
});

function cloneTo(name: string): string {
  const target = join(root, name);
  git(root, "clone", "-q", origin, target);
  // Later tests commit a broken dist to the origin; start from the first, working version.
  git(target, "reset", "-q", "--hard", firstCommit);
  return target;
}

test("refuses to update a checkout that is not the installed copy", () => {
  // A git checkout too, just not the one MODEL_LADDER_HOME points at.
  const res = cli(join(cloneTo("dev"), "dist", "cli.mjs"), "self-update", "--dry-run", "--json");
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).check.reason).toContain("not the installed copy");
});

test("reports an unreachable origin with git's own reason", () => {
  const copy = cloneTo("offline");
  git(copy, "remote", "set-url", "origin", join(root, "does-not-exist"));
  const res = cliIn(
    { MODEL_LADDER_HOME: copy },
    join(copy, "dist", "cli.mjs"),
    "self-update",
    "--dry-run",
    "--json",
  );
  expect(res.code).toBe(1);
  const reason = JSON.parse(res.stdout).check.reason as string;
  expect(reason).toContain("could not fetch origin/main");
  expect(reason).not.toContain("Command failed");
});

test("explains a copy pinned to a fixed commit instead of fetching a branch called HEAD", () => {
  const copy = cloneTo("pinned");
  git(copy, "checkout", "-q", "--detach");
  const res = cliIn(
    { MODEL_LADDER_HOME: copy },
    join(copy, "dist", "cli.mjs"),
    "self-update",
    "--dry-run",
    "--json",
  );
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).check.reason).toContain("detached HEAD");
});
