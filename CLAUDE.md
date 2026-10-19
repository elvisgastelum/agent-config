# agent-config

CLI + TUI (`agent-config`, alias `model-ladder`) that installs the model-ladder feature (ladder agents, skill, instructions, read-guard hook, Gentle AI review models) into Claude Code, OpenCode, Codex and Pi, and undoes it.

- `src/catalog.ts` optional items (`agi install kaneo`) at user or project scope, rendered into ordinary ops tagged with `item` ("kaneo@user", "kaneo@/repo"); `src/kaneo.ts` the kaneo skill, instructions block and `kaneo-scribe` agent. A catalog block owns its own markers (`markers` on block ops), so several blocks share CLAUDE.md / AGENTS.md / config.toml.
- `src/tiers.ts` rungs and default models; `src/content.ts` skill, instructions and agent prompts; `src/runtimes.ts` per-runtime file operations; `src/ops.ts` plan/apply/uninstall engine with manifest and backups; `src/tui.ts` clack TUI; `src/cli.ts` entry; `assets/read-guard.mjs` Claude hook (no dependencies, copied into `~/.claude/hooks`).
- Every write goes through an `Op` so uninstall can restore it. Never write agent config files directly. Installed items the configuration no longer produces are planned as `remove`.
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
