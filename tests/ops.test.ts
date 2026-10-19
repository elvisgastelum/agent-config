import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { buildPlan } from "../src/commands.ts";
import { defaultConfig, type Config } from "../src/config.ts";
import { applyPlan, BLOCK_BEGIN, uninstall } from "../src/ops.ts";
import type { Runtime } from "../src/tiers.ts";
import { put, read, sandbox } from "./helpers.ts";

let box: ReturnType<typeof sandbox>;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => box.restore());

function config(runtimes: Runtime[]): Config {
  return { ...defaultConfig(), runtimes };
}

function install(c: Config) {
  const result = applyPlan(buildPlan(c));
  expect(result.errors).toEqual([]);
  return result;
}

describe("install", () => {
  test("writes the six ladder agents per runtime with the rung models", () => {
    install(config(["claude", "opencode", "codex", "pi"]));
    const h = box.home;
    expect(read(join(h, ".claude/agents/ladder-read-fast.md"))).toContain(
      "model: claude-haiku-5-5",
    );
    expect(read(join(h, ".claude/agents/ladder-edit-balanced.md"))).toContain(
      "model: claude-sonnet-5-5",
    );
    expect(read(join(h, ".claude/agents/ladder-edit-deep.md"))).toContain("model: claude-opus-5-5");
    expect(read(join(h, ".claude/agents/ladder-read-fast.md"))).toContain(
      "tools: Read, Grep, Glob\n",
    );
    const oc = read(join(h, ".config/opencode/agents/ladder-read-fast.md"));
    expect(oc).toContain("mode: subagent");
    expect(oc).toContain("model: anthropic/claude-haiku-5-5");
    expect(oc).toContain("  edit: deny");
    const codex = read(join(h, ".codex/agents/ladder-read-deep.toml"));
    expect(codex).toContain('name = "ladder-read-deep"');
    expect(codex).toContain('model_reasoning_effort = "high"');
    expect(codex).toContain('sandbox_mode = "read-only"');
    expect(codex).not.toContain("model = ");
    const pi = read(join(h, ".pi/agent/agents/ladder-edit-fast.md"));
    expect(pi).toContain("model: anthropic/claude-haiku-5-5");
    expect(pi).toContain("thinking: low");
    expect(pi).toContain("  - edit");
    for (const dir of [".claude", ".config/opencode", ".codex", ".pi/agent"]) {
      expect(existsSync(join(h, dir, "skills/model-ladder/SKILL.md"))).toBe(true);
    }
  });

  test("is idempotent: a second plan has nothing to change", () => {
    const c = config(["claude", "opencode", "codex", "pi"]);
    install(c);
    const actions = new Set(buildPlan(c).map((x) => x.action));
    expect([...actions].filter((a) => a !== "unchanged" && a !== "skip")).toEqual([]);
  });

  test("a model change updates only the affected agent", () => {
    const c = config(["claude"]);
    install(c);
    c.tiers.claude.fast.model = "claude-sonnet-5-5";
    const changed = buildPlan(c).filter((x) => x.action === "update");
    expect(changed.map((x) => x.op.label)).toEqual([
      "ladder-read-fast (claude-sonnet-5-5)",
      "ladder-edit-fast (claude-sonnet-5-5)",
      "skill model-ladder",
    ]);
  });
});

