// The interactive flow: pick runtimes and components, choose models per rung, review the
// plan, apply. Ctrl+C at any prompt leaves without further changes.

import * as p from "@clack/prompts";
import pc from "picocolors";
import { buildPlan, detect, doctor, status, tildify } from "./commands.ts";
import { defaultConfig, loadConfig, saveConfig, type Config } from "./config.ts";
import {
  applyPlan,
  COMPONENTS,
  COMPONENT_LABELS,
  uninstall,
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

class Cancelled extends Error {}

function ask<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

const ACTION_COLOR: Record<Action, (s: string) => string> = {
  create: pc.green,
  update: pc.yellow,
  unchanged: pc.dim,
  skip: pc.dim,
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

async function installFlow(): Promise<void> {
  const config = loadConfig();
  const found = detect();
  const detected = found.filter((d) => d.bin || d.dir).map((d) => d.runtime);
  config.runtimes = ask(
    await p.multiselect({
      message: "Configure which agents?",
      options: found.map((d) => ({
        value: d.runtime,
        label: RUNTIME_LABELS[d.runtime],
        hint: d.bin || d.dir ? "detected" : "not found",
      })),
      initialValues: config.runtimes.length > 0 ? config.runtimes : detected,
      required: true,
    }),
  ) as Runtime[];

  const offered = COMPONENTS.filter((c) =>
    config.runtimes.some((r) => RUNTIME_COMPONENTS[r].includes(c)),
  );
  config.components = ask(
    await p.multiselect({
      message: "Install which parts?",
      options: offered.map((c) => ({ value: c, label: COMPONENT_LABELS[c] })),
      initialValues: config.components.filter((c) => offered.includes(c)),
      required: true,
    }),
  );

  await chooseModels(config, config.runtimes);
  if (config.components.includes("review-models")) await chooseReviewTiers(config);
  if (config.components.includes("read-guard") && config.runtimes.includes("claude")) {
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

  const plan = buildPlan(config);
  p.note(formatPlan(plan), "Plan");
  const changes = plan.filter((x) => x.action === "create" || x.action === "update").length;
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
    "Restart running agent sessions to pick up the new agents. Run `model-ladder status` any time; `model-ladder uninstall` undoes everything.",
  );
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
  p.note(lines.join("\n"), "Installed by model-ladder");
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
    !ask(await p.confirm({ message: "Remove model-ladder files and restore what they replaced?" }))
  )
    return;
  const results = uninstall((r) => runtimes.includes(r.runtime));
  const kept = results.filter((r) => r.outcome === "kept-modified");
  p.log.success(`Undid ${results.length - kept.length} change(s).`);
  for (const k of kept) p.log.warn(`Kept ${tildify(k.record.path)}: ${k.note}`);
  const config = loadConfig();
  config.runtimes = config.runtimes.filter((r) => !runtimes.includes(r));
  saveConfig(config);
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
  if (behind === 0 || !latest) {
    spin.stop(`Already up to date: v${current.version} (${current.commit})`);
    return false;
  }
  spin.stop(
    `New version: v${latest.version} (${latest.commit}), ${behind} commit(s) newer than v${current.version} (${current.commit})`,
  );
  if (!ask(await p.confirm({ message: "Update model-ladder now?" }))) return false;
  spin.start("Updating");
  const result = runUpdate(check);
  if (!result.ok) {
    spin.stop(pc.red("Update failed; the previous version is still installed"));
    if (result.log.trim()) p.log.error(result.log.trim());
    return false;
  }
  spin.stop(`Updated to v${latest.version} (${result.commit})`);
  if (
    status().length > 0 &&
    ask(
      await p.confirm({
        message:
          "Re-apply your saved configuration with the new version (agents, skill, instructions)?",
      }),
    )
  ) {
    const code = reapplyWithNewVersion();
    if (code !== 0)
      p.log.warn(`Re-applying exited with code ${code}; run \`model-ladder install\` to retry.`);
  }
  p.log.info("Start model-ladder again to use the new version.");
  return true;
}

export async function runTui(): Promise<number> {
  p.intro(`${pc.bgCyan(pc.black(" model-ladder "))} ${pc.dim(`v${VERSION}`)}`);
  p.log.message(
    pc.dim(
      "Route reads and edits to the cheapest capable model: fast → balanced → deep. The main session keeps the reasoning.",
    ),
  );
  try {
    for (;;) {
      const hasInstall = status().length > 0;
      const choice = ask(
        await p.select({
          message: "What do you want to do?",
          options: [
            {
              value: "install",
              label: hasInstall ? "Update configuration" : "Install",
              hint: "agents, skill, hooks, models",
            },
            { value: "status", label: "Status", hint: "what is installed and whether it changed" },
            { value: "doctor", label: "Doctor", hint: "check runtimes and prerequisites" },
            { value: "uninstall", label: "Uninstall", hint: "remove and restore" },
            {
              value: "self-update",
              label: "Update model-ladder version",
              hint: `installed v${VERSION}; checks GitHub for a newer one`,
            },
            {
              value: "reset",
              label: "Reset saved choices",
              hint: "back to the recommended ladder",
            },
            { value: "exit", label: "Exit" },
          ],
        }),
      );
      if (choice === "exit") break;
      if (choice === "install") await installFlow();
      if (choice === "status") statusFlow();
      if (choice === "doctor") doctorFlow();
      if (choice === "uninstall") await uninstallFlow();
      if (choice === "self-update" && (await selfUpdateFlow())) break;
      if (choice === "reset") {
        saveConfig({ ...defaultConfig(), runtimes: loadConfig().runtimes });
        p.log.success("Saved choices reset. Run Update to apply them.");
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
