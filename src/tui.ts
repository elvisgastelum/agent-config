// The interactive flow: pick a catalog item (for the model ladder: runtimes, components and
// models per rung), review the plan, apply. Ctrl+C at any prompt leaves without further changes.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  CATALOG,
  catalogItem,
  entryDefaults,
  entryKey,
  missingProjectWarnings,
  scopeLabel,
  upsertEntry,
  type CatalogEntry,
} from "./catalog.ts";
import {
  buildPlan,
  Cancelled,
  detect,
  detectedRuntimes,
  doctor,
  status,
  tildify,
  uninstallSelection,
} from "./commands.ts";
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config.ts";
import {
  applyPlan,
  COMPONENTS,
  COMPONENT_LABELS,
  LADDER_ITEM,
  LADDER_KEY,
  type Action,
  type PlannedOp,
} from "./ops.ts";
import { RUNTIME_COMPONENTS } from "./runtimes.ts";
import {
  EFFORTS,
  REVIEW_LENSES,
  RUNTIME_LABELS,
  TIERS,
  TIER_LABELS,
  defaultTierMap,
  type Effort,
  type Runtime,
  type Tier,
} from "./tiers.ts";
import { checkForUpdate, reapplyWithNewVersion, runUpdate } from "./selfupdate.ts";
import { VERSION } from "./version.ts";

function ask<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

const ACTION_COLOR: Record<Action, (s: string) => string> = {
  create: pc.green,
  update: pc.yellow,
  unchanged: pc.dim,
  skip: pc.dim,
  remove: pc.red,
};

export function formatPlan(plan: PlannedOp[]): string {
  const lines: string[] = [];
  let lastRuntime = "";
  for (const { op, action, reason } of plan) {
    if (op.runtime !== lastRuntime) {
      lines.push(pc.bold(RUNTIME_LABELS[op.runtime]));
      lastRuntime = op.runtime;
    }
    const tag = ACTION_COLOR[action](action.padEnd(9));
    const why = reason ? pc.dim(` (${reason})`) : "";
    lines.push(`  ${tag} ${op.label}${why} ${pc.dim(tildify(op.path))}`);
  }
  return lines.join("\n");
}

function ladderSummary(config: Config, runtime: Runtime): string {
  return TIERS.map((t) => {
    const { model, effort } = config.tiers[runtime][t];
    return `${t}: ${model || "session model"} (${effort})`;
  }).join(" · ");
}

async function chooseModels(config: Config, runtimes: Runtime[]): Promise<void> {
  const mode = ask(
    await p.select({
      message: "Models for each rung",
      options: [
        {
          value: "keep",
          label: "Keep current",
          hint: runtimes.map((r) => `${r}: ${ladderSummary(config, r)}`).join(" | "),
        },
        {
          value: "recommended",
          label: "Recommended ladder",
          hint: "Haiku 5.5 → Sonnet 5.5 → Opus 5.5 (Codex: effort low → high)",
        },
        { value: "custom", label: "Customize per runtime" },
      ],
    }),
  );
  if (mode === "recommended") {
    for (const r of runtimes) config.tiers[r] = defaultTierMap(r);
    return;
  }
  if (mode !== "custom") return;
  for (const runtime of runtimes) {
    p.log.step(pc.bold(RUNTIME_LABELS[runtime]));
    for (const tier of TIERS) {
      const current = config.tiers[runtime][tier];
      const model = ask(
        await p.text({
          message: `${tier} — ${TIER_LABELS[tier]}`,
          placeholder:
            runtime === "codex" ? "empty = session model" : defaultTierMap(runtime)[tier].model,
          initialValue: current.model,
        }),
      );
      const effort = ask(
        await p.select({
          message: `${tier} reasoning effort`,
          initialValue: current.effort,
          options: EFFORTS.map((e) => ({ value: e, label: e })),
        }),
      ) as Effort;
      config.tiers[runtime][tier] = { model: (model ?? "").trim(), effort };
    }
  }
}

async function chooseReviewTiers(config: Config): Promise<void> {
  const summary = REVIEW_LENSES.map(
    (l) => `${l.replace("review-", "")}: ${config.reviewTiers[l]}`,
  ).join(", ");
  const mode = ask(
    await p.select({
      message: "Gentle AI review agents: which rung runs each lens?",
      options: [
        { value: "keep", label: "Keep", hint: summary },
        { value: "custom", label: "Customize per lens" },
      ],
    }),
  );
  if (mode !== "custom") return;
  for (const lens of REVIEW_LENSES) {
    config.reviewTiers[lens] = ask(
      await p.select({
        message: lens,
        initialValue: config.reviewTiers[lens],
        options: TIERS.map((t) => ({ value: t, label: t, hint: TIER_LABELS[t] })),
      }),
    ) as Tier;
  }
}

