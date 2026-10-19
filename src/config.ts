// The user's choices, saved so re-running (or `install` from a script) reproduces them.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COMPONENTS, type Component } from "./ops.ts";
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

export interface Config {
  version: 1;
  runtimes: Runtime[];
  components: Component[];
  tiers: Record<Runtime, TierMap>;
  reviewTiers: Record<ReviewLens, Tier>;
  minLines: number;
}

export function defaultConfig(): Config {
  return {
    version: 1,
    runtimes: [],
    components: [...COMPONENTS],
    tiers: {
      claude: defaultTierMap("claude"),
      opencode: defaultTierMap("opencode"),
      codex: defaultTierMap("codex"),
      pi: defaultTierMap("pi"),
    },
    reviewTiers: { ...DEFAULT_REVIEW_TIERS },
    minLines: DEFAULT_MIN_LINES,
  };
}

/** Loads the saved config over the defaults, dropping anything unrecognized. */
export function loadConfig(): Config {
  const config = defaultConfig();
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch {
    return config;
  }
  if (Array.isArray(raw.runtimes)) config.runtimes = raw.runtimes.filter(isRuntime);
  if (Array.isArray(raw.components)) {
    config.components = raw.components.filter((c): c is Component =>
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
  return config;
}

export function saveConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
