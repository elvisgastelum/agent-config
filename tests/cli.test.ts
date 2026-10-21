import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { read } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "model-ladder-cli-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const res = spawnSync("node", [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("i is the same command as install, including install <item>", () => {
  const plan = run("i", "--runtime", "codex", "--dry-run", "--json");
  expect(plan.code).toBe(0);
  expect(plan.stdout).toBe(run("install", "--runtime", "codex", "--dry-run", "--json").stdout);
  const item = run("i", "kaneo", "--runtime", "claude", "--url", "https://k.example.com", "--yes");
  expect(item.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
});

test("install, status and uninstall round-trip with --json", () => {
  const installed = run(
    "install",
    "--runtime",
    "claude",
    "--model",
    "claude:deep=claude-opus-5-5",
    "--yes",
    "--json",
  );
  expect(installed.code).toBe(0);
  expect(JSON.parse(installed.stdout).applied).toBe(true);
  expect(read(join(home, ".claude/agents/ladder-read-deep.md"))).toContain(
    "model: claude-opus-5-5",
  );
  expect(JSON.parse(read(join(home, ".config/agent-config/config.json"))).catalog).toEqual([
    { item: "model-ladder", runtimes: ["claude"], settings: {} },
  ]);

  const status = JSON.parse(run("status", "--json").stdout);
  expect(status.entries.length).toBeGreaterThan(0);
  expect(status.entries.every((e: { state: string }) => e.state === "ok")).toBe(true);

  const removed = run("uninstall", "--yes", "--json");
  expect(removed.code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-deep.md"))).toBe(false);
  expect(JSON.parse(run("status", "--json").stdout).entries).toEqual([]);
});

test("--dry-run writes nothing", () => {
  const res = run("install", "--runtime", "codex", "--dry-run");
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("ladder-read-fast");
  expect(existsSync(join(home, ".codex"))).toBe(false);
});

test("refuses to apply without --yes outside a terminal", () => {
  const res = run("install", "--runtime", "claude");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("--yes");
  expect(existsSync(join(home, ".claude"))).toBe(false);
});

test("usage errors exit 2", () => {
  expect(run("install", "--runtime", "vim").code).toBe(2);
  expect(run("install", "--model", "claude:huge=x").code).toBe(2);
  expect(run("frobnicate").code).toBe(2);
  expect(run().code).toBe(2);
});

test("uninstall exits 3 when it keeps a file you edited", () => {
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
  const agent = join(home, ".claude/agents/ladder-read-fast.md");
  writeFileSync(agent, "edited\n");
  const res = run("uninstall", "--yes");
  expect(res.code).toBe(3);
  expect(read(agent)).toBe("edited\n");
  expect(run("uninstall", "--yes", "--force").code).toBe(0);
  expect(existsSync(agent)).toBe(false);
});

test("install kaneo adds only the catalog item; catalog lists it; uninstall kaneo removes it", () => {
  const args = ["install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com/"];
  const dry = run(...args, "--dry-run");
  expect(dry.code).toBe(0);
  expect(dry.stdout).toContain("kaneo skill kaneo-work-tracking");
  expect(existsSync(join(home, ".claude"))).toBe(false);

  const installed = run(...args, "--yes", "--json");
  expect(installed.code).toBe(0);
  expect(JSON.parse(installed.stdout).applied).toBe(true);
  expect(read(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toContain("kaneo-scribe");
  expect(JSON.parse(read(join(home, ".claude.json"))).mcpServers.kaneo.url).toBe(
    "https://k.example.com/api/mcp",
  );
  // The ladder was not installed along with it.
  expect(existsSync(join(home, ".claude/agents/ladder-read-fast.md"))).toBe(false);

  const listed = JSON.parse(run("catalog", "--json").stdout);
  const kaneo = listed.items.find((i: { id: string }) => i.id === "kaneo");
  expect(kaneo.entries).toMatchObject([
    { scope: "user", runtimes: ["claude"], settings: { url: "https://k.example.com" } },
  ]);

  // Re-running reuses the saved URL and changes nothing.
  const again = run("install", "kaneo", "--yes", "--json");
  expect(again.code).toBe(0);
  expect(JSON.parse(again.stdout).applied).toBe(false);

  const removed = run("uninstall", "kaneo", "--yes", "--json");
  expect(removed.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(false);
  expect(existsSync(join(home, ".claude.json"))).toBe(false);
  const after = JSON.parse(run("catalog", "--json").stdout).items;
  expect(after.find((i: { id: string }) => i.id === "kaneo").entries).toEqual([]);
});

test("install commit adds the skill, a cheap commit-writer and the Claude guard; uninstall restores", () => {
  const memory = join(home, ".claude/CLAUDE.md");
  const legacy = [
    "# Mine",
    "",
    "<!-- BEGIN claude-commit-skill: managed by install.sh, edits inside this block are overwritten -->",
    "old rules",
    "<!-- END claude-commit-skill -->",
    "",
  ].join("\n");
  run("install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com", "--yes");
  writeFileSync(memory, `${read(memory)}\n${legacy}`);
  const before = read(memory);

  const rt = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);
  const installed = run("install", "commit", ...rt, "--yes", "--json");
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string }[];
  expect(plan.every((x) => x.item === "commit@user")).toBe(true);

  const skill = read(join(home, ".claude/skills/commit/SKILL.md"));
  expect(skill).toContain("name: commit");
  expect(skill).toContain('`subagent_type: "commit-writer"`');
  expect(read(join(home, ".claude/agents/commit-writer.md"))).toContain("model: claude-haiku-5-5");
  expect(read(join(home, ".codex/agents/commit-writer.toml"))).toContain(
    'model_reasoning_effort = "low"',
  );
  const opencode = read(join(home, ".config/opencode/agents/commit-writer.md"));
  expect(opencode).toContain("model: anthropic/claude-haiku-5-5");
  expect(opencode).toContain("edit: deny");
  expect(read(join(home, ".pi/agent/agents/commit-writer.md"))).toContain("thinking: low");
  expect(read(join(home, ".pi/agent/skills/commit/SKILL.md"))).toContain("commit-writer");

  // The old standalone block is replaced in place; kaneo's block stays.
  const claudeMd = read(memory);
  expect(claudeMd).toContain("<!-- BEGIN agent-config:commit:");
  expect(claudeMd).not.toContain("claude-commit-skill");
  expect(claudeMd).toContain("## No AI attribution in commits or pull requests");
  expect(claudeMd).toContain("<!-- BEGIN agent-config:kaneo:");
  expect(read(join(home, ".codex/AGENTS.md"))).toContain("No AI attribution");

  const guard = join(home, ".claude/hooks/agent-config/commit-guard.mjs");
  expect(existsSync(guard)).toBe(true);
  const settings = JSON.parse(read(join(home, ".claude/settings.json")));
  expect(settings.hooks.PreToolUse).toEqual([
    { matcher: "Bash", hooks: [{ type: "command", command: `node "${guard}"` }] },
  ]);
  expect(settings.attribution).toEqual({ commit: "", pr: "" });
  expect(settings.includeCoAuthoredBy).toBe(false);

  expect(JSON.parse(run("install", "commit", "--yes", "--json").stdout).applied).toBe(false);

  expect(run("uninstall", "commit", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/commit/SKILL.md"))).toBe(false);
  expect(existsSync(join(home, ".codex/agents/commit-writer.toml"))).toBe(false);
  expect(existsSync(guard)).toBe(false);
  expect(existsSync(join(home, ".claude/settings.json"))).toBe(false);
  // Like kaneo's, a migrated legacy block is not put back; the rest of the file is.
  expect(read(memory)).toBe(
    before.replace(/<!-- BEGIN claude-commit-skill[^]*$/, "").trimEnd() + "\n",
  );
});

test("install commit --project writes the guard into the repository's Claude settings", () => {
  const repo = mkdtempSync(join(tmpdir(), "agent-config-repo-"));
  try {
    const res = run("install", "commit", "--project", repo, "--runtime", "claude", "--yes");
    expect(res.code).toBe(0);
    expect(existsSync(join(repo, ".claude/skills/commit/SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".claude/agents/commit-writer.md"))).toBe(true);
    expect(read(join(repo, "CLAUDE.md"))).toContain("No AI attribution");
    const settings = JSON.parse(read(join(repo, ".claude/settings.json")));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-config/commit-guard.mjs"',
    );
    expect(existsSync(join(repo, ".claude/hooks/agent-config/commit-guard.mjs"))).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(run("uninstall", "commit", "--project", repo, "--yes").code).toBe(0);
    expect(existsSync(join(repo, ".claude/settings.json"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install continue adds a manual-only action per runtime that delegates to cheap agents", () => {
  // The old standalone installer's copy is replaced, and put back on uninstall.
  const skill = join(home, ".claude/skills/continue/SKILL.md");
  run("install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com", "--yes");
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, "old continue skill\n");

  const rt = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);
  const installed = run("install", "continue", ...rt, "--yes", "--json");
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string }[];
  expect(plan.every((x) => x.item === "continue@user")).toBe(true);

  const claude = read(skill);
  expect(claude).toContain("name: continue");
  expect(claude).toContain("disable-model-invocation: true");
  expect(claude).toContain('argument-hint: "[parallel [n]]"');
  expect(claude).toContain("`$ARGUMENTS`");
  expect(claude).toContain('`subagent_type: "kaneo-scribe"` (claude-haiku-5-5)');
  expect(claude).toContain('`subagent_type: "ladder-read-fast"`');
  expect(claude).toContain('`subagent_type: "commit-writer"`');
  expect(claude).toContain("each on the balanced rung (claude-sonnet-5-5)");
  expect(claude).toContain("every line after it is this run's brief");

  const opencode = read(join(home, ".config/opencode/commands/continue.md"));
  expect(opencode).toContain("`$ARGUMENTS`");
  expect(opencode).toContain("the task tool with the `kaneo-scribe` agent");
  expect(opencode).toContain("anthropic/claude-sonnet-5-5");
  expect(existsSync(join(home, ".config/opencode/skills/continue"))).toBe(false);

  const codex = read(join(home, ".codex/skills/continue/SKILL.md"));
  expect(codex).toContain("`$continue parallel <n>`");
  expect(codex).not.toContain("$ARGUMENTS");
  expect(codex).toContain("session model, medium effort");
  expect(read(join(home, ".codex/skills/continue/agents/openai.yaml"))).toBe(
    "policy:\n  allow_implicit_invocation: false\n",
  );

  const pi = read(join(home, ".pi/agent/prompts/continue.md"));
  expect(pi).toContain("`/continue parallel`");
  expect(pi).toContain("the subagent tool with the `commit-writer` agent");

  expect(JSON.parse(run("install", "continue", "--yes", "--json").stdout).applied).toBe(false);

  expect(run("uninstall", "continue", "--yes").code).toBe(0);
  expect(read(skill)).toBe("old continue skill\n");
  expect(existsSync(join(home, ".config/opencode/commands/continue.md"))).toBe(false);
  expect(existsSync(join(home, ".codex/skills/continue"))).toBe(false);
  expect(existsSync(join(home, ".pi/agent/prompts/continue.md"))).toBe(false);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
});

test("install continue --project writes each runtime's action into the repository", () => {
  const repo = mkdtempSync(join(tmpdir(), "agent-config-repo-"));
  try {
    const rt = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);
    expect(run("install", "continue", "--project", repo, ...rt, "--yes").code).toBe(0);
    for (const path of [
      ".claude/skills/continue/SKILL.md",
      ".opencode/commands/continue.md",
      ".agents/skills/continue/SKILL.md",
      ".agents/skills/continue/agents/openai.yaml",
      ".pi/prompts/continue.md",
    ]) {
      expect(existsSync(join(repo, path))).toBe(true);
    }
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(run("uninstall", "continue", "--project", repo, "--yes").code).toBe(0);
    expect(existsSync(join(repo, ".pi/prompts/continue.md"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install kick-off adds a manual-only action per runtime and a Claude guard hook", () => {
  const rt = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);
  const settingsPath = join(home, ".claude/settings.json");
  expect(run("install", "commit", "--runtime", "claude", "--yes").code).toBe(0);
  const installed = run("install", "kick-off", ...rt, "--yes", "--json");
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string }[];
  expect(plan.every((x) => x.item === "kick-off@user")).toBe(true);

  const claude = read(join(home, ".claude/skills/kick-off/SKILL.md"));
  expect(claude).toContain("name: kick-off");
  expect(claude).toContain("disable-model-invocation: true");
  expect(claude).toContain('argument-hint: "<kaneo-epic-or-ticket-url | ticket-code>"');
  expect(claude).toContain("`$ARGUMENTS`");
  expect(claude).toContain("Phase: diagnose");
  expect(claude).toContain("`ladder-read-deep` (claude-opus-5-5)");
  expect(claude).toContain("/continue parallel <N>");
  expect(claude).toContain("kick-off/<EPIC-ID>.md");
  expect(existsSync(join(home, ".claude/hooks/agent-config/kick-off-guard.mjs"))).toBe(true);
  const entries = JSON.parse(read(settingsPath)).hooks.PreToolUse as {
    matcher: string;
    hooks: { command: string }[];
  }[];
  const guard = entries.find((e) => e.hooks.some((h) => h.command.includes("kick-off-guard.mjs")));
  expect(guard?.matcher).toBe("Agent|Task|Bash|Write");

  expect(existsSync(join(home, ".config/opencode/commands/kick-off.md"))).toBe(true);
  expect(read(join(home, ".codex/skills/kick-off/SKILL.md"))).toContain("$continue parallel <N>");
  expect(existsSync(join(home, ".codex/skills/kick-off/agents/openai.yaml"))).toBe(true);
  expect(existsSync(join(home, ".pi/agent/prompts/kick-off.md"))).toBe(true);

  expect(JSON.parse(run("install", "kick-off", "--yes", "--json").stdout).applied).toBe(false);

  expect(run("uninstall", "kick-off", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kick-off"))).toBe(false);
  expect(existsSync(join(home, ".claude/hooks/agent-config/kick-off-guard.mjs"))).toBe(false);
  expect(existsSync(join(home, ".config/opencode/commands/kick-off.md"))).toBe(false);
  expect(existsSync(join(home, ".codex/skills/kick-off"))).toBe(false);
  expect(existsSync(join(home, ".pi/agent/prompts/kick-off.md"))).toBe(false);
  const after = JSON.parse(read(settingsPath)).hooks.PreToolUse as {
    hooks: { command: string }[];
  }[];
  const commands = after.flatMap((e) => e.hooks.map((h) => h.command));
  expect(commands.some((c) => c.includes("kick-off-guard.mjs"))).toBe(false);
  expect(commands.some((c) => c.includes("commit-guard.mjs"))).toBe(true);
});

test("install kick-off --project writes into the repository with a project-rooted hook", () => {
  const repo = mkdtempSync(join(tmpdir(), "agent-config-repo-"));
  try {
    const rt = ["claude", "opencode", "codex", "pi"].flatMap((r) => ["--runtime", r]);
    expect(run("install", "kick-off", "--project", repo, ...rt, "--yes").code).toBe(0);
    for (const path of [
      ".claude/skills/kick-off/SKILL.md",
      ".claude/hooks/agent-config/kick-off-guard.mjs",
      ".opencode/commands/kick-off.md",
      ".agents/skills/kick-off/SKILL.md",
      ".agents/skills/kick-off/agents/openai.yaml",
      ".pi/prompts/kick-off.md",
    ]) {
      expect(existsSync(join(repo, path))).toBe(true);
    }
    expect(read(join(repo, ".claude/settings.json"))).toContain(
      "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-config/kick-off-guard.mjs",
    );
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(run("uninstall", "kick-off", "--project", repo, "--yes").code).toBe(0);
    expect(existsSync(join(repo, ".pi/prompts/kick-off.md"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install model-ladder installs only the ladder; uninstall model-ladder keeps kaneo", () => {
  const kaneo = ["install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com"];
  expect(run(...kaneo, "--yes").code).toBe(0);
  const installed = run(
    "install",
    "model-ladder",
    "--runtime",
    "claude",
    "--model",
    "claude:deep=claude-opus-5-5",
    "--yes",
    "--json",
  );
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string }[];
  expect(plan.length).toBeGreaterThan(0);
  expect(plan.every((x) => x.item === "model-ladder@user")).toBe(true);
  expect(read(join(home, ".claude/agents/ladder-read-deep.md"))).toContain(
    "model: claude-opus-5-5",
  );

  const listed = JSON.parse(run("catalog", "--json").stdout);
  expect(listed.items.map((i: { id: string }) => i.id)).toEqual([
    "model-ladder",
    "kaneo",
    "commit",
    "continue",
    "kick-off",
    "statusline",
  ]);
  expect(listed.items[0].entries).toMatchObject([{ scope: "user", runtimes: ["claude"] }]);
  expect(run("catalog").stdout).toContain("install: agent-config install model-ladder\n");

  // A bare install re-applies both saved items and changes nothing.
  const again = run("install", "--yes", "--json");
  expect(again.code).toBe(0);
  expect(JSON.parse(again.stdout).applied).toBe(false);

  expect(run("uninstall", "model-ladder", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-deep.md"))).toBe(false);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  const saved = JSON.parse(read(join(home, ".config/agent-config/config.json"))).catalog;
  expect(saved.map((e: { item: string }) => e.item)).toEqual(["kaneo"]);
});

test("a bare install plans the ladder first, even when it was added after another item", () => {
  expect(
    run("install", "kaneo", "--runtime", "claude", "--url", "https://k.example.com", "--yes").code,
  ).toBe(0);
  expect(run("install", "model-ladder", "--runtime", "claude", "--yes").code).toBe(0);
  const plan = JSON.parse(run("install", "--dry-run", "--json").stdout).plan as { item: string }[];
  const firstKaneo = plan.findIndex((x) => x.item === "kaneo@user");
  expect(plan[0]?.item).toBe("model-ladder@user");
  expect(firstKaneo).toBeGreaterThan(0);
  expect(plan.slice(firstKaneo).every((x) => x.item === "kaneo@user")).toBe(true);
});

test("a partial runtime uninstall that keeps an edited ladder file does not put the removed ones back", () => {
  expect(run("install", "--runtime", "claude", "--runtime", "codex", "--yes").code).toBe(0);
  const edited = join(home, ".codex/agents/ladder-read-fast.toml");
  writeFileSync(edited, "edited\n");
  expect(run("uninstall", "--runtime", "codex", "--yes").code).toBe(3);
  expect(read(edited)).toBe("edited\n");
  expect(existsSync(join(home, ".codex/agents/ladder-read-balanced.toml"))).toBe(false);
  expect(existsSync(join(home, ".claude/agents/ladder-read-balanced.md"))).toBe(true);
  const saved = JSON.parse(read(join(home, ".config/agent-config/config.json"))).catalog;
  expect(saved).toMatchObject([{ item: "model-ladder", runtimes: ["claude"] }]);
  expect(run("uninstall", "--runtime", "codex", "--yes", "--force").code).toBe(0);
  expect(existsSync(edited)).toBe(false);
});

test("a bare install with nothing saved asks for a catalog item instead of installing the ladder", () => {
  const res = run("install", "--yes");
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("agent-config install model-ladder");
  expect(existsSync(join(home, ".claude"))).toBe(false);
});

test("install model-ladder refuses --project and --url", () => {
  const project = run("install", "model-ladder", "--project", home, "--runtime", "claude");
  expect(project.code).toBe(2);
  expect(project.stderr).toContain("user scope only");
  const url = run(
    "install",
    "model-ladder",
    "--url",
    "https://k.example.com",
    "--runtime",
    "claude",
  );
  expect(url.code).toBe(2);
  expect(url.stderr).toContain("--url does not apply to model-ladder");
  expect(existsSync(join(home, ".config/agent-config/config.json"))).toBe(false);
});

test("a 0.4.0 ladder install migrates to the model-ladder entry without reinstalling", () => {
  expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
  // Rewrite the state as 0.4.0 left it: runtimes saved on their own, records without an item.
  const cfg = join(home, ".config/agent-config/config.json");
  const manifest = join(home, ".local/state/agent-config/manifest.json");
  const config = JSON.parse(read(cfg));
  writeFileSync(cfg, JSON.stringify({ ...config, runtimes: ["claude"], catalog: [] }));
  const state = JSON.parse(read(manifest));
  for (const r of state.records) delete r.item;
  writeFileSync(manifest, JSON.stringify(state));

  const plan = JSON.parse(run("install", "--dry-run", "--json").stdout).plan;
  expect(plan.length).toBeGreaterThan(0);
  // Review models skip without Gentle AI agents; everything installed stays as it is.
  expect(plan.filter((x: { action: string }) => !["unchanged", "skip"].includes(x.action))).toEqual(
    [],
  );
  const listed = JSON.parse(run("catalog", "--json").stdout).items[0];
  expect(listed.entries).toMatchObject([{ runtimes: ["claude"], files: state.records.length }]);

  expect(run("uninstall", "model-ladder", "--yes").code).toBe(0);
  expect(existsSync(join(home, ".claude/agents/ladder-read-fast.md"))).toBe(false);
  expect(JSON.parse(run("status", "--json").stdout).entries).toEqual([]);
});

test("install kaneo --project writes into the repository and reuses the user's Kaneo URL", () => {
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { kaneo: { type: "http", url: "https://k.example.com/api/mcp" } },
    }),
  );
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const res = run("install", "kaneo", "--project", repo, "--runtime", "claude", "--yes");
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("from your user config");
    expect(res.stderr).toContain(repo);
    expect(JSON.parse(read(join(repo, ".mcp.json"))).mcpServers.kaneo.url).toBe(
      "https://k.example.com/api/mcp",
    );
    expect(existsSync(join(repo, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude/skills"))).toBe(false);
    expect(run("uninstall", "kaneo", "--project", repo, "--yes").code).toBe(0);
    expect(existsSync(join(repo, ".mcp.json"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("catalog usage errors exit 2", () => {
  const noUrl = run("install", "kaneo", "--runtime", "claude", "--yes");
  expect(noUrl.code).toBe(2);
  expect(noUrl.stderr).toContain("kaneo needs --url");
  expect(run("install", "nope", "--runtime", "claude").code).toBe(2);
  expect(run("install", "--url", "https://k.example.com", "--runtime", "claude").code).toBe(2);
  expect(run("uninstall", "kaneo", "--url", "https://k.example.com").code).toBe(2);
  const badUrl = run("install", "kaneo", "--runtime", "claude", "--url", "ftp://x");
  expect(badUrl.code).toBe(2);
  const ladderFlag = run("install", "kaneo", "--url", "https://k.example.com", "--min-lines", "9");
  expect(ladderFlag.stderr).toContain("configures the model ladder");
  expect(ladderFlag.code).toBe(2);
  expect(
    run("install", "kaneo", "--project", join(home, "missing"), "--url", "https://k.example.com")
      .code,
  ).toBe(2);
});

test("uninstall <item> --dry-run keeps the saved entry; apply <item> installs the item", () => {
  const cfg = join(home, ".config/agent-config/config.json");
  const applied = run(
    "apply",
    "kaneo",
    "--runtime",
    "claude",
    "--url",
    "https://k.example.com",
    "--yes",
  );
  expect(applied.code).toBe(0);
  expect(existsSync(join(home, ".claude/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
  rmSync(join(home, ".local/state/agent-config/manifest.json"));
  expect(run("uninstall", "kaneo", "--dry-run").code).toBe(0);
  expect(JSON.parse(read(cfg)).catalog).toHaveLength(1);
});

test("a partial runtime uninstall at project scope keeps the shared AGENTS.md block", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const url = ["--url", "https://k.example.com"];
    const rt = ["--runtime", "opencode", "--runtime", "codex"];
    expect(run("install", "kaneo", "--project", repo, ...rt, ...url, "--yes").code).toBe(0);
    // A file the user removed by hand is not brought back by the partial uninstall.
    rmSync(join(repo, ".codex/agents/kaneo-scribe.toml"));
    const res = run("uninstall", "kaneo", "--project", repo, "--runtime", "opencode", "--yes");
    expect(res.code).toBe(0);
    expect(read(join(repo, "AGENTS.md"))).toContain("<!-- BEGIN agent-config:kaneo");
    expect(existsSync(join(repo, ".opencode/skills/kaneo-work-tracking/SKILL.md"))).toBe(false);
    expect(existsSync(join(repo, ".agents/skills/kaneo-work-tracking/SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".codex/agents/kaneo-scribe.toml"))).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install kaneo warns about a plain http URL", () => {
  const res = run(
    "install",
    "kaneo",
    "--runtime",
    "claude",
    "--url",
    "http://k.example.com",
    "--yes",
  );
  expect(res.code).toBe(0);
  expect(res.stderr).toContain("not https");
});

test("a project whose directory is gone is skipped by install and forgotten by uninstall", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    const args = ["--project", repo, "--runtime", "claude", "--url", "https://k.example.com"];
    expect(run("install", "kaneo", ...args, "--yes").code).toBe(0);
    rmSync(repo, { recursive: true, force: true });

    const whole = run("install", "--runtime", "claude", "--yes");
    expect(whole.code).toBe(0);
    expect(whole.stderr).toContain("is gone");
    expect(existsSync(repo)).toBe(false);

    expect(run("uninstall", "kaneo", "--project", repo, "--yes").code).toBe(0);
    const listed = JSON.parse(run("catalog", "--json").stdout);
    expect(listed.items.find((i: { id: string }) => i.id === "kaneo").entries).toEqual([]);
    expect(run("install", "--runtime", "claude", "--yes").code).toBe(0);
    expect(existsSync(repo)).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a partial uninstall puts the shared block back into a pre-existing AGENTS.md", () => {
  const repo = mkdtempSync(join(tmpdir(), "model-ladder-repo-"));
  try {
    writeFileSync(join(repo, "AGENTS.md"), "# Our agents\n");
    const rt = ["--runtime", "opencode", "--runtime", "codex"];
    const url = ["--url", "https://k.example.com"];
    expect(run("install", "kaneo", "--project", repo, ...rt, ...url, "--yes").code).toBe(0);
    for (const runtime of ["opencode", "codex"]) {
      const left = run("uninstall", "kaneo", "--project", repo, "--runtime", runtime, "--yes");
      expect(left.code).toBe(0);
      if (runtime === "opencode") {
        const text = read(join(repo, "AGENTS.md"));
        expect(text).toContain("# Our agents");
        expect(text).toContain("<!-- BEGIN agent-config:kaneo");
      }
    }
    expect(read(join(repo, "AGENTS.md"))).toBe("# Our agents\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install statusline takes over the Claude status line; uninstall restores the previous one", () => {
  const settingsPath = join(home, ".claude/settings.json");
  const script = join(home, ".claude/statusline.sh");
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, "#!/bin/bash\necho old\n");
  const previous = { type: "command", command: `bash ${script}` };
  writeFileSync(settingsPath, `${JSON.stringify({ model: "opus", statusLine: previous })}\n`);

  // With no --runtime it defaults to Claude Code, the only runtime with a status line.
  const installed = run("install", "statusline", "--yes", "--json");
  expect(installed.code).toBe(0);
  const plan = JSON.parse(installed.stdout).plan as { item: string; runtime: string }[];
  expect(plan.every((x) => x.item === "statusline@user" && x.runtime === "claude")).toBe(true);
  expect(read(script)).toContain("zap-prompt");
  expect(JSON.parse(read(settingsPath)).statusLine).toEqual({
    type: "command",
    command: `bash "${script}"`,
  });

  expect(JSON.parse(run("install", "statusline", "--yes", "--json").stdout).applied).toBe(false);

  expect(run("uninstall", "statusline", "--yes").code).toBe(0);
  expect(read(script)).toBe("#!/bin/bash\necho old\n");
  expect(JSON.parse(read(settingsPath))).toEqual({ model: "opus", statusLine: previous });
});

test("install statusline refuses other runtimes and --project", () => {
  const codex = run("install", "statusline", "--runtime", "codex", "--yes");
  expect(codex.code).not.toBe(0);
  expect(codex.stderr).toContain("statusline supports only claude");
  const project = run("install", "statusline", "--project", home, "--yes");
  expect(project.code).not.toBe(0);
  expect(project.stderr).toContain("user scope only");
});
