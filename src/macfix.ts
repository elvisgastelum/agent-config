// The fix-claude-code-permissions item's tool: unblocks a Claude Code binary that macOS refuses
// to launch (`agent-config fix-claude-code`), on this Mac or on another one over ssh. Ported from
// github.com/elvisgastelum/fix-claude-code-permissions. Every side effect goes through `System`,
// so the repair sequence is tested with a fake Mac. The admin password only ever travels through
// stdin: never an argument, a log line, a file this tool writes or the saved configuration.

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Cancelled } from "./commands.ts";

/** Anthropic PBC's public Apple Developer Team ID. Not a secret: it is in every signed build. */
export const ANTHROPIC_TEAM_ID = "Q6L2SF6YDW";
export const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;
const SYSPOLICYD_RESTART_WAIT_MS = 4_000;

/** The command that runs this tool, as `agent-config fix-claude-code`. */
export const FIX_COMMAND = "fix-claude-code";

export type Mode = "diagnose" | "fix";

export const isMode = (v: string | undefined): v is Mode => v === "diagnose" || v === "fix";

export interface FixOptions {
  mode: Mode;
  binary?: string;
  launchTimeoutMs?: number;
  /** Admin password for sudo. Without it, sudo runs with -n and fails unless passwordless. */
  password?: string;
}

export interface Reporter {
  section(title: string): void;
  ok(text: string): void;
  fail(text: string): void;
  info(text: string): void;
}

export const EXIT_HEALTHY = 0;
export const EXIT_FAILING = 1;
export const EXIT_REFUSED = 2;

// ---------------------------------------------------------------- system

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  /** Written to the child's stdin. Never put a secret in `args`; pass it here. */
  input?: string;
  timeoutMs?: number;
}

/** Every side effect the fixer needs, so the repair sequence can be tested with a fake. */
export interface System {
  run(cmd: string, args: string[], opts?: RunOptions): RunResult;
  isFile(path: string): boolean;
  realpath(path: string): string;
  home(): string;
  env(name: string): string | undefined;
  sleep(ms: number): void;
}

