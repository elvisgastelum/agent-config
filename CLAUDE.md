# agent-config

CLI + TUI (`agent-config`, alias `model-ladder`) that installs catalog items into Claude Code, OpenCode, Codex and Pi, and undoes them. The main item is the model ladder (ladder agents, skill, instructions, read-guard hook, Gentle AI review models).

- `src/catalog.ts` the catalog (`agi install model-ladder`, `agi install kaneo`) at user or project scope, rendered into ordinary ops tagged with `item` ("model-ladder@user", "kaneo@/repo"). The `model-ladder` item is user scope only; its ops come from `runtimeOps` in `src/runtimes.ts` and keep their own components, and its parts and models are the top-level ladder settings in `Config`. Before 0.5.0 the ladder was installed on its own: `loadConfig` turns a saved `runtimes` list into its entry and `loadManifest` tags item-less ladder records. `src/kaneo.ts` the kaneo skill, instructions block and `kaneo-scribe` agent. `src/commit.ts` the commit skill, attribution block and `commit-writer` agent; `assets/commit-guard.mjs` its Claude hook. `src/continue.ts` the manual `/continue` action (Claude skill, OpenCode command, Codex skill, Pi prompt). `src/brief.ts` the manual `/brief` action (called `kick-off` before 0.16.0; `RENAMED_ITEMS` in `src/config.ts` reads old saved entries) and its brief template; `assets/brief-guard.mjs` its Claude hook. `src/loop.ts` the brief's per-ticket phases and model routing, shared with `/continue parallel-wave`. `src/planning.ts` the manual `/planning` action and the plan store schema `PLAN_SCHEMA`; it also holds the planner agents' prompts (`plannerBody`), and catalog agents render through `catalogAgent` in `src/catalog.ts` (one rung each, fast unless `tier` says otherwise). `assets/planning-guard.mjs` its Claude hook (`planningGuardOps` in `src/catalog.ts`, matcher `PLANNING_GUARD_MATCHER`): on from the first `/planning` in the transcript, it denies writes outside `.plans/`, shell writes, git history and branch writes and writer sub-agents. `assets/shell-split.mjs` the shell splitter the guard hooks share; `inlineShellSplit` inlines it into each installed hook, it is never installed on its own. A catalog block owns its own markers (`markers` on block ops), so several blocks share CLAUDE.md / AGENTS.md / config.toml.
- `src/tiers.ts` rungs and default models; `src/content.ts` skill, instructions and agent prompts; `src/runtimes.ts` per-runtime file operations; `src/ops.ts` plan/apply/uninstall engine with manifest and backups; `src/tui.ts` clack TUI; `src/cli.ts` entry; `assets/read-guard.mjs` Claude hook (no dependencies, copied into `~/.claude/hooks`).
- Every write goes through an `Op` so uninstall can restore it. Never write agent config files directly. Installed items the configuration no longer produces are planned as `remove`, and a full re-apply also removes records of catalog items the catalog no longer has (`retired` in `buildPlan`). Each manifest record keeps the `version` of agent-config that last wrote it; `doctor` reports records from another version.
- Renamed from model-ladder in 0.3.0: keep reading `MODEL_LADDER_*` (`setting()` in `src/paths.ts`), the legacy folders (`src/migrate.ts`), the legacy block markers (`src/ops.ts`) and the `model-ladder` command alias. The feature keeps its name: `model-ladder` skill, `ladder-*` agents.
- Tests use a temporary `HOME` (`tests/helpers.ts`); never point tests at real config.
- `install.sh` needs only git and Node: it clones and runs the committed, self-contained `dist/cli.mjs`. After changing `src/` or dependencies, run `vp pack` and commit `dist/` (a test fails when it is stale). Keep installer stdout clean for `--json`.
- Vite+ is the development stack only; never make users install pnpm, vp or dependencies.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
