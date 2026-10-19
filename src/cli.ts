#!/usr/bin/env node
// model-ladder: the TUI for humans, plain commands (and --json) for scripts and agents.

import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { buildPlan, detectedRuntimes, doctor, status, tildify } from "./commands.ts";
import { loadConfig, saveConfig, type Config } from "./config.ts";
import { configPath } from "./paths.ts";
import { applyPlan, COMPONENTS, uninstall, type Component } from "./ops.ts";
import { EFFORTS, isReviewLens, isRuntime, isTier, type Effort, type Runtime } from "./tiers.ts";
import { formatPlan, runTui } from "./tui.ts";
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

Exit codes: 0 ok, 1 a step failed, 2 usage error or refusal,
3 uninstall kept files you edited (re-run with --force), 130 cancelled.`;

class UsageError extends Error {}

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
        { check, updated: result.ok, commit: result.commit },
        result.ok
          ? `Updated to v${check.latest?.version} (${result.commit}). Run \`model-ladder install\` to re-apply your configuration with it.`
          : "Update failed; the previous version is still installed.",
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
      process.stderr.write(
        `error: ${(error as Error).message}\nRun model-ladder --help for usage.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
