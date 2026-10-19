// `agent-config delegate`: run one ladder read or edit headlessly through a runtime's own
// CLI and return only the agent's reply. For agents that cannot spawn subagents (parallel
// workers, nested agents): they shell out to this instead.
//
// It climbs the ladder by itself (fast → balanced → deep on partial/escalate/failure) within
// an overall time budget, and refuses to run inside an agent it started. That refusal relies
// on an inherited environment marker plus the agents' instructions: it stops honest
// recursion, but an edit agent with a shell could unset the marker, so it is not a sandbox.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBody } from "./content.ts";
import { claudeDir, opencodeDir } from "./paths.ts";
import { TIERS, agentName, type Role, type Runtime, type Tier, type TierMap } from "./tiers.ts";

/** Set in every process `delegate` starts; its presence means "already delegated". */
export const DELEGATED_ENV = "AGENT_CONFIG_DELEGATED";
/** The same marker under the pre-rename name, still honoured. */
export const LEGACY_DELEGATED_ENV = "MODEL_LADDER_DELEGATED";

export type ReplyStatus = "done" | "partial" | "escalate" | "error";

export interface Attempt {
  tier: Tier;
  model: string;
  status: ReplyStatus;
  durationMs: number;
  reply: string;
  error?: string;
}

export interface DelegateRequest {
  role: Role;
  tier: Tier;
  runtime: Runtime;
  prompt: string;
  cwd: string;
  climb: boolean;
  /** Limit for one rung. */
  timeoutMs: number;
  /** Limit for all rungs together. */
  maxTimeMs: number;
  /** Edit only: the one shell command the agent may run to check its change. */
  verify?: string;
}

interface Invocation {
  bin: string;
  args: string[];
  stdin?: string;
  /** Codex writes its final message to a file instead of stdout. */
  outFile?: string;
}

/**
 * A task that starts with "-" would be parsed as an option by runtimes that take the prompt
 * as a bare positional argument, so give it a leading word.
 */
export function safePrompt(prompt: string): string {
  return prompt.trimStart().startsWith("-") ? `Task:\n${prompt}` : prompt;
}

function withVerify(prompt: string, verify: string | undefined): string {
  return verify
    ? `${prompt}\n\nVerify command (the only shell command you may run): ${verify}`
    : prompt;
}

export function invocation(
  req: Pick<DelegateRequest, "runtime" | "role" | "cwd" | "verify">,
  tier: Tier,
  tiers: TierMap,
  prompt: string,
  scratch: string,
): Invocation {
  const { runtime, role, cwd, verify } = req;
  const { model, effort } = tiers[tier];
  const name = agentName(role, tier);
  const task = safePrompt(withVerify(prompt, role === "edit" ? verify : undefined));
  switch (runtime) {
    case "claude": {
      // Edit agents may write files and run only the verify command, never an arbitrary shell.
      const tools =
        role === "read"
          ? ["Read", "Grep", "Glob"]
          : ["Read", "Edit", "Write", "Grep", "Glob", ...(verify ? [`Bash(${verify})`] : [])];
      const args = ["-p", "--agent", name, "--output-format", "json", "--allowedTools", ...tools];
      if (role === "edit") args.push("--permission-mode", "acceptEdits");
      if (model) args.push("--model", model);
      return { bin: "claude", args: [...args, "--", task] };
    }
    case "opencode": {
      // Tool limits come from the installed agent file, checked by agentFileProblem().
      const args = ["run", "--agent", name];
      if (model) args.push("--model", model);
      return { bin: "opencode", args: [...args, task] };
    }
    case "codex": {
      const outFile = join(scratch, "last-message.txt");
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "-C",
        cwd,
        "-s",
        role === "read" ? "read-only" : "workspace-write",
        "-c",
        `model_reasoning_effort="${effort}"`,
        "-o",
        outFile,
      ];
      if (model) args.push("-m", model);
      // Codex has no flag to pick a custom agent, so the agent's instructions lead the prompt.
      return {
        bin: "codex",
        args: [...args, "-"],
        stdin: `${agentBody(role, tier)}\n\n${task}`,
        outFile,
      };
    }
    case "pi": {
      // Pi cannot limit bash to one command, so edits get bash only when a verify command is set.
      const tools =
        role === "read"
          ? ["read", "grep", "find", "ls"]
          : ["read", "grep", "find", "ls", "edit", "write", ...(verify ? ["bash"] : [])];
      const args = ["-p", "--no-session", "--tools", tools.join(","), "--thinking", effort];
      if (model) args.push("--model", model);
      args.push("--append-system-prompt", agentBody(role, tier));
      return { bin: "pi", args: [...args, task] };
    }
  }
}

/**
 * Runtimes that select the agent by name depend on its installed definition for tool limits.
 * Returns why that definition cannot be trusted, or undefined when it is fine.
 */