export const realSystem: System = {
  run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      input: opts.input,
      timeout: opts.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    return {
      status: r.status,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    };
  },
  isFile(path) {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  realpath: (path) => realpathSync(path),
  home: () => homedir(),
  env: (name) => process.env[name],
  sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

// ---------------------------------------------------------------- repair

export function listsQuarantine(xattrOutput: string): boolean {
  return xattrOutput.split("\n").some((line) => line.trim() === "com.apple.quarantine");
}

export function parseTeamId(codesignOutput: string): string | undefined {
  return /^TeamIdentifier=(.+)$/m.exec(codesignOutput)?.[1]?.trim();
}

/** The password goes through stdin only, so it never shows up in a process listing. */
export function sudoInvocation(
  password: string | undefined,
  command: string[],
): { args: string[]; input?: string } {
  if (password === undefined) return { args: ["-n", ...command] };
  return { args: ["-S", "-p", "", ...command], input: `${password}\n` };
}

export function findBinary(sys: System, explicit?: string): string | undefined {
  const candidates: string[] = [];
  if (explicit) {
    candidates.push(explicit);
  } else {
    // A non-interactive SSH shell has a bare PATH; the login shell knows where claude lives.
    const login = sys.run(sys.env("SHELL") ?? "zsh", ["-lic", "command -v claude"], {
      timeoutMs: 15_000,
    });
    const found = login.stdout.trim().split("\n").pop();
    if (found) candidates.push(found);
    const brew = sys.env("HOMEBREW_PREFIX");
    if (brew) candidates.push(join(brew, "bin", "claude"));
    candidates.push(join(sys.home(), ".local", "bin", "claude"));
    candidates.push(join(sys.home(), ".claude", "local", "claude"));
  }
  const hit = candidates.find((c) => sys.isFile(c));
  return hit === undefined ? undefined : sys.realpath(hit);
}

function checkSignature(sys: System, bin: string, say: Reporter): boolean {
  if (sys.run("codesign", ["--verify", "--strict", bin]).status === 0)
    say.ok("code signature valid");
  else {
    say.fail("code signature invalid");
    return false;
  }
  const team = parseTeamId(sys.run("codesign", ["-dv", bin]).stderr);
  if (team === ANTHROPIC_TEAM_ID) say.ok(`signed by Anthropic PBC (Team ${team})`);
  else {
    say.fail(`unexpected Team ID '${team ?? "none"}' (want ${ANTHROPIC_TEAM_ID})`);
    return false;
  }
  const notarized = sys.run("codesign", ["--verify", "-R=notarized", "--check-notarization", bin]);
  if (notarized.status === 0) say.ok("notarized");
  else {
    say.fail("not notarized");
    return false;
  }
  return true;
}

function launchTest(sys: System, bin: string, timeoutMs: number, say: Reporter): boolean {
  const r = sys.run(bin, ["--version"], { timeoutMs });
  if (r.status === 0) {
    say.ok(`launches: ${r.stdout.trim()}`);
    return true;
  }
  if (r.timedOut) say.fail(`launch hung for ${timeoutMs / 1000}s and was killed`);
  else say.fail(`launch exited ${r.status}: ${(r.stderr || r.stdout).trim()}`);
  return false;
}

function syspolicydUptime(sys: System): string {
  const pid = sys.run("pgrep", ["-x", "syspolicyd"]).stdout.trim().split("\n")[0];
  if (!pid) return "not running";
  return sys.run("ps", ["-o", "etime=", "-p", pid]).stdout.trim() || "unknown";
}

/** Returns a process exit code: 0 launches fine, 1 still failing, 2 refused. */
export function runFix(sys: System, opts: FixOptions, say: Reporter): number {
  const timeoutMs = opts.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const bin = findBinary(sys, opts.binary);
  if (bin === undefined) {
    say.fail("could not find a claude binary (use --binary PATH)");
    return EXIT_REFUSED;
  }
  say.info(`binary: ${bin}`);
  say.info(`syspolicyd uptime: ${syspolicydUptime(sys)}`);

  say.section("signature");
  if (!checkSignature(sys, bin, say)) {
    say.fail("refusing to touch a binary that is not Anthropic-signed and notarized");
    return EXIT_REFUSED;
  }

  say.section("quarantine");
  let quarantined = listsQuarantine(sys.run("xattr", [bin]).stdout);
  if (quarantined) say.info("com.apple.quarantine is set");
  else say.ok("not quarantined");

  say.section("launch");
  if (launchTest(sys, bin, timeoutMs, say)) return EXIT_HEALTHY;
  if (opts.mode === "diagnose") {
    say.info("run again with 'fix' to repair");
    return EXIT_FAILING;
  }

  say.section("fix");
  if (quarantined) {
    if (sys.run("xattr", ["-d", "com.apple.quarantine", bin]).status === 0) {
      say.ok("removed quarantine flag");
      quarantined = false;
      if (launchTest(sys, bin, timeoutMs, say)) return EXIT_HEALTHY;
    } else {
      say.fail("could not remove the quarantine flag");
    }
  }

  say.info("restarting syspolicyd (launchd respawns it)");
  const sudo = sudoInvocation(opts.password, ["killall", "syspolicyd"]);
  if (sys.run("sudo", sudo.args, { input: sudo.input }).status !== 0) {
    say.fail(
      "sudo failed: wrong password, or none given (use --password-stdin / --password-file, or the TUI)",
    );
    return EXIT_FAILING;
  }
  sys.sleep(SYSPOLICYD_RESTART_WAIT_MS);
  say.ok("syspolicyd restarted");
  if (launchTest(sys, bin, timeoutMs, say)) return EXIT_HEALTHY;

  say.info(
    "still failing: approve it on the machine (System Settings > Privacy & Security > Open Anyway) or reboot",
  );
  return EXIT_FAILING;
}

// ---------------------------------------------------------------- password

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.replace(/\r$/, "") ?? "";
  if (line === "") throw new Error("the password is empty");
  return line;
}

export const passwordFromFile = (path: string): string => firstLine(readFileSync(path, "utf8"));

/** Reads one line from piped stdin. File descriptor 0 is stdin. */
export const passwordFromStdin = (): string => firstLine(readFileSync(0, "utf8"));

/** Prompts on the terminal without echoing what is typed. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(
      new Error("no terminal to prompt on: use --password-file or --password-stdin"),
    );
  }
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (settle: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      settle();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish(() =>
            typed === "" ? reject(new Error("the password is empty")) : resolve(typed),
          );
          return;
        }
        if (ch === "\u0003") {
          finish(() => reject(new Cancelled("cancelled")));
          return;
        }
        typed = ch === "\u007f" || ch === "\b" ? typed.slice(0, -1) : typed + ch;
      }
    };
    stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------- remote

export interface RemoteOptions {
  host: string;
  mode: Mode;
  binary?: string;
  launchTimeoutSec?: number;
  password?: string;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** An ssh alias or user@host. Anything starting with '-' would be parsed as an ssh option. */
