// `model-ladder delegate`: run one ladder read or edit headlessly through a runtime's own
// CLI and return only the agent's reply. For agents that cannot spawn subagents (parallel
// workers, nested agents): they shell out to this instead.
//
// It climbs the ladder by itself (fast → balanced → deep on partial/escalate/failure), and
// refuses to run inside an agent it started, so delegation never recurses.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBody } from "./content.ts";
import { TIERS, agentName, type Role, type Runtime, type Tier, type TierMap } from "./tiers.ts";

/** Set in every process `delegate` starts; its presence means "already delegated". */
export const DELEGATED_ENV = "MODEL_LADDER_DELEGATED";

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
  timeoutMs: number;
}

interface Invocation {
  bin: string;
  args: string[];
  stdin?: string;
  /** Codex writes its final message to a file instead of stdout. */
  outFile?: string;
}

const READ_TOOLS = { claude: ["Read", "Grep", "Glob"], pi: ["read", "grep", "find", "ls"] };
const EDIT_TOOLS = {
  claude: ["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
  pi: ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

export function invocation(
  runtime: Runtime,
  role: Role,
  tier: Tier,
  tiers: TierMap,
  prompt: string,
  cwd: string,
  scratch: string,
): Invocation {
  const { model, effort } = tiers[tier];
  const name = agentName(role, tier);
  switch (runtime) {
    case "claude": {
      const tools = role === "read" ? READ_TOOLS.claude : EDIT_TOOLS.claude;
      const args = ["-p", "--agent", name, "--output-format", "json", "--allowedTools", ...tools];
      if (role === "edit") args.push("--permission-mode", "acceptEdits");
      if (model) args.push("--model", model);
      return { bin: "claude", args: [...args, "--", prompt] };
    }
    case "opencode": {
      const args = ["run", "--agent", name];
      if (model) args.push("--model", model);
      return { bin: "opencode", args: [...args, prompt] };
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
        stdin: `${agentBody(role, tier)}\n\n${prompt}`,
        outFile,
      };
    }
    case "pi": {
      const tools = role === "read" ? READ_TOOLS.pi : EDIT_TOOLS.pi;
      const args = ["-p", "--no-session", "--tools", tools.join(","), "--thinking", effort];
      if (model) args.push("--model", model);
      args.push("--append-system-prompt", agentBody(role, tier));
      return { bin: "pi", args: [...args, prompt] };
    }
  }
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

function runOnce(req: DelegateRequest, tier: Tier, tiers: TierMap, prompt: string): Attempt {
  const scratch = mkdtempSync(join(tmpdir(), "model-ladder-delegate-"));
  const started = Date.now();
  const model = tiers[tier].model || "session model";
  try {
    const inv = invocation(req.runtime, req.role, tier, tiers, prompt, req.cwd, scratch);
    const res = spawnSync(inv.bin, inv.args, {
      cwd: req.cwd,
      input: inv.stdin ?? "",
      encoding: "utf8",
      timeout: req.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, [DELEGATED_ENV]: "1" },
    });
    const durationMs = Date.now() - started;
    if (res.error || res.status !== 0) {
      const why = res.error
        ? (res.error as NodeJS.ErrnoException).code === "ENOENT"
          ? `${inv.bin} is not installed or not on PATH`
          : res.error.message
        : `${inv.bin} exited with ${res.status}: ${(res.stderr || "").trim().split("\n").slice(-3).join(" ")}`;
      return { tier, model, status: "error", durationMs, reply: "", error: why };
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

function escalationPrompt(original: string, previous: Attempt): string {
  const summary = previous.error ?? previous.reply.slice(0, 2000);
  return `${original}\n\nPrevious attempt (${previous.tier} rung, STATUS: ${previous.status}):\n${summary}`;
}

/** Runs the request, climbing one rung at a time while replies are not `done`. */
export function delegate(req: DelegateRequest, tiers: TierMap): Attempt[] {
  const attempts: Attempt[] = [];
  let prompt = req.prompt;
  for (const tier of TIERS.slice(TIERS.indexOf(req.tier))) {
    const attempt = runOnce(req, tier, tiers, prompt);
    attempts.push(attempt);
    if (attempt.status === "done" || !req.climb) break;
    // A missing runtime binary will not get better on a higher rung.
    if (attempt.error?.includes("not on PATH")) break;
    prompt = escalationPrompt(req.prompt, attempt);
  }
  return attempts;
}