/** Installs or updates the model ladder: agents, parts, models per rung, review rungs, guard. */
async function ladderFlow(config: Config): Promise<void> {
  const found = detect();
  const defaults = entryDefaults(catalogItem(LADDER_ITEM)!, undefined, config, detectedRuntimes);
  const runtimes = ask(
    await p.multiselect({
      message: "Configure which agents?",
      options: found.map((d) => ({
        value: d.runtime,
        label: RUNTIME_LABELS[d.runtime],
        hint: d.bin || d.dir ? "detected" : "not found",
      })),
      initialValues: defaults.runtimes,
      required: true,
    }),
  ) as Runtime[];

  const offered = COMPONENTS.filter((c) => runtimes.some((r) => RUNTIME_COMPONENTS[r].includes(c)));
  config.components = ask(
    await p.multiselect({
      message: "Install which parts?",
      options: offered.map((c) => ({ value: c, label: COMPONENT_LABELS[c] })),
      initialValues: config.components.filter((c) => offered.includes(c)),
      required: true,
    }),
  );

  await chooseModels(config, runtimes);
  if (config.components.includes("review-models")) await chooseReviewTiers(config);
  if (config.components.includes("read-guard") && runtimes.includes("claude")) {
    const value = ask(
      await p.text({
        message: "Read guard: block whole reads of files with at least how many lines?",
        initialValue: String(config.minLines),
        validate: (v) =>
          /^\d+$/.test(v ?? "") && Number(v) > 0 ? undefined : "Enter a positive whole number",
      }),
    );
    config.minLines = Number(value);
  }

  upsertEntry(config, { item: LADDER_ITEM, runtimes, settings: {} });
  await applyWithConfirm(buildPlan(config, [LADDER_KEY]), config);
}

/** Re-applies every saved catalog item, for example after an update of agent-config. */
async function reapplyFlow(): Promise<void> {
  const config = loadConfig();
  for (const w of missingProjectWarnings(config)) p.log.warn(w);
  await applyWithConfirm(buildPlan(config), config);
}

/** Shows the plan, asks, applies it and saves the configuration. */
async function applyWithConfirm(plan: PlannedOp[], config: Config): Promise<void> {
  p.note(formatPlan(plan), "Plan");
  const changes = plan.filter(
    (x) => x.action === "create" || x.action === "update" || x.action === "remove",
  ).length;
  if (changes === 0) {
    saveConfig(config);
    p.log.success("Everything is already up to date.");
    return;
  }
  if (!ask(await p.confirm({ message: `Apply ${changes} change(s)?` }))) {
    p.log.info("Nothing changed.");
    return;
  }
  const spin = p.spinner();
  spin.start("Applying");
  const result = applyPlan(plan);
  saveConfig(config);
  if (result.errors.length > 0) {
    spin.stop(pc.red(`${result.errors.length} step(s) failed`));
    for (const e of result.errors) p.log.error(`${e.op.label} (${tildify(e.op.path)}): ${e.error}`);
    return;
  }
  spin.stop("Applied");
  for (const note of result.notes) p.log.warn(note);
  p.log.info(
    "Restart running agent sessions to pick up the new agents. Run `agent-config status` any time; `agent-config uninstall` undoes everything.",
  );
}

