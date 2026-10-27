// The ladder: every delegated read or edit starts on the cheapest rung that can do it
// and climbs one rung only when the work comes back incomplete or fails verification.

export const RUNTIMES = ["claude", "opencode", "codex", "pi"] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const TIERS = ["fast", "balanced", "deep"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * What a ladder agent does: answer a question, map code, research the web, extract design rules,
 * analyze user flows, write, or review.
 */
export const ROLES = ["read", "explore", "research", "design", "ux", "edit", "review"] as const;
export type Role = (typeof ROLES)[number];

/** The word each role puts in its agents' names: ladder-explorer-fast, ladder-reviewer-deep. */
const ROLE_STEMS: Record<Role, string> = {
  read: "read",
  explore: "explorer",
  research: "researcher",
  design: "designer",
  ux: "user-experience",
  edit: "edit",
  review: "reviewer",
};

/** The deep agent that leads one unit of work and hands its reads and writes to the ladder. */
export const ORCHESTRATOR = "ladder-orchestrator";

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Gentle AI review agents whose model this tool can set. */
export const REVIEW_LENSES = [
  "review-risk",
  "review-resilience",
  "review-readability",
  "review-reliability",
  "review-refuter",
] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];

export interface TierModel {
  /** Model id in the runtime's own syntax; empty means "inherit the session model". */
  model: string;
  effort: Effort;
}

export type TierMap = Record<Tier, TierModel>;

export const RUNTIME_LABELS: Record<Runtime, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
  pi: "Pi",
};

export const TIER_LABELS: Record<Tier, string> = {
  fast: "fast (first try, mechanical work)",
  balanced: "balanced (multi-step work, first escalation)",
  deep: "deep (last resort before the parent takes over)",
};

const CLAUDE_IDS = {
  fast: "claude-haiku-5-5",
  balanced: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
} as const;

export function defaultTierMap(runtime: Runtime): TierMap {
  const effort = { fast: "low", balanced: "medium", deep: "high" } as const;
  const model = (tier: Tier): string => {
    switch (runtime) {
      case "claude":
        return CLAUDE_IDS[tier];
      case "opencode":
      case "pi":
        return `anthropic/${CLAUDE_IDS[tier]}`;
      case "codex":
        // Codex cannot run Claude models: inherit the configured model and scale effort.
        return "";
    }
  };
  return {
    fast: { model: model("fast"), effort: effort.fast },
    balanced: { model: model("balanced"), effort: effort.balanced },
    deep: { model: model("deep"), effort: effort.deep },
  };
}

/** Which rung each Gentle AI review agent runs on. Readability is pattern work; the rest need judgment. */
export const DEFAULT_REVIEW_TIERS: Record<ReviewLens, Tier> = {
  "review-risk": "balanced",
  "review-resilience": "balanced",
  "review-readability": "fast",
  "review-reliability": "balanced",
  "review-refuter": "balanced",
};

export function agentName(role: Role, tier: Tier): string {
  return `ladder-${ROLE_STEMS[role]}-${tier}`;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

export function isRuntime(value: string): value is Runtime {
  return (RUNTIMES as readonly string[]).includes(value);
}

export function isReviewLens(value: string): value is ReviewLens {
  return (REVIEW_LENSES as readonly string[]).includes(value);
}