export function agentFileProblem(runtime: Runtime, role: Role, tier: Tier): string | undefined {
  const name = agentName(role, tier);
  const file =
    runtime === "claude"
      ? join(claudeDir(), "agents", `${name}.md`)
      : runtime === "opencode"
        ? join(opencodeDir(), "agents", `${name}.md`)
        : undefined;
  if (!file) return undefined;
  const fix = `run \`agent-config install model-ladder --runtime ${runtime}\``;
  if (!existsSync(file)) return `${name} is not installed for ${runtime}; ${fix}`;
  if (runtime === "opencode" && role === "read") {
    const text = readFileSync(file, "utf8");
    if (!/^\s+edit:\s*deny\s*$/m.test(text) || !/^\s+bash:\s*deny\s*$/m.test(text)) {
      return `${name} no longer denies edit and bash (changed since install); ${fix}`;
    }
  }
  return undefined;
}

export function parseStatus(reply: string): ReplyStatus {
  const m = /^\s*STATUS:\s*(done|partial|escalate)\b/im.exec(reply);
  return m ? (m[1]?.toLowerCase() as ReplyStatus) : "partial";
}

/** Claude's --output-format json wraps the reply; the others print it as is. */
function extractReply(runtime: Runtime, stdout: string): { reply: string; error?: string } {
  if (runtime !== "claude") return { reply: stdout.trim() };
  try {
    const data = JSON.parse(stdout) as { result?: string; is_error?: boolean; subtype?: string };
    if (data.is_error) return { reply: data.result ?? "", error: data.subtype ?? "agent error" };
    return { reply: (data.result ?? "").trim() };
  } catch {
    return { reply: stdout.trim() };
  }
}

function failure(bin: string, res: ReturnType<typeof spawnSync>, timeoutMs: number): string {
  const code = (res.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return `${bin} is not installed or not on PATH`;
  if (code === "ETIMEDOUT") return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  if (res.error) return res.error.message;
  if (res.signal) return `${bin} was killed by ${res.signal}`;
  const tail = String(res.stderr ?? "")
    .trim()
    .split("\n")
    .slice(-3)
    .join(" ");
  return `${bin} exited with ${res.status}${tail ? `: ${tail}` : ""}`;
}

function runOnce(
  req: DelegateRequest,
  tier: Tier,
  tiers: TierMap,
  prompt: string,
  timeoutMs: number,
): Attempt {
  const started = Date.now();
  const model = tiers[tier].model || "session model";
  const problem = agentFileProblem(req.runtime, req.role, tier);
  if (problem) return { tier, model, status: "error", durationMs: 0, reply: "", error: problem };
  const scratch = mkdtempSync(join(tmpdir(), "agent-config-delegate-"));
  try {
    const inv = invocation(req, tier, tiers, prompt, scratch);
    const res = spawnSync(inv.bin, inv.args, {
      cwd: req.cwd,
      input: inv.stdin ?? "",
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, [DELEGATED_ENV]: "1" },
    });
    const durationMs = Date.now() - started;
    if (res.error || res.status !== 0) {
      return {
        tier,
        model,
        status: "error",
        durationMs,
        reply: "",
        error: failure(inv.bin, res, timeoutMs),
      };
    }
    let stdout = res.stdout ?? "";
    if (inv.outFile) {
      try {
        stdout = readFileSync(inv.outFile, "utf8");
      } catch {
        // Fall back to stdout when Codex did not write the file.
      }
    }
    const { reply, error } = extractReply(req.runtime, stdout);
    if (error) return { tier, model, status: "error", durationMs, reply, error };
    return { tier, model, status: parseStatus(reply), durationMs, reply };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What an edit rung left in the working tree, so the next rung continues from it. */
function workingTreeChanges(cwd: string): string {
  try {
    const stat = execFileSync("git", ["-C", cwd, "diff", "--stat"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
    return stat.slice(0, 1500);
  } catch {
    return "";
  }
}

function escalationPrompt(req: DelegateRequest, previous: Attempt): string {
  const summary = previous.error ?? previous.reply.slice(0, 2000);
  let text = `${req.prompt}\n\nPrevious attempt (${previous.tier} rung, STATUS: ${previous.status}):\n${summary}`;
  if (req.role === "edit") {
    const changes = workingTreeChanges(req.cwd);
    text += changes
      ? `\n\nThe previous attempt already changed these files; inspect them (git diff) and continue from their current state instead of starting over:\n${changes}`
      : "\n\nThe previous attempt may have changed files; check the working tree before editing.";
  }
  return text;
}

export interface DelegateHooks {
  /** Called before each rung starts, for progress output. */
  onStart?: (tier: Tier, model: string) => void;
  now?: () => number;
}

/** Runs the request, climbing one rung at a time while replies are not `done`. */
export function delegate(
  req: DelegateRequest,
  tiers: TierMap,
  hooks: DelegateHooks = {},
): Attempt[] {
  const now = hooks.now ?? Date.now;
  const deadline = now() + req.maxTimeMs;
  const attempts: Attempt[] = [];
  let prompt = req.prompt;
  for (const tier of TIERS.slice(TIERS.indexOf(req.tier))) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    hooks.onStart?.(tier, tiers[tier].model || "session model");
    const attempt = runOnce(req, tier, tiers, prompt, Math.min(req.timeoutMs, remaining));
    attempts.push(attempt);
    if (attempt.status === "done" || !req.climb) break;
    // A missing runtime or agent will not get better on a higher rung.
    if (attempt.error && /not on PATH|not installed for|changed since install/.test(attempt.error))
      break;
    prompt = escalationPrompt(req, attempt);
  }
  return attempts;
}