async function catalogFlow(): Promise<void> {
  const config = loadConfig();
  const item = ask(
    await p.select({
      message: "Which catalog item?",
      options: CATALOG.map((i) => {
        const where = config.catalog.filter((e) => e.item === i.id).map(scopeLabel);
        return {
          value: i,
          label: i.title,
          hint: where.length > 0 ? `installed: ${where.join(", ")}` : i.description,
        };
      }),
    }),
  );
  const installed = config.catalog.filter((e) => e.item === item.id);
  const action =
    installed.length === 0
      ? "install"
      : ask(
          await p.select({
            message: item.title,
            options: [
              {
                value: "install",
                label: "Install or update",
                hint:
                  item.id === LADDER_ITEM
                    ? "agents, parts, models"
                    : item.userOnly
                      ? "user scope"
                      : "user or project scope",
              },
              { value: "uninstall", label: "Uninstall", hint: "remove and restore" },
            ],
          }),
        );

  if (action === "uninstall") {
    const entry: CatalogEntry =
      installed.length === 1
        ? installed[0]!
        : ask(
            await p.select({
              message: "Uninstall which copy?",
              options: installed.map((e) => ({ value: e, label: scopeLabel(e) })),
            }),
          );
    if (!ask(await p.confirm({ message: `Remove ${item.id} (${scopeLabel(entry)})?` }))) return;
    await uninstallAndReport({ key: entryKey(entry), runtimes: [] });
    return;
  }
  if (item.id === LADDER_ITEM) return ladderFlow(config);

  const scope = item.userOnly
    ? "user"
    : ask(
        await p.select({
          message: "Install where?",
          options: [
            { value: "user", label: "User", hint: "every project, in your home config" },
            { value: "project", label: "Project", hint: "one repository, committed with it" },
          ],
        }),
      );
  const project =
    scope === "project"
      ? resolve(
          ask(
            await p.text({
              message: "Project directory",
              initialValue: process.cwd(),
              validate: (v) => {
                const dir = resolve(v ?? "");
                return existsSync(dir) && statSync(dir).isDirectory()
                  ? undefined
                  : "Enter an existing directory";
              },
            }),
          ),
        )
      : undefined;
  const defaults = entryDefaults(item, project, config, detectedRuntimes);
  const found = detect();
  const supported = found.filter((d) => !item.runtimes || item.runtimes.includes(d.runtime));
  const runtimes =
    supported.length === 1
      ? [supported[0]!.runtime]
      : (ask(
          await p.multiselect({
            message: "For which agents?",
            options: supported.map((d) => ({
              value: d.runtime,
              label: RUNTIME_LABELS[d.runtime],
              hint: d.bin || d.dir ? "detected" : "not found",
            })),
            initialValues: defaults.runtimes,
            required: true,
          }),
        ) as Runtime[]);
  const settings: Record<string, string> = {};
  for (const s of item.settings) {
    const known = defaults.settings[s.key];
    // Say where a prefilled value came from: in a project it ends up in committed files.
    const from =
      known?.source === "discovered"
        ? project
          ? " (from your user config; written into the repository)"
          : " (from your existing config)"
        : "";
    const raw = ask(
      await p.text({
        message: `${s.message}${from}`,
        placeholder: s.placeholder,
        initialValue: known?.value ?? "",
        validate: (v) => (s.normalize(v ?? "") ? undefined : `Enter a value like ${s.placeholder}`),
      }),
    );
    const value = s.normalize(raw) ?? "";
    const warning = s.warning?.(value);
    if (warning) p.log.warn(warning);
    settings[s.key] = value;
  }
  const entry: CatalogEntry = {
    item: item.id,
    ...(project ? { project } : {}),
    runtimes,
    settings,
  };
  upsertEntry(config, entry);
  await applyWithConfirm(buildPlan(config, [entryKey(entry)]), config);
}

function statusFlow(): void {
  const entries = status();
  if (entries.length === 0) {
    p.log.info("Nothing installed yet.");
    return;
  }
  const color = { ok: pc.green, drifted: pc.yellow, missing: pc.red } as const;
  const lines = entries.map(
    ({ record, state }) =>
      `${color[state](state.padEnd(8))} ${pc.bold(record.runtime.padEnd(9))} ${record.label} ${pc.dim(tildify(record.path))}`,
  );
  p.note(lines.join("\n"), "Installed by agent-config");
}

function doctorFlow(): void {
  const lines = doctor().map(
    (c) => `${c.ok ? pc.green("✔") : pc.yellow("!")} ${c.name.padEnd(18)} ${pc.dim(c.detail)}`,
  );
  p.note(lines.join("\n"), "Doctor");
}

async function uninstallFlow(): Promise<void> {
  const entries = status();
  const installed = [...new Set(entries.map((e) => e.record.runtime))];
  if (installed.length === 0) {
    p.log.info("Nothing to uninstall.");
    return;
  }
  const runtimes = ask(
    await p.multiselect({
      message: "Uninstall from which agents?",
      options: installed.map((r) => ({ value: r, label: RUNTIME_LABELS[r] })),
      initialValues: installed,
      required: true,
    }),
  ) as Runtime[];
  if (
    !ask(await p.confirm({ message: "Remove agent-config files and restore what they replaced?" }))
  )
    return;
  await uninstallAndReport({ runtimes });
}

