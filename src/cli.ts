#!/usr/bin/env node
// model-ladder: the TUI for humans, plain commands (and --json) for scripts and agents.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { buildPlan, detectedRuntimes, doctor, status, tildify } from "./commands.ts";
import { loadConfig, saveConfig, type Config } from "./config.ts";
import { configPath } from "./paths.ts";
import { applyPlan, COMPONENTS, uninstall, type Component } from "./ops.ts";
import { EFFORTS, isReviewLens, isRuntime, isTier, type Effort, type Runtime } from "./tiers.ts";
import { formatPlan, runTui } from "./tui.ts";
import { DELEGATED_ENV, delegate } from "./delegate.ts";
import { checkForUpdate, runUpdate } from "./selfupdate.ts";
import { VERSION } from "./version.ts";

const HELP = `model-ladder ${VERSION}
Route reads and edits to the cheapest capable model (fast → balanced → deep)
for Claude Code, OpenCode, Codex and Pi.

Usage:
  model-ladder                     open the TUI (in a terminal)
  model-ladder install [flags]     apply the saved (or flagged) configuration
  model-ladder status              list what model-ladder installed and whether it changed
  model-ladder uninstall [flags]   remove it and restore what it replaced
  model-ladder doctor              check runtimes and prerequisites
  model-ladder config              print the saved configuration and its path
  model-ladder self-update         update model-ladder itself (--dry-run only checks)
  model-ladder delegate <read|edit> [--tier t] [--runtime r] "<task>"
                                   run a ladder read or edit headlessly and print only its reply;
                                   for agents that cannot spawn subagents ("-" reads the task from
                                   stdin; put a task that starts with - after --)

Flags:
  --runtime <id>                 claude | opencode | codex | pi (repeatable; default: saved, else detected)
  --component <id>               ${COMPONENTS.join(" | ")} (repeatable; default: saved, else all)
  --model <runtime>:<tier>=<id>  model for a rung, e.g. claude:fast=claude-haiku-5-5 (repeatable)
  --effort <runtime>:<tier>=<l>  low | medium | high, e.g. codex:deep=high (repeatable)
  --review <lens>=<tier>         rung for a Gentle AI review agent, e.g. review-risk=deep (repeatable)
  --min-lines <n>                read guard threshold (default 350)
  --yes                          apply or uninstall without asking
  --dry-run                      show the plan, write nothing
  --force                        uninstall files even if they changed since install
  --json                         print one JSON document to stdout
  -v, --version / -h, --help

Delegate flags:
  --tier <fast|balanced|deep>    first rung (default: fast)
  --no-climb                     do not climb to the next rung on partial/escalate/failure
  --cwd <dir>                    working directory for the agent (default: current)
  --timeout <seconds>            limit for one rung (default 600)
  --max-time <seconds>           limit for all rungs together (default 1200)
  --verify "<command>"           edit only: the one shell command the agent may run to check
                                 its change (without it, Claude and Pi edit agents get no shell)

Exit codes: 0 ok, 1 a step failed, 2 usage error or refusal,
3 uninstall kept files you edited (re-run with --force) / delegate ended partial or escalate,
4 delegate refused: already running inside a model-ladder delegated agent, 130 cancelled.`;

class UsageError extends Error {}

const DELEGATE_ONLY = ["tier", "cwd", "no-climb", "timeout", "max-time", "verify"];
const NOT_FOR_DELEGATE = [
  "component",
  "model",
  "effort",
  "review",
  "min-lines",
  "yes",
  "dry-run",
  "force",
];

function parseAssign(raw: string, flag: string): { left: string; tier: string; value: string } {
  const m = /^([a-z-]+)(?::([a-z]+))?=(.*)$/.exec(raw);
  if (!m) throw new UsageError(`${flag} expects <name>[:<tier>]=<value>, got "${raw}"`);
  return { left: m[1] ?? "", tier: m[2] ?? "", value: m[3] ?? "" };
}

