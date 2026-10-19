#!/usr/bin/env node
// agent-config: the TUI for humans, plain commands (and --json) for scripts and agents.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  CATALOG,
  catalogItem,
  entryDefaults,
  entryKey,
  ladderRuntimes,
  missingProjectWarnings,
  scopeLabel,
  upsertEntry,
  type CatalogEntry,
  type CatalogItem,
} from "./catalog.ts";
import {
  buildPlan,
  Cancelled,
  detectedRuntimes,
  doctor,
  status,
  tildify,
  uninstallSelection,
} from "./commands.ts";
import { loadConfig, saveConfig, type Config } from "./config.ts";
import { migrateLegacyLayout } from "./migrate.ts";
import { configPath, setting } from "./paths.ts";
import {
  applyPlan,
  COMPONENTS,
  LADDER_ITEM,
  type LadderComponent,
  type ManifestRecord,
  type PlannedOp,
} from "./ops.ts";
import { EFFORTS, isReviewLens, isRuntime, isTier, type Effort, type Runtime } from "./tiers.ts";
import { formatPlan, runTui } from "./tui.ts";
import { DELEGATED_ENV, LEGACY_DELEGATED_ENV, delegate } from "./delegate.ts";
import {
  checkForUpdate,
  defaultInstallHome,
  ensureAgiAlias,
  legacyInstallHome,
  runUpdate,
} from "./selfupdate.ts";
import { VERSION } from "./version.ts";

/** One-letter spellings of the most used commands: `agi i`, `agi u`. */
const SHORT_COMMANDS: Record<string, string> = { i: "install", u: "self-update" };

const HELP = `agent-config ${VERSION}
Configure Claude Code, OpenCode, Codex and Pi from a catalog of abilities, such as
the model ladder (route reads and edits to the cheapest capable model: fast → balanced
→ deep) and Kaneo work tracking.
Also installed as \`agi\` (short alias) and \`model-ladder\` (its name before 0.3.0).

Usage:
  agent-config                     open the TUI (in a terminal)
  agent-config install             re-apply the saved catalog items (\`agi i\` for short)
  agent-config install <item>      add a catalog item, e.g. \`agi install model-ladder\` or
                                   \`agi install kaneo\` (--project <dir> for one repository
                                   instead of your user config; kaneo only)
  agent-config catalog             list catalog items and where they are installed
  agent-config status              list what agent-config installed and whether it changed
  agent-config uninstall [flags]   remove it and restore what it replaced
  agent-config uninstall <item>    remove only that catalog item (--project <dir> for its project copy)
  agent-config doctor              check runtimes and prerequisites
  agent-config config              print the saved configuration and its path
  agent-config self-update         update agent-config itself (--dry-run only checks);
                                   \`agent-config update\` and \`agi u\` are the same command
  agent-config delegate <read|edit> [--tier t] [--runtime r] "<task>"
                                   run a ladder read or edit headlessly and print only its reply;
                                   for agents that cannot spawn subagents ("-" reads the task from
                                   stdin; put a task that starts with - after --)

Flags:
  --runtime <id>                 claude | opencode | codex | pi (repeatable; default: saved, else detected)

Model ladder flags (\`install model-ladder\`; on a bare \`install\` they install the ladder too):
  --component <id>             ${COMPONENTS.join(" | ")} (repeatable; default: saved, else all)
  --model <runtime>:<tier>=<id>  model for a rung, e.g. claude:fast=claude-haiku-5-5 (repeatable)
  --effort <runtime>:<tier>=<l>  low | medium | high, e.g. codex:deep=high (repeatable)
  --review <lens>=<tier>         rung for a Gentle AI review agent, e.g. review-risk=deep (repeatable)
  --min-lines <n>                read guard threshold (default 350)

Other flags:
  --yes                        apply or uninstall without asking
  --dry-run                      show the plan, write nothing
  --project <dir>                catalog item: install into this repository instead of user scope
  --url <base-url>               kaneo: Kaneo base URL, e.g. https://kaneo.example.com (default:
                                 saved, else an existing kaneo MCP entry, else asked)
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
4 delegate refused: already running inside a agent-config delegated agent, 130 cancelled.`;

class UsageError extends Error {}