export function isSafeHost(host: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.@:%-]*$/.test(host);
}

/**
 * The command run on the remote Mac. It calls the agent-config launcher that install.sh wrote
 * there, located through $HOME on the remote side. The password is never part of it: the remote
 * reads it from stdin.
 */
export function remoteCommand(
  o: Pick<RemoteOptions, "mode" | "binary" | "launchTimeoutSec"> & { stdinPassword: boolean },
): string {
  const parts = [LAUNCHER, FIX_COMMAND, o.mode];
  if (o.binary) parts.push("--binary", shellQuote(o.binary));
  if (o.launchTimeoutSec !== undefined) parts.push("--timeout", String(o.launchTimeoutSec));
  if (o.stdinPassword) parts.push("--password-stdin");
  return parts.join(" ");
}

/**
 * The concrete host aliases an ssh config lists, in file order and without duplicates. Wildcard
 * and negated patterns (`*`, `?`, `!`) name no single machine and are skipped; `Include` files
 * are not followed.
 */
export function sshHostsFrom(config: string): string[] {
  const hosts: string[] = [];
  for (const line of config.split("\n")) {
    const match = /^\s*Host\s*[=\s]\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    for (const alias of match[1]!.split(/\s+/)) {
      if (!/[*?!]/.test(alias) && isSafeHost(alias) && !hosts.includes(alias)) hosts.push(alias);
    }
  }
  return hosts;
}

/** The host aliases in ~/.ssh/config; none when the file is missing or unreadable. */
export function sshHosts(sys: Pick<System, "home"> = realSystem): string[] {
  try {
    return sshHostsFrom(readFileSync(join(sys.home(), ".ssh", "config"), "utf8"));
  } catch {
    return [];
  }
}

export function sshArgs(host: string, command: string): string[] {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", host, command];
}

/** The first agent-config version that has the fix-claude-code command and its password flags. */
export const MIN_REMOTE_VERSION = "0.23.0";

const LAUNCHER = '"${AGENT_CONFIG_BIN_DIR:-$HOME/.local/bin}/agent-config"';

/** Whether version `a` is at least `b`, both as x.y.z. */
export function versionAtLeast(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const d = (x?.[i] ?? 0) - (y?.[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/**
 * What to tell the user when the agent-config on the other Mac cannot run this command, or
 * undefined when it can. `output` is what `agent-config --version` printed there.
 */
export function remoteVersionProblem(
  host: string,
  status: number | null,
  output: string,
): string | undefined {
  const fix = "update it there (agent-config self-update, or re-run its install.sh), then retry";
  if (status === 255) return `could not reach ${host} over ssh (key-based login is required)`;
  const version = /^\d+\.\d+\.\d+$/.exec(output.trim())?.[0];
  if (status !== 0 || version === undefined)
    return `agent-config does not run on ${host}: install it there first (its install.sh)`;
  if (!versionAtLeast(version, MIN_REMOTE_VERSION))
    return `agent-config ${version} on ${host} is older than ${MIN_REMOTE_VERSION}, which added ${FIX_COMMAND}: ${fix}`;
  return undefined;
}

/** Returns the remote command's exit code (255 when ssh itself fails). */
export function runRemote(o: RemoteOptions): number {
  if (!isSafeHost(o.host)) throw new Error(`invalid host '${o.host}'`);
  const probe = spawnSync("ssh", sshArgs(o.host, `${LAUNCHER} --version`), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (probe.error) throw probe.error;
  const problem = remoteVersionProblem(o.host, probe.status, probe.stdout ?? "");
  if (problem) throw new Error(problem);
  const stdinPassword = o.mode === "fix" && o.password !== undefined;
  const command = remoteCommand({ ...o, stdinPassword });
  const r = spawnSync("ssh", sshArgs(o.host, command), {
    input: stdinPassword ? `${o.password}\n` : undefined,
    stdio: [stdinPassword ? "pipe" : "ignore", "inherit", "inherit"],
  });
  if (r.error) throw r.error;
  return r.status ?? 255;
}
