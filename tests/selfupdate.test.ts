import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

// A fake GitHub origin holding the shipped files, and an installed clone under a temp HOME.
const repo = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "model-ladder-update-"));
const origin = join(root, "origin");
const home = join(root, "home");
const installed = join(home, ".local", "share", "agent-config");
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

test("update is the same command as self-update", () => {
  const update = cli(installedCli, "update", "--dry-run", "--json");
  expect(update.code).toBe(0);
  expect(update.stdout).toBe(cli(installedCli, "self-update", "--dry-run", "--json").stdout);
});

test("u is the same command as self-update", () => {
  const update = cli(installedCli, "u", "--dry-run", "--json");
  expect(update.code).toBe(0);
  expect(update.stdout).toBe(cli(installedCli, "self-update", "--dry-run", "--json").stdout);
});

// A pre-rename install: the same checkout under ~/.local/share/model-ladder.
function legacyHome(name: string): { home: string; legacy: string } {
  const h = join(root, name);
  const legacy = join(h, ".local", "share", "model-ladder");
  mkdirSync(join(h, ".local", "share"), { recursive: true });
  git(root, "clone", "-q", origin, legacy);
  return { home: h, legacy };
}

test("install.sh moves a pre-rename install and adds both commands", () => {
  const { home: h, legacy } = legacyHome("legacy-installer");
  const res = spawnSync("bash", [join(legacy, "install.sh")], {
    env: { PATH: process.env.PATH, HOME: h, AGENT_CONFIG_NO_RUN: "1", NO_COLOR: "1" },
    encoding: "utf8",
  });
  expect(res.status).toBe(0);
  expect(res.stderr).toContain("model-ladder is now agent-config");
  const moved = join(h, ".local", "share", "agent-config");
  expect(existsSync(legacy)).toBe(false);
  expect(git(moved, "remote", "get-url", "origin")).toBe(origin);
  for (const name of ["agent-config", "model-ladder"]) {
    const bin = join(h, ".local", "bin", name);
    expect(readFileSync(bin, "utf8")).toContain(`export AGENT_CONFIG_HOME='${moved}'`);
    expect(spawnSync(bin, ["--version"], { encoding: "utf8" }).stdout.trim()).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  }
  const agi = join(h, ".local", "bin", "agi");
  expect(readlinkSync(agi)).toBe("agent-config");
  expect(spawnSync(agi, ["--version"], { encoding: "utf8" }).stdout.trim()).toMatch(
    /^\d+\.\d+\.\d+$/,
  );
});

function runInstaller(h: string, ...args: string[]) {
  return spawnSync("bash", [join(repo, "install.sh"), ...args], {
    env: {
      PATH: process.env.PATH,
      HOME: h,
      AGENT_CONFIG_REPO: origin,
      AGENT_CONFIG_NO_RUN: "1",
      NO_COLOR: "1",
    },
    encoding: "utf8",
  });
}

test("install.sh links agi to agent-config and uninstall removes it", () => {
  const h = join(root, "agi-alias");
  const bin = join(h, ".local", "bin");
  expect(runInstaller(h).status).toBe(0);
  expect(lstatSync(join(bin, "agi")).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(bin, "agi"))).toBe("agent-config");
  // Re-running (an update) keeps the link.
  expect(runInstaller(h).status).toBe(0);
  expect(readlinkSync(join(bin, "agi"))).toBe("agent-config");
  const res = runInstaller(h, "--uninstall");
  expect(res.status).toBe(0);
  for (const name of ["agent-config", "model-ladder", "agi"]) {
    expect(existsSync(join(bin, name))).toBe(false);
  }
});

// Updating runs the old checkout's install.sh, so the new CLI adds a missing agi link itself.
test("the installed command adds agi when an older installer left it out", () => {
  const h = join(root, "agi-upgrade");
  const bin = join(h, ".local", "bin");
  expect(runInstaller(h).status).toBe(0);
  rmSync(join(bin, "agi"));
  const entry = join(h, ".local", "share", "agent-config", "dist", "cli.mjs");
  const res = cliIn({ HOME: h, AGENT_CONFIG_BIN_DIR: bin }, entry, "config", "--json");
  expect(res.code).toBe(0);
  expect(() => JSON.parse(res.stdout)).not.toThrow();
  expect(readlinkSync(join(bin, "agi"))).toBe("agent-config");
  // A foreign agi stays, and without a wrapper-set bin dir nothing is linked.
  rmSync(join(bin, "agi"));
  writeFileSync(join(bin, "agi"), "other");
  expect(cliIn({ HOME: h, AGENT_CONFIG_BIN_DIR: bin }, entry, "config").code).toBe(0);
  expect(readFileSync(join(bin, "agi"), "utf8")).toBe("other");
  rmSync(join(bin, "agi"));
  expect(cliIn({ HOME: h }, entry, "config").code).toBe(0);
  expect(existsSync(join(bin, "agi"))).toBe(false);
});