function applyFlags(config: Config, values: Record<string, unknown>): void {
  const list = (k: string): string[] => (values[k] as string[] | undefined) ?? [];
  if (list("runtime").length > 0) {
    for (const r of list("runtime"))
      if (!isRuntime(r)) throw new UsageError(`unknown runtime "${r}"`);
    config.runtimes = list("runtime") as Runtime[];
  } else if (config.runtimes.length === 0) {
    config.runtimes = detectedRuntimes();
  }
  if (list("component").length > 0) {
    for (const c of list("component")) {
      if (!(COMPONENTS as readonly string[]).includes(c))
        throw new UsageError(`unknown component "${c}"`);
    }
    config.components = list("component") as Component[];
  }
  for (const raw of list("model")) {
    const { left, tier, value } = parseAssign(raw, "--model");
    if (!isRuntime(left) || !isTier(tier))
      throw new UsageError(`--model expects <runtime>:<tier>=<id>, got "${raw}"`);
    config.tiers[left][tier].model = value.trim();
  }
  for (const raw of list("effort")) {
    const { left, tier, value } = parseAssign(raw, "--effort");
    if (!isRuntime(left) || !isTier(tier) || !(EFFORTS as readonly string[]).includes(value)) {
      throw new UsageError(`--effort expects <runtime>:<tier>=low|medium|high, got "${raw}"`);
    }
    config.tiers[left][tier].effort = value as Effort;
  }
  for (const raw of list("review")) {
    const { left, value } = parseAssign(raw, "--review");
    if (!isReviewLens(left) || !isTier(value))
      throw new UsageError(`--review expects <review-lens>=<tier>, got "${raw}"`);
    config.reviewTiers[left] = value;
  }
  if (values["min-lines"] !== undefined) {
    const n = Number(values["min-lines"]);
    if (!Number.isInteger(n) || n <= 0)
      throw new UsageError("--min-lines expects a positive whole number");
    config.minLines = n;
  }
}

/** The runtime a delegating agent most likely runs in, else the first configured one. */
function delegateRuntime(configured: Runtime[]): string | undefined {
  if (process.env.MODEL_LADDER_RUNTIME) return process.env.MODEL_LADDER_RUNTIME;
  if (process.env.CLAUDECODE) return "claude";
  return configured[0] ?? detectedRuntimes()[0];
}

