// Bumps package.json to the next semantic version from the Conventional Commits since the
// last version change, rebuilds dist/ (the version is bundled into dist/cli.mjs) and commits
// both as chore(release): <version>, leaving any other change in the tree uncommitted.
//   node scripts/bump.ts [major|minor|patch] [--dry-run] [--no-build]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

export type Bump = "major" | "minor" | "patch";

const BUMPS: Bump[] = ["patch", "minor", "major"];
const USAGE = "usage: node scripts/bump.ts [major|minor|patch] [--dry-run] [--no-build]";

/** The bump one commit message calls for, or undefined when it ships nothing. */
export function bumpOf(message: string): Bump | undefined {
  const match = /^(\w+)(?:\([^)]*\))?(!)?:/.exec(message);
  if (!match) return undefined;
  if (match[2] || /^BREAKING[ -]CHANGE:/m.test(message)) return "major";
  if (match[1] === "feat") return "minor";
  if (match[1] === "fix" || match[1] === "perf") return "patch";
  return undefined;
}

/** The largest bump across the messages. */
export function releaseType(messages: string[]): Bump | undefined {
  let rank = -1;
  for (const message of messages) {
    const bump = bumpOf(message);
    if (bump) rank = Math.max(rank, BUMPS.indexOf(bump));
  }
  return BUMPS[rank];
}

/** Before 1.0.0 a breaking change bumps the minor, as the 0.3.0 rename did. */
export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`not a semantic version: ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (bump === "major" && major > 0) return `${major + 1}.0.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Commit messages since the last commit that changed the package.json version. */
function messagesSinceRelease(): string[] {
  const base = git(
    "log",
    "-1",
    "--format=%H",
    "-G",
    '"version"[[:space:]]*:',
    "--",
    "package.json",
  );
  const range = base ? [`${base}..HEAD`] : ["HEAD"];
  return git("log", "--format=%B%x1e", ...range)
    .split("\x1e")
    .map((m) => m.trim())
    .filter(Boolean);
}

function main(): number {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { "dry-run": { type: "boolean" }, "no-build": { type: "boolean" } },
    });
  } catch {
    return (console.error(USAGE), 2);
  }
  const [forced, ...extra] = parsed.positionals;
  if (extra.length || (forced && !BUMPS.includes(forced as Bump))) return (console.error(USAGE), 2);

  const path = join(process.cwd(), "package.json");
  const text = readFileSync(path, "utf8");
  const current = (JSON.parse(text) as { version: string }).version;
  const messages = messagesSinceRelease();
  const bump = (forced as Bump | undefined) ?? releaseType(messages);
  if (!bump) {
    console.error(
      `no feat, fix, perf or breaking commits since ${current}; pass major, minor or patch to force one`,
    );
    return 1;
  }

  const next = nextVersion(current, bump);
  console.log(`${current} -> ${next} (${bump})`);
  for (const message of messages) {
    const subject = message.split("\n")[0];
    const commitBump = bumpOf(message);
    if (commitBump) console.log(`  ${commitBump.padEnd(5)}  ${subject}`);
  }
  if (parsed.values["dry-run"]) return 0;

  writeFileSync(path, text.replace(/("version"\s*:\s*")[^"]*"/, `$1${next}"`));
  const files = ["package.json"];
  if (!parsed.values["no-build"]) {
    execFileSync(join(import.meta.dirname, "..", "node_modules", ".bin", "vp"), ["pack"], {
      stdio: "inherit",
    });
    files.push("dist");
  }
  const subject = `chore(release): ${next}`;
  git("commit", "-q", "-m", subject, "--", ...files);
  console.log(`committed ${subject}`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
