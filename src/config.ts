// The user's choices, saved so re-running (or `install` from a script) reproduces them.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { catalogItem, type CatalogEntry } from "./catalog.ts";
import { COMPONENTS, LADDER_ITEM, type LadderComponent } from "./ops.ts";
import { configPath } from "./paths.ts";
import {
  DEFAULT_REVIEW_TIERS,
  EFFORTS,
  RUNTIMES,
  TIERS,
  defaultTierMap,
  isReviewLens,
  isRuntime,
  isTier,
  type ReviewLens,
  type Runtime,
  type Tier,
  type TierMap,
} from "./tiers.ts";

export const DEFAULT_MIN_LINES = 350;

/** The ladder's settings live here; which runtimes get it is its `model-ladder` catalog entry. */
export interface Config {
  version: 1;
  components: LadderComponent[];
  tiers: Record<Runtime, TierMap>;
  reviewTiers: Record<ReviewLens, Tier>;
  minLines: number;
  /** Catalog items to install, each at user scope or in one project. */
  catalog: CatalogEntry[];
}

export function defaultConfig(): Config {
  return {
    version: 1,
    components: [...COMPONENTS],
    tiers: {
      claude: defaultTierMap("claude"),
      opencode: defaultTierMap("opencode"),
      codex: defaultTierMap("codex"),
      pi: defaultTierMap("pi"),
    },
    reviewTiers: { ...DEFAULT_REVIEW_TIERS },
    minLines: DEFAULT_MIN_LINES,
    catalog: [],
  };
}

/** Loads the saved config over the defaults, dropping anything unrecognized. */
export function loadConfig(): Config {
  const config = defaultConfig();
  let raw: Partial<Config> & { runtimes?: unknown };
  try {
    raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch {
    return config;
  }
  if (Array.isArray(raw.components)) {
    config.components = raw.components.filter((c): c is LadderComponent =>
      (COMPONENTS as readonly string[]).includes(c),
    );
  }
  for (const runtime of RUNTIMES) {
    for (const tier of TIERS) {
      const saved = raw.tiers?.[runtime]?.[tier];
      if (!saved) continue;
      if (typeof saved.model === "string") config.tiers[runtime][tier].model = saved.model;
      if ((EFFORTS as readonly string[]).includes(saved.effort))
        config.tiers[runtime][tier].effort = saved.effort;
    }
  }
  for (const [lens, tier] of Object.entries(raw.reviewTiers ?? {})) {
    if (isReviewLens(lens) && typeof tier === "string" && isTier(tier))
      config.reviewTiers[lens] = tier;
  }
  if (typeof raw.minLines === "number" && raw.minLines > 0)
    config.minLines = Math.floor(raw.minLines);
  if (Array.isArray(raw.catalog)) config.catalog = raw.catalog.flatMap(catalogEntry);
  // Before 0.5.0 the ladder's runtimes were saved on their own; they become its catalog entry.
  const legacy = Array.isArray(raw.runtimes) ? raw.runtimes.filter(isRuntime) : [];
  if (legacy.length > 0 && !config.catalog.some((e) => e.item === LADDER_ITEM))
    config.catalog.unshift({ item: LADDER_ITEM, runtimes: legacy, settings: {} });
  return config;
}

/** A saved catalog entry, or nothing when it names an unknown item or is malformed. */
function catalogEntry(raw: unknown): CatalogEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const e = raw as Partial<CatalogEntry>;
  const item = typeof e.item === "string" ? catalogItem(e.item) : undefined;
  if (!item) return [];
  if (
    e.project !== undefined &&
    (typeof e.project !== "string" || !isAbsolute(e.project) || item.userOnly)
  )
    return [];
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.settings ?? {})) if (typeof v === "string") settings[k] = v;
  return [
    {
      item: item.id,
      ...(e.project ? { project: e.project } : {}),
      runtimes: Array.isArray(e.runtimes) ? e.runtimes.filter(isRuntime) : [],
      settings,
    },
  ];
}

export function saveConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