/** Uninstalls through the same path as the CLI; offers to remove files kept because you changed them. */
async function uninstallAndReport(selection: { key?: string; runtimes: string[] }): Promise<void> {
  let { results, restoreErrors } = uninstallSelection(selection);
  let kept = results.filter((r) => r.outcome === "kept-modified");
  p.log.success(`Undid ${results.length - kept.length} change(s).`);
  for (const k of kept) p.log.warn(`Kept ${tildify(k.record.path)}: ${k.note}`);
  if (kept.length > 0 && ask(await p.confirm({ message: "Remove the files you changed too?" }))) {
    ({ results, restoreErrors } = uninstallSelection(selection, true));
    kept = results.filter((r) => r.outcome === "kept-modified");
    p.log.success(`Removed ${results.length - kept.length} more.`);
  }
  for (const e of restoreErrors)
    p.log.error(`Could not restore ${e.op.label} (${tildify(e.op.path)}): ${e.error}`);
}

/** Returns true when a new version was installed and the TUI should exit. */
async function selfUpdateFlow(): Promise<boolean> {
  const spin = p.spinner();
  spin.start("Checking for a new version");
  const check = checkForUpdate();
  if (!check.updatable) {
    spin.stop("This copy cannot update itself");
    p.log.warn(check.reason ?? "unknown reason");
    return false;
  }
  const { current, latest, behind } = check;
  if ((behind === 0 || !latest) && !check.relocate) {
    spin.stop(`Already up to date: v${current.version} (${current.commit})`);
    return false;
  }
  spin.stop(
    behind === 0 || !latest
      ? `Up to date, but installed in the pre-rename location; updating moves it to the agent-config location`
      : `New version: v${latest.version} (${latest.commit}), ${behind} commit(s) newer than v${current.version} (${current.commit})`,
  );
  if (!ask(await p.confirm({ message: "Update agent-config now?" }))) return false;
  spin.start("Updating");
  const result = runUpdate(check);
  if (!result.ok) {
    spin.stop(pc.red(result.message));
    if (result.log.trim()) p.log.error(result.log.trim());
    return false;
  }
  spin.stop(result.message);
  if (
    status().length > 0 &&
    ask(
      await p.confirm({
        message:
          "Re-apply your saved configuration with the new version (agents, skill, instructions)?",
      }),
    )
  ) {
    const code = reapplyWithNewVersion(result.root);
    if (code !== 0)
      p.log.warn(`Re-applying exited with code ${code}; run \`agent-config install\` to retry.`);
  }
  p.log.info("Start agent-config again to use the new version.");
  return true;
}

export async function runTui(): Promise<number> {
  p.intro(`${pc.bgCyan(pc.black(" agent-config "))} ${pc.dim(`v${VERSION}`)}`);
  p.log.message(
    pc.dim(
      "Pick abilities from the catalog, such as the model ladder: route reads and edits to the cheapest capable model.",
    ),
  );
  try {
    for (;;) {
      const saved = loadConfig().catalog.length > 0;
      const choice = ask(
        await p.select({
          message: "What do you want to do?",
          options: [
            {
              value: "catalog",
              label: "Catalog",
              hint: `install, configure or remove: ${CATALOG.map((i) => i.id).join(", ")}`,
            },
            ...(saved
              ? [
                  {
                    value: "install",
                    label: "Re-apply installed items",
                    hint: "write the saved catalog items again, e.g. after an update",
                  },
                ]
              : []),
            { value: "status", label: "Status", hint: "what is installed and whether it changed" },
            { value: "doctor", label: "Doctor", hint: "check runtimes and prerequisites" },
            { value: "uninstall", label: "Uninstall", hint: "remove and restore" },
            {
              value: "self-update",
              label: "Update agent-config version",
              hint: `installed v${VERSION}; checks GitHub for a newer one`,
            },
            {
              value: "reset",
              label: "Reset ladder choices",
              hint: "back to the recommended parts and models; keeps installed items",
            },
            { value: "exit", label: "Exit" },
          ],
        }),
      );
      if (choice === "exit") break;
      if (choice === "install") await reapplyFlow();
      if (choice === "catalog") await catalogFlow();
      if (choice === "status") statusFlow();
      if (choice === "doctor") doctorFlow();
      if (choice === "uninstall") await uninstallFlow();
      if (choice === "self-update" && (await selfUpdateFlow())) break;
      if (choice === "reset") {
        saveConfig({ ...defaultConfig(), catalog: loadConfig().catalog });
        p.log.success("Ladder choices reset. Re-apply installed items to write them.");
      }
    }
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Cancelled.");
      return 130;
    }
    throw error;
  }
  p.outro("Done.");
  return 0;
}