describe("uninstall", () => {
  test("restores CLAUDE.md and settings.json exactly", () => {
    const h = box.home;
    const memory = "# Mine\n\nKeep this.\n";
    const settings = `{\n  "env": { "FOO": "1" },\n  "hooks": {\n    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "other" }] }]\n  }\n}\n`;
    put(join(h, ".claude/CLAUDE.md"), memory);
    put(join(h, ".claude/settings.json"), settings);
    install(config(["claude"]));

    expect(read(join(h, ".claude/CLAUDE.md"))).toContain(BLOCK_BEGIN);
    const applied = JSON.parse(read(join(h, ".claude/settings.json")));
    expect(applied.env).toEqual({ FOO: "1", MODEL_LADDER_MIN_LINES: "350" });
    expect(applied.hooks.PreToolUse).toHaveLength(2);

    const results = uninstall(() => true);
    expect(results.filter((r) => r.outcome === "kept-modified")).toEqual([]);
    expect(read(join(h, ".claude/CLAUDE.md"))).toBe(memory);
    expect(JSON.parse(read(join(h, ".claude/settings.json")))).toEqual(JSON.parse(settings));
    expect(existsSync(join(h, ".claude/agents/ladder-read-fast.md"))).toBe(false);
    expect(existsSync(join(h, ".claude/hooks/model-ladder/read-guard.mjs"))).toBe(false);
  });

  test("removes files it created, including a CLAUDE.md that did not exist", () => {
    install(config(["claude"]));
    uninstall(() => true);
    expect(existsSync(join(box.home, ".claude/CLAUDE.md"))).toBe(false);
    expect(existsSync(join(box.home, ".claude/settings.json"))).toBe(false);
    expect(existsSync(join(box.home, ".claude"))).toBe(false);
  });

  test("keeps directories that existed before install", () => {
    put(join(box.home, ".codex/config.toml"), "");
    install(config(["codex"]));
    uninstall(() => true);
    expect(existsSync(join(box.home, ".codex/config.toml"))).toBe(true);
    expect(existsSync(join(box.home, ".codex/agents"))).toBe(false);
    expect(existsSync(join(box.home, ".codex/skills"))).toBe(false);
  });

  test("restores a file it replaced from the backup", () => {
    const skill = join(box.home, ".claude/skills/model-ladder/SKILL.md");
    put(skill, "my own skill\n");
    install(config(["claude"]));
    expect(read(skill)).toContain("# Model ladder");
    uninstall(() => true);
    expect(read(skill)).toBe("my own skill\n");
  });

  test("keeps a file the user edited unless forced", () => {
    install(config(["claude"]));
    const agent = join(box.home, ".claude/agents/ladder-read-fast.md");
    put(agent, "edited\n");
    const results = uninstall(() => true);
    expect(results.find((r) => r.record.path === agent)?.outcome).toBe("kept-modified");
    expect(read(agent)).toBe("edited\n");
    uninstall(() => true, true);
    expect(existsSync(agent)).toBe(false);
  });

  test("only touches the selected runtime", () => {
    install(config(["claude", "codex"]));
    uninstall((r) => r.runtime === "codex");
    expect(existsSync(join(box.home, ".codex/agents/ladder-read-fast.toml"))).toBe(false);
    expect(existsSync(join(box.home, ".claude/agents/ladder-read-fast.md"))).toBe(true);
  });
});

describe("gentle ai review models", () => {
  const lens = (model: string) =>
    `---\nname: review-risk\ndescription: R1 Risk reviewer\nmodel: ${model}\ntools: []\n---\n\n# R1\n`;

  test("sets Claude review agents to their rung and restores the previous model", () => {
    const risk = join(box.home, ".claude/agents/review-risk.md");
    const readability = join(box.home, ".claude/agents/review-readability.md");
    put(risk, lens("sonnet"));
    put(readability, lens("sonnet").replace("review-risk", "review-readability"));
    install(config(["claude"]));
    expect(read(risk)).toContain("model: claude-sonnet-5-5\n");
    expect(read(readability)).toContain("model: claude-haiku-5-5\n");
    uninstall(() => true);
    expect(read(risk)).toBe(lens("sonnet"));
  });

  test("skips lenses Gentle AI did not install", () => {
    const plan = buildPlan(config(["claude"]));
    const review = plan.filter((x) => x.op.component === "review-models");
    expect(review.every((x) => x.action === "skip")).toBe(true);
  });

  test("leaves a model that gentle-ai sync changed after install", () => {
    const risk = join(box.home, ".claude/agents/review-risk.md");
    put(risk, lens("sonnet"));
    install(config(["claude"]));
    put(risk, lens("opus"));
    const results = uninstall(() => true);
    expect(results.find((r) => r.record.path === risk)?.outcome).toBe("kept-modified");
    expect(read(risk)).toBe(lens("opus"));
  });

  test("updates Pi models.json, subagents.json and OpenCode jsonc entries that exist", () => {
    const h = box.home;
    const models = join(h, ".pi/gentle-ai/models.json");
    put(
      models,
      JSON.stringify(
        { "review-risk": { model: "openai-codex/gpt-6-sol", thinking: "medium" } },
        null,
        2,
      ),
    );
    put(
      join(h, ".pi/agent/subagents.json"),
      JSON.stringify({ model_profiles: { "review-readability": { model: "x", effort: "low" } } }),
    );
    const jsonc = join(h, ".config/opencode/opencode.jsonc");
    const original = `{\n  // keep me\n  "agent": {\n    "review-risk": { "mode": "subagent" }\n  }\n}\n`;
    put(jsonc, original);
    install(config(["pi", "opencode"]));

    const m = JSON.parse(read(models));
    expect(m["review-risk"]).toEqual({ model: "anthropic/claude-sonnet-5-5", thinking: "medium" });
    expect(m["review-readability"]).toBeUndefined();
    const s = JSON.parse(read(join(h, ".pi/agent/subagents.json")));
    expect(s.model_profiles["review-readability"]).toEqual({
      model: "anthropic/claude-haiku-5-5",
      effort: "low",
    });
    expect(read(jsonc)).toContain("// keep me");
    expect(read(jsonc)).toContain('"model": "anthropic/claude-sonnet-5-5"');

    uninstall(() => true);
    expect(JSON.parse(read(models))["review-risk"].model).toBe("openai-codex/gpt-6-sol");
    expect(read(jsonc)).toContain("// keep me");
    expect(read(jsonc)).not.toContain("model");
  });
});
