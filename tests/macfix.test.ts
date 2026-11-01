import { expect, test } from "vite-plus/test";
import {
  EXIT_FAILING,
  EXIT_HEALTHY,
  EXIT_REFUSED,
  listsQuarantine,
  parseTeamId,
  isSafeHost,
  remoteCommand,
  runFix,
  runRemote,
  shellQuote,
  sshArgs,
  sudoInvocation,
} from "../src/macfix.ts";
import { fakeMac, mutations, recorder } from "./macfix-helpers.ts";

test("a healthy binary is reported and nothing is changed, even in fix mode", () => {
  const sys = fakeMac({ healedBy: "already", quarantined: true });
  const say = recorder();
  expect(runFix(sys, { mode: "fix" }, say)).toBe(EXIT_HEALTHY);
  expect(mutations(sys)).toEqual([]);
  expect(say.lines).toContain("ok launches: 2.1.314 (Claude Code)");
});

test("diagnose never changes anything, even when the launch hangs", () => {
  const sys = fakeMac({ healedBy: "killall", quarantined: true, sudoOk: true });
  const say = recorder();
  expect(runFix(sys, { mode: "diagnose", password: "pw" }, say)).toBe(EXIT_FAILING);
  expect(mutations(sys)).toEqual([]);
  expect(say.lines).toContain("info run again with 'fix' to repair");
});

test("removing the quarantine flag is enough when that heals the launch, so sudo is not used", () => {
  const sys = fakeMac({ healedBy: "xattr", quarantined: true, sudoOk: true });
  expect(runFix(sys, { mode: "fix", password: "pw" }, recorder())).toBe(EXIT_HEALTHY);
  const [only] = mutations(sys);
  expect(mutations(sys)).toHaveLength(1);
  expect(only?.cmd).toBe("xattr");
  expect(only?.args.slice(0, 2)).toEqual(["-d", "com.apple.quarantine"]);
});

test("a hung launch without quarantine restarts syspolicyd, sending the password through stdin only", () => {
  const sys = fakeMac({ healedBy: "killall", quarantined: false, sudoOk: true });
  expect(runFix(sys, { mode: "fix", password: "hunter2" }, recorder())).toBe(EXIT_HEALTHY);
  const sudo = sys.calls.filter((c) => c.cmd === "sudo");
  expect(sudo).toHaveLength(1);
  expect(sudo[0]?.args).toEqual(["-S", "-p", "", "killall", "syspolicyd"]);
  expect(sudo[0]?.input).toBe("hunter2\n");
  expect(JSON.stringify(sys.calls.map((c) => [c.cmd, c.args]))).not.toContain("hunter2");
});

test("quarantine removal that does not heal falls through to the syspolicyd restart", () => {
  const sys = fakeMac({ healedBy: "killall", quarantined: true, sudoOk: true });
  expect(runFix(sys, { mode: "fix", password: "pw" }, recorder())).toBe(EXIT_HEALTHY);
  expect(mutations(sys).map((c) => c.cmd)).toEqual(["xattr", "sudo"]);
});

test("without a password sudo runs non-interactively and a refusal is reported as failing", () => {
  const sys = fakeMac({ healedBy: "killall", sudoOk: false });
  const say = recorder();
  expect(runFix(sys, { mode: "fix" }, say)).toBe(EXIT_FAILING);
  expect(sys.calls.find((c) => c.cmd === "sudo")?.args).toEqual(["-n", "killall", "syspolicyd"]);
  expect(say.lines.some((l) => l.startsWith("fail sudo failed"))).toBe(true);
});

test("when nothing heals the launch the result is failing with manual guidance", () => {
  const sys = fakeMac({ healedBy: "never", sudoOk: true });
  const say = recorder();
  expect(runFix(sys, { mode: "fix", password: "pw" }, say)).toBe(EXIT_FAILING);
  expect(say.lines.some((l) => l.includes("Open Anyway"))).toBe(true);
});

test("a binary not signed by Anthropic's team is refused and left untouched", () => {
  const sys = fakeMac({ healedBy: "killall", team: "AAAAAAAAAA", quarantined: true, sudoOk: true });
  const say = recorder();
  expect(runFix(sys, { mode: "fix", password: "pw" }, say)).toBe(EXIT_REFUSED);
  expect(mutations(sys)).toEqual([]);
  expect(say.lines.some((l) => l.includes("unexpected Team ID 'AAAAAAAAAA'"))).toBe(true);
});

test("a missing binary is refused", () => {
  const sys = fakeMac({ healedBy: "already" });
  expect(runFix(sys, { mode: "fix", binary: "does/not/exist" }, recorder())).toBe(EXIT_REFUSED);
});

test("parsers read quarantine and Team ID", () => {
  expect(listsQuarantine("com.apple.provenance\ncom.apple.quarantine\n")).toBe(true);
  expect(listsQuarantine("com.apple.provenance\n")).toBe(false);
  expect(parseTeamId("Identifier=x\nTeamIdentifier=Q6L2SF6YDW\n")).toBe("Q6L2SF6YDW");
  expect(parseTeamId("TeamIdentifier=not set")).toBe("not set");
  expect(parseTeamId("nothing here")).toBeUndefined();
});

test("sudoInvocation keeps the password out of the arguments", () => {
  expect(sudoInvocation(undefined, ["true"])).toEqual({ args: ["-n", "true"] });
  const withPw = sudoInvocation("s3cret", ["true"]);
  expect(withPw.args).toEqual(["-S", "-p", "", "true"]);
  expect(withPw.input).toBe("s3cret\n");
});

test("the remote command locates the launcher through $HOME, with no machine-specific path", () => {
  const cmd = remoteCommand({ mode: "fix", stdinPassword: true });
  expect(cmd).toBe(
    '"${AGENT_CONFIG_BIN_DIR:-$HOME/.local/bin}/agent-config" fix-claude-code fix --password-stdin',
  );
  expect(cmd).not.toMatch(/\/Users\/|\/home\//);
});

test("diagnose never asks the remote to read a password", () => {
  expect(remoteCommand({ mode: "diagnose", stdinPassword: false })).not.toContain("--password");
});

test("binary and timeout are forwarded, with the binary shell-quoted", () => {
  const cmd = remoteCommand({
    mode: "diagnose",
    stdinPassword: false,
    binary: "it's here/claude",
    launchTimeoutSec: 30,
  });
  expect(cmd).toContain("--binary 'it'\\''s here/claude'");
  expect(cmd).toContain("--timeout 30");
});

test("shellQuote survives a quote injection attempt", () => {
  expect(shellQuote("a'; rm -rf ~; echo '")).toBe("'a'\\''; rm -rf ~; echo '\\'''");
});

test("hosts that ssh would read as options are rejected", () => {
  expect(isSafeHost("personal")).toBe(true);
  expect(isSafeHost("dev@personal.local")).toBe(true);
  expect(isSafeHost("-oProxyCommand=evil")).toBe(false);
  expect(isSafeHost("host name")).toBe(false);
  expect(isSafeHost("")).toBe(false);
  expect(() => runRemote({ host: "-oProxyCommand=evil", mode: "diagnose" })).toThrow(
    "invalid host",
  );
});

test("ssh runs non-interactively and ends option parsing before the host", () => {
  const args = sshArgs("personal", "cmd");
  expect(args).toContain("BatchMode=yes");
  expect(args.slice(-3)).toEqual(["--", "personal", "cmd"]);
});
