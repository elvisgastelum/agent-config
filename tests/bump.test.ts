import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { bumpOf, nextVersion, releaseType } from "../scripts/bump.ts";

const script = join(import.meta.dirname, "..", "scripts", "bump.ts");

test("reads the bump from a conventional commit", () => {
  expect(bumpOf("fix(ops): keep symlinks")).toBe("patch");
  expect(bumpOf("perf: faster plan")).toBe("patch");
  expect(bumpOf("feat(cli): add agi i")).toBe("minor");
  expect(bumpOf("feat!: rename the tool")).toBe("major");
  expect(bumpOf("refactor(ops)!: drop v0 manifests")).toBe("major");
  expect(bumpOf("fix: x\n\nBREAKING CHANGE: the flag is gone")).toBe("major");
  expect(bumpOf("fix: x\n\nBREAKING-CHANGE: the flag is gone")).toBe("major");
  expect(bumpOf("chore(release): 0.4.0")).toBeUndefined();
  expect(bumpOf("docs: readme")).toBeUndefined();
  expect(bumpOf("Merge branch 'main'")).toBeUndefined();
});

test("takes the largest bump across commits", () => {
  expect(releaseType(["docs: a", "fix: b"])).toBe("patch");
  expect(releaseType(["fix: a", "feat: b", "fix: c"])).toBe("minor");
  expect(releaseType(["feat: a", "feat!: b"])).toBe("major");
  expect(releaseType(["chore: a", "docs: b"])).toBeUndefined();
});

test("bumps the version, keeping breaking changes on the minor before 1.0", () => {
  expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
  expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
  expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  expect(nextVersion("0.4.0", "patch")).toBe("0.4.1");
  expect(nextVersion("0.4.0", "minor")).toBe("0.5.0");
  expect(nextVersion("0.4.0", "major")).toBe("0.5.0");
  expect(() => nextVersion("1.2", "patch")).toThrow("not a semantic version: 1.2");
});

let repo = "";
afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function commit(subject: string, version?: string): void {
  if (version)
    writeFileSync(join(repo, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  git("add", "-A");
  git("commit", "--allow-empty", "-q", "-m", subject);
}

function run(...args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout: string; stderr: string; status: number };
    return { out: e.stdout + e.stderr, code: e.status };
  }
}

function setup(): void {
  repo = mkdtempSync(join(tmpdir(), "agent-config-bump-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  commit("feat: first", "0.3.0");
  commit("fix: old fix");
  commit("chore(release): 0.4.0", "0.4.0");
}

test("dry run reports the bump from commits since the last version change", () => {
  setup();
  commit("fix(ops): a fix");
  commit("feat(cli): a feature");
  const { out, code } = run("--dry-run");
  expect(code).toBe(0);
  expect(out).toContain("0.4.0 -> 0.5.0 (minor)");
  expect(out).toContain("feat(cli): a feature");
  expect(out).not.toContain("old fix");
  expect(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version).toBe("0.4.0");
});

test("refuses when no commit since the last release calls for one", () => {
  setup();
  commit("docs: readme");
  const { out, code } = run("--dry-run");
  expect(code).toBe(1);
  expect(out).toContain("no feat, fix, perf or breaking commits since 0.4.0");
});

test("an explicit release type overrides the history", () => {
  setup();
  commit("docs: readme");
  const { out, code } = run("patch", "--dry-run");
  expect(code).toBe(0);
  expect(out).toContain("0.4.0 -> 0.4.1 (patch)");
});

test("rejects an unknown argument", () => {
  setup();
  const { out, code } = run("huge");
  expect(code).toBe(2);
  expect(out).toContain("usage: node scripts/bump.ts [major|minor|patch] [--dry-run] [--no-build]");
});

test("writes the new version, keeps the file's format and commits only the release", () => {
  setup();
  commit("fix: a fix");
  writeFileSync(join(repo, "notes.txt"), "unrelated work\n");
  const { out, code } = run("--no-build");
  expect(code).toBe(0);
  expect(out).toContain("committed chore(release): 0.4.1");
  expect(readFileSync(join(repo, "package.json"), "utf8")).toBe(
    `${JSON.stringify({ version: "0.4.1" }, null, 2)}\n`,
  );
  expect(git("log", "-1", "--format=%s")).toBe("chore(release): 0.4.1\n");
  expect(git("show", "--name-only", "--format=", "HEAD")).toBe("package.json\n");
  expect(git("status", "--porcelain")).toBe("?? notes.txt\n");
});