function out(json: boolean, data: unknown, text: string): void {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runtime: { type: "string", multiple: true },
      component: { type: "string", multiple: true },
      model: { type: "string", multiple: true },
      effort: { type: "string", multiple: true },
      review: { type: "string", multiple: true },
      "min-lines": { type: "string" },
      tier: { type: "string" },
      cwd: { type: "string" },
      "no-climb": { type: "boolean" },
      timeout: { type: "string" },
      "max-time": { type: "string" },
      verify: { type: "string" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      json: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  const json = values.json === true;
  if (values.version) return (out(json, { version: VERSION }, VERSION), 0);
  if (values.help) return (out(false, null, HELP), 0);

  const command = positionals[0] ?? "";
  // Flags that belong to one command are refused elsewhere instead of being silently ignored.
  const given = Object.keys(values).filter((k) => values[k as keyof typeof values] !== undefined);
  const misplaced =
    command === "delegate"
      ? given.find((k) => NOT_FOR_DELEGATE.includes(k))
      : given.find((k) => DELEGATE_ONLY.includes(k));
  if (misplaced) {
    throw new UsageError(
      command === "delegate"
        ? `--${misplaced} does not apply to delegate`
        : `--${misplaced} only applies to delegate`,
    );
  }
  switch (command) {
    case "": {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write(`${HELP}\n\nerror: no terminal for the TUI; pass a command.\n`);
        return 2;
      }
      return runTui();
    }
    case "install":
    case "apply": {
      const config = loadConfig();
      applyFlags(config, values);
      if (config.runtimes.length === 0) throw new UsageError("no runtime detected; pass --runtime");
      const plan = buildPlan(config);
      const changes = plan.filter((x) => x.action === "create" || x.action === "update");
      const planJson = plan.map(({ op, action, reason }) => ({
        runtime: op.runtime,
        component: op.component,
        label: op.label,
        path: op.path,
        action,
        reason,
      }));
      if (values["dry-run"] || changes.length === 0) {
        if (changes.length === 0 && !values["dry-run"]) saveConfig(config);
        out(
          json,
          { plan: planJson, applied: false },
          `${formatPlan(plan)}\n\n${changes.length} change(s)${values["dry-run"] ? " (dry run)" : ""}.`,
        );
        return 0;
      }
      if (!values.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write(
            `${formatPlan(plan)}\n\nerror: refusing to apply without --yes outside a terminal.\n`,
          );
          return 2;
        }
        process.stdout.write(`${formatPlan(plan)}\n\n`);
        const ok = await p.confirm({ message: `Apply ${changes.length} change(s)?` });
        if (p.isCancel(ok) || !ok) return 130;
      }
      const result = applyPlan(plan);
      saveConfig(config);
      const failed = result.errors
        .map((e) => `${pc.red("failed")} ${e.op.label}: ${e.error}`)
        .join("\n");
      out(
        json,
        {
          plan: planJson,
          applied: true,
          notes: result.notes,
          errors: result.errors.map((e) => ({
            label: e.op.label,
            path: e.op.path,
            error: e.error,
          })),
        },
        [
          formatPlan(plan),
          "",
          ...result.notes.map((n) => `${pc.yellow("note")} ${n}`),
          failed ||
            `${pc.green("Applied")} ${changes.length} change(s). Restart running agent sessions to load them.`,
        ].join("\n"),
      );
      return result.errors.length > 0 ? 1 : 0;
    }
    case "status": {
      const entries = status();
      const text =
        entries.length === 0
          ? "Nothing installed."
          : entries
              .map(
                (e) =>
                  `${e.state.padEnd(8)} ${e.record.runtime.padEnd(9)} ${e.record.label}  ${tildify(e.record.path)}`,
              )
              .join("\n");
      out(json, { entries: entries.map((e) => ({ ...e.record, state: e.state })) }, text);
      return 0;
    }
    case "uninstall": {
      const runtimes = (values.runtime ?? []) as string[];
      for (const r of runtimes) if (!isRuntime(r)) throw new UsageError(`unknown runtime "${r}"`);
      const entries = status().filter(
        (e) => runtimes.length === 0 || runtimes.includes(e.record.runtime),
      );
      if (entries.length === 0) return (out(json, { results: [] }, "Nothing to uninstall."), 0);
      if (values["dry-run"]) {
        out(
          json,
          { entries: entries.map((e) => e.record) },
          entries.map((e) => `remove  ${e.record.label}  ${tildify(e.record.path)}`).join("\n"),
        );
        return 0;
      }
      if (!values.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write("error: refusing to uninstall without --yes outside a terminal.\n");
          return 2;
        }
        const ok = await p.confirm({ message: `Undo ${entries.length} change(s)?` });
        if (p.isCancel(ok) || !ok) return 130;
      }
      const results = uninstall(
        (r) => runtimes.length === 0 || runtimes.includes(r.runtime),
        values.force === true,
      );
      const config = loadConfig();
      config.runtimes =
        runtimes.length === 0 ? [] : config.runtimes.filter((r) => !runtimes.includes(r));
      saveConfig(config);
      out(
        json,
        {
          results: results.map((r) => ({
            path: r.record.path,
            label: r.record.label,
            outcome: r.outcome,
            note: r.note,
          })),
        },
        results
          .map(
            (r) =>
              `${r.outcome.padEnd(13)} ${r.record.label}  ${tildify(r.record.path)}${r.note ? `  (${r.note})` : ""}`,
          )
          .join("\n"),
      );
      // 3: finished, but files edited after install were kept (re-run with --force to remove them).
      return results.some((r) => r.outcome === "kept-modified") ? 3 : 0;
    }
    case "doctor": {
      const checks = doctor();
      out(
        json,
        { checks },
        checks.map((c) => `${c.ok ? "ok  " : "warn"} ${c.name.padEnd(18)} ${c.detail}`).join("\n"),
      );
      return 0;
    }
    case "delegate": {
      if (process.env[DELEGATED_ENV]) {
        process.stderr.write(
          "error: model-ladder delegate cannot run inside an agent it started (no nested delegation).\n" +
            "  fix: answer with what you have, or reply STATUS: escalate so the caller climbs a rung.\n",
        );
        return 4;
      }
      const role = positionals[1];
      if (role !== "read" && role !== "edit") throw new UsageError("delegate expects read or edit");
      const tier = (values.tier as string | undefined) ?? "fast";
      if (!isTier(tier)) throw new UsageError(`unknown tier "${tier}"`);
      const verify = (values.verify as string | undefined)?.trim();
      if (verify !== undefined && role !== "edit")
        throw new UsageError("--verify only applies to delegate edit");
      if (verify !== undefined && (!verify || /[\r\n]/.test(verify))) {
        throw new UsageError("--verify expects one single-line command");
      }
      const config = loadConfig();
      const flagged = (values.runtime as string[] | undefined)?.at(-1);
      const runtime = flagged ?? delegateRuntime(config.runtimes);
      if (!runtime || !isRuntime(runtime)) {
        throw new UsageError(
          runtime ? `unknown runtime "${runtime}"` : "no runtime found; pass --runtime",
        );
      }
      const cwd = resolve((values.cwd as string | undefined) ?? process.cwd());
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new UsageError(`--cwd ${cwd} is not a directory`);
      }
      // The task comes from the arguments, or from stdin only when asked for with "-": an agent's
      // shell may hand over a stdin that never closes, so reading it implicitly could hang.
      let prompt = positionals.slice(2).join(" ").trim();
      if (prompt === "-") prompt = readFileSync(0, "utf8").trim();
      if (!prompt)
        throw new UsageError('delegate needs a task: pass it as an argument, or "-" to read stdin');
      const seconds = (flag: "timeout" | "max-time", fallback: number): number => {
        const raw = values[flag];
        const n = raw === undefined ? fallback : Number(raw);
        if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${flag} expects seconds`);
        return n;
      };
      const timeout = seconds("timeout", 600);
      const maxTime = seconds("max-time", 1200);
      const attempts = delegate(
        {
          role,
          tier,
          runtime,
          prompt,
          cwd,
          climb: values["no-climb"] !== true,
          timeoutMs: timeout * 1000,
          maxTimeMs: maxTime * 1000,
          ...(verify ? { verify } : {}),
        },
        config.tiers[runtime],
        {
          onStart: (t, model) =>
            process.stderr.write(`model-ladder: ${role} ${t} (${model}) running…\n`),
        },
      );
      const last = attempts.at(-1);
      for (const a of attempts) {
        process.stderr.write(
          `model-ladder: ${role} ${a.tier} (${a.model}) → ${a.status} in ${(a.durationMs / 1000).toFixed(1)}s${a.error ? `: ${a.error}` : ""}\n`,
        );
      }
      out(
        json,
        {
          runtime,
          role,
          status: last?.status,
          reply: last?.reply ?? "",
          attempts: attempts.map(({ reply: _reply, ...a }) => a),
        },
        last?.reply ?? "",
      );
      if (!last || last.status === "error") return 1;
      return last.status === "done" ? 0 : 3;
    }
    case "self-update": {
      const check = checkForUpdate();
      const summary = !check.updatable
        ? `cannot update: ${check.reason}`
        : check.behind === 0 || !check.latest
          ? `up to date: v${check.current.version} (${check.current.commit})`
          : `update available: v${check.current.version} (${check.current.commit}) -> v${check.latest.version} (${check.latest.commit}), ${check.behind} commit(s)`;
      if (!check.updatable) return (out(json, { check, updated: false }, summary), 1);
      if (check.behind === 0 || values["dry-run"])
        return (out(json, { check, updated: false }, summary), 0);
      if (!values.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write(
            `${summary}\nerror: refusing to update without --yes outside a terminal.\n`,
          );
          return 2;
        }
        const ok = await p.confirm({ message: `${summary}. Update now?` });
        if (p.isCancel(ok) || !ok) return 130;
      }
      const result = runUpdate(check);
      if (!result.ok) process.stderr.write(result.log);
      out(
        json,
        { check, updated: result.ok, commit: result.commit, message: result.message },
        result.ok
          ? `${result.message}. Run \`model-ladder install\` to re-apply your configuration with it.`
          : result.message,
      );
      return result.ok ? 0 : 1;
    }
    case "config": {
      const config = loadConfig();
      out(
        json,
        { path: configPath(), config },
        `${configPath()}\n${JSON.stringify(config, null, 2)}`,
      );
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (
      error instanceof UsageError ||
      (error as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS")
    ) {
      const hint = (error as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS")
        ? 'A task that starts with - goes after --, e.g. model-ladder delegate read -- "- item".\n'
        : "";
      process.stderr.write(
        `error: ${(error as Error).message}\n${hint}Run model-ladder --help for usage.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