test("install.sh leaves an agi command it did not create alone", () => {
  const h = join(root, "agi-foreign");
  const bin = join(h, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "agi"), "#!/bin/sh\necho other\n", { mode: 0o755 });
  const res = runInstaller(h);
  expect(res.status).toBe(0);
  expect(res.stderr).toContain("not replacing");
  expect(readFileSync(join(bin, "agi"), "utf8")).toBe("#!/bin/sh\necho other\n");
  expect(runInstaller(h, "--uninstall").status).toBe(0);
  expect(readFileSync(join(bin, "agi"), "utf8")).toBe("#!/bin/sh\necho other\n");
});

test("self-update moves a pre-rename install even when it is up to date", () => {
  const { home: h, legacy } = legacyHome("legacy-selfupdate");
  // The pre-rename command exported MODEL_LADDER_HOME.
  const env = { HOME: h, MODEL_LADDER_HOME: legacy };
  const check = JSON.parse(
    cliIn(env, join(legacy, "dist", "cli.mjs"), "self-update", "--dry-run", "--json").stdout,
  ).check;
  expect(check).toMatchObject({ updatable: true, behind: 0, relocate: true });
  const res = cliIn(env, join(legacy, "dist", "cli.mjs"), "self-update", "--yes", "--json");
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout).message).toContain("moved to");
  expect(existsSync(legacy)).toBe(false);
  expect(existsSync(join(h, ".local", "share", "agent-config", "dist", "cli.mjs"))).toBe(true);
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
  for (const name of ["agent-config", "model-ladder"]) {
    const wrapper = readFileSync(join(home, ".local", "bin", name), "utf8");
    expect(wrapper).toContain(`export AGENT_CONFIG_HOME='${installed}'`);
  }
  expect(readlinkSync(join(home, ".local", "bin", "agi"))).toBe("agent-config");
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
  // A git checkout too, just not the one AGENT_CONFIG_HOME points at.
  const res = cli(join(cloneTo("dev"), "dist", "cli.mjs"), "self-update", "--dry-run", "--json");
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).check.reason).toContain("not the installed copy");
});

test("a failed update leaves a pre-rename install where it was, still working", () => {
  // The origin now holds the broken version from the previous test.
  const { home: h, legacy } = legacyHome("legacy-failed-update");
  git(legacy, "reset", "-q", "--hard", firstCommit);
  const res = spawnSync("bash", [join(repo, "install.sh")], {
    env: { PATH: process.env.PATH, HOME: h, AGENT_CONFIG_REPO: origin, AGENT_CONFIG_NO_RUN: "1" },
    encoding: "utf8",
  });
  expect(res.status).toBe(1);
  expect(existsSync(join(h, ".local", "share", "agent-config"))).toBe(false);
  expect(git(legacy, "rev-parse", "HEAD")).toBe(firstCommit);
  expect(spawnSync(process.execPath, [join(legacy, "dist", "cli.mjs"), "--version"]).status).toBe(
    0,
  );
});

test("uninstalling a pre-rename install keeps it while its old records list kept files", () => {
  const { home: h, legacy } = legacyHome("legacy-uninstall");
  // A 0.2.0 CLI keeps edited files (exit 3) and records them in the old state folder.
  writeFileSync(join(legacy, "dist", "cli.mjs"), "process.exit(3);\n");
  const oldState = join(h, ".local", "state", "model-ladder");
  mkdirSync(oldState, { recursive: true });
  writeFileSync(
    join(oldState, "manifest.json"),
    JSON.stringify({ version: 1, records: [{ kind: "file" }] }, null, 2),
  );
  const res = spawnSync("bash", [join(repo, "install.sh"), "--uninstall"], {
    env: { PATH: process.env.PATH, HOME: h, NO_COLOR: "1" },
    encoding: "utf8",
  });
  expect(res.status).toBe(0);
  expect(res.stderr).toContain("kept files you edited");
  expect(existsSync(legacy)).toBe(true);
  expect(existsSync(join(oldState, "manifest.json"))).toBe(true);
});

test("reports an unreachable origin with git's own reason", () => {
  const copy = cloneTo("offline");
  git(copy, "remote", "set-url", "origin", join(root, "does-not-exist"));
  const res = cliIn(
    { AGENT_CONFIG_HOME: copy },
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
    { AGENT_CONFIG_HOME: copy },
    join(copy, "dist", "cli.mjs"),
    "self-update",
    "--dry-run",
    "--json",
  );
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).check.reason).toContain("detached HEAD");
});