const DELEGATE_ONLY = ["tier", "cwd", "no-climb", "timeout", "max-time", "verify"];
const CATALOG_ONLY = ["project", "url"];
const LADDER_ONLY = ["component", "model", "effort", "review", "min-lines"];
const NOT_FOR_DELEGATE = [
  ...CATALOG_ONLY,
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

/** Applies the ladder flags (parts, models, review rungs, read guard) to the saved settings. */
function applyLadderFlags(config: Config, values: Record<string, unknown>): void {
  const list = (k: string): string[] => (values[k] as string[] | undefined) ?? [];
  if (list("component").length > 0) {
    for (const c of list("component")) {
      if (!(COMPONENTS as readonly string[]).includes(c))
        throw new UsageError(`unknown component "${c}"`);
    }
    config.components = list("component") as LadderComponent[];
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
  const runtime = setting("RUNTIME");
  if (runtime) return runtime;
  if (process.env.CLAUDECODE) return "claude";
  return configured[0] ?? detectedRuntimes()[0];
}

function out(json: boolean, data: unknown, text: string): void {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);
}

/**
 * The item and scope a command names. Uninstall also accepts a project directory that is gone,
 * when agent-config still knows an entry or installed files for it.
 */
function catalogTarget(
  id: string,
  values: Record<string, unknown>,
  forUninstall = false,
): { item: CatalogItem; project?: string } {
  const item = catalogItem(id);
  if (!item) {
    throw new UsageError(
      `unknown catalog item "${id}"; available: ${CATALOG.map((i) => i.id).join(", ")}`,
    );
  }
  const raw = values.project as string | undefined;
  if (raw === undefined) return { item };
  if (item.userOnly) throw new UsageError(`${item.id} installs at user scope only; drop --project`);
  const project = resolve(raw);
  if (existsSync(project) && statSync(project).isDirectory()) return { item, project };
  const key = entryKey({ item: item.id, project });
  const known =
    loadConfig().catalog.some((e) => entryKey(e) === key) ||
    status().some((e) => e.record.item === key);
  if (forUninstall && known) return { item, project };
  throw new UsageError(`--project ${project} is not a directory`);
}

/** The catalog entry to install: flags first, then what was saved, detected, or asked. */
async function catalogEntryFor(
  item: CatalogItem,
  project: string | undefined,
  config: Config,
  values: Record<string, unknown>,
): Promise<CatalogEntry> {
  const defaults = entryDefaults(item, project, config, detectedRuntimes);
  const flagged = (values.runtime as string[] | undefined) ?? [];
  for (const r of flagged) if (!isRuntime(r)) throw new UsageError(`unknown runtime "${r}"`);
  const runtimes = flagged.length > 0 ? (flagged as Runtime[]) : defaults.runtimes;
  if (runtimes.length === 0) throw new UsageError("no runtime detected; pass --runtime");
  const settings: Record<string, string> = {};
  for (const s of item.settings) {
    const raw = values[s.flag] as string | undefined;
    const known = defaults.settings[s.key];
    let value: string;
    if (raw !== undefined) {
      const normalized = s.normalize(raw);
      if (!normalized) throw new UsageError(`--${s.flag} expects a value like ${s.placeholder}`);
      value = normalized;
    } else if (known) {
      value = known.value;
      // A value found in the user's own config is about to be written into the repository.
      if (known.source === "discovered" && project) {
        process.stderr.write(
          `agent-config: using ${s.message.toLowerCase()} ${value} from your user config; it is written into ${project}. Pass --${s.flag} to choose another.\n`,
        );
      }
    } else {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new UsageError(`${item.id} needs --${s.flag} <${s.placeholder}>`);
      const answer = await p.text({
        message: s.message,
        placeholder: s.placeholder,
        validate: (v) => (s.normalize(v ?? "") ? undefined : `Enter a value like ${s.placeholder}`),
      });
      if (p.isCancel(answer)) throw new Cancelled();
      value = s.normalize(answer) ?? "";
    }
    const warning = s.warning?.(value);
    if (warning) process.stderr.write(`agent-config: warning: ${warning}\n`);
    settings[s.key] = value;
  }
  return { item: item.id, ...(project ? { project } : {}), runtimes, settings };
}

/** Shows the plan, asks unless --yes, applies it and saves the configuration. */
async function applyAndReport(
  plan: PlannedOp[],
  config: Config,
  values: Record<string, unknown>,
  json: boolean,
): Promise<number> {
  const changes = plan.filter(
    (x) => x.action === "create" || x.action === "update" || x.action === "remove",
  );
  const planJson = plan.map(({ op, action, reason }) => ({
    runtime: op.runtime,
    component: op.component,
    ...(op.item ? { item: op.item } : {}),
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
      project: { type: "string" },
      url: { type: "string" },
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

  const command = SHORT_COMMANDS[positionals[0] ?? ""] ?? positionals[0] ?? "";
  const migration = migrateLegacyLayout();
  ensureAgiAlias();
  for (const dir of migration.moved) {
    process.stderr.write(
      `agent-config: moved ${dir} to its agent-config location (renamed from model-ladder)\n`,
    );
  }
  for (const warning of migration.warnings) {
    process.stderr.write(`agent-config: warning: ${warning}; continuing with the current layout\n`);
  }
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
  const itemId = ["install", "apply", "uninstall"].includes(command) ? positionals[1] : undefined;
  const catalogFlag = given.find((k) => CATALOG_ONLY.includes(k));
  if (catalogFlag && (!itemId || (catalogFlag === "url" && command === "uninstall"))) {
    throw new UsageError(
      `--${catalogFlag} only applies to ${catalogFlag === "url" ? "install (or apply)" : "install or uninstall"} <item>`,
    );
  }
  const ladderFlag = given.find((k) => LADDER_ONLY.includes(k));
  if (ladderFlag && itemId && (itemId !== LADDER_ITEM || command === "uninstall")) {
    throw new UsageError(
      `--${ladderFlag} configures the model ladder; run \`agent-config install ${LADDER_ITEM}\``,
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
      // Ladder flags on a bare install keep configuring the ladder, as before 0.5.0.
      const ladderFlags = ladderFlag !== undefined || values.runtime !== undefined;
      const id = itemId ?? (ladderFlags ? LADDER_ITEM : undefined);
      if (id) {
        const { item, project } = catalogTarget(id, values);
        const entry = await catalogEntryFor(item, project, config, values);
        if (item.id === LADDER_ITEM) applyLadderFlags(config, values);
        upsertEntry(config, entry);
        if (itemId)
          return applyAndReport(buildPlan(config, [entryKey(entry)]), config, values, json);
      }
      if (config.catalog.length === 0) {
        throw new UsageError(
          `nothing to install yet; add a catalog item, e.g. \`agent-config install ${LADDER_ITEM}\` (see \`agent-config catalog\`)`,
        );
      }
      for (const w of missingProjectWarnings(config))
        process.stderr.write(`agent-config: warning: ${w}\n`);
      return applyAndReport(buildPlan(config), config, values, json);
    }
    case "catalog": {
      const config = loadConfig();
      const records = status();
      const items = CATALOG.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        entries: config.catalog
          .filter((e) => e.item === item.id)
          .map((e) => ({
            ...e,
            scope: e.project ? "project" : "user",
            files: records.filter((r) => r.record.item === entryKey(e)).length,
          })),
      }));
      const width = Math.max(...CATALOG.map((i) => i.id.length));
      const indent = " ".repeat(width + 1);
      const text = items
        .map((i) =>
          [
            `${pc.bold(i.id.padEnd(width))} ${i.title}`,
            `${indent}${i.description}`,
            `${indent}installed: ${
              i.entries.length === 0
                ? "no"
                : i.entries.map((e) => `${scopeLabel(e)} (${e.runtimes.join(", ")})`).join("; ")
            }`,
            `${indent}install: agent-config install ${i.id}${catalogItem(i.id)?.userOnly ? "" : " [--project <dir>]"}`,
          ].join("\n"),
        )
        .join("\n\n");
      out(json, { items }, text);
      return 0;
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
      const key = itemId
        ? (() => {
            const { item, project } = catalogTarget(itemId, values, true);
            return entryKey({ item: item.id, project });
          })()
        : undefined;
      const match = (r: ManifestRecord) =>
        (key === undefined || r.item === key) &&
        (runtimes.length === 0 || runtimes.includes(r.runtime));
      const entries = status().filter((e) => match(e.record));
      // Nothing on disk: still forget a saved entry so `install` does not bring it back.
      if (entries.length === 0 && key && !values["dry-run"]) uninstallSelection({ key, runtimes });
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
      const { results, restoreErrors } = uninstallSelection(
        { ...(key ? { key } : {}), runtimes },
        values.force === true,
      );
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
      for (const e of restoreErrors)
        process.stderr.write(`error: could not restore ${e.op.label} (${e.op.path}): ${e.error}\n`);
      if (restoreErrors.length > 0) return 1;
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
      if (process.env[DELEGATED_ENV] || process.env[LEGACY_DELEGATED_ENV]) {
        process.stderr.write(
          "error: agent-config delegate cannot run inside an agent it started (no nested delegation).\n" +
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
      const runtime = flagged ?? delegateRuntime(ladderRuntimes(config));
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
            process.stderr.write(`agent-config: ${role} ${t} (${model}) running…\n`),
        },
      );
      const last = attempts.at(-1);
      for (const a of attempts) {
        process.stderr.write(
          `agent-config: ${role} ${a.tier} (${a.model}) → ${a.status} in ${(a.durationMs / 1000).toFixed(1)}s${a.error ? `: ${a.error}` : ""}\n`,
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
    case "update":
    case "self-update": {
      const check = checkForUpdate();
      const summary = !check.updatable
        ? `cannot update: ${check.reason}`
        : (check.behind === 0 || !check.latest) && !check.relocate
          ? `up to date: v${check.current.version} (${check.current.commit})`
          : check.behind === 0
            ? `up to date, but still in the pre-rename location ${legacyInstallHome()}: updating moves it to ${defaultInstallHome()}`
            : `update available: v${check.current.version} (${check.current.commit}) -> v${check.latest?.version} (${check.latest?.commit}), ${check.behind} commit(s)`;
      if (!check.updatable) return (out(json, { check, updated: false }, summary), 1);
      if ((check.behind === 0 && !check.relocate) || values["dry-run"])
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
          ? `${result.message}. Run \`agent-config install\` to re-apply your configuration with it.`
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
    if (error instanceof Cancelled) process.exit(130);
    if (
      error instanceof UsageError ||
      (error as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS")
    ) {
      const hint = (error as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS")
        ? 'A task that starts with - goes after --, e.g. agent-config delegate read -- "- item".\n'
        : "";
      process.stderr.write(
        `error: ${(error as Error).message}\n${hint}Run agent-config --help for usage.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
