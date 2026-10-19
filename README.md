# agent-config

Configure Claude Code, OpenCode, Codex and Pi from one TUI. The first feature is the **model ladder**:

Route reads and edits to the cheapest model that can do them, so your main agent session keeps its context (and your token budget) for reasoning.

```
reads  ─┐                          ┌─ fast      Haiku 5.5   first try
        ├─ ladder agents ──climb───┼─ balanced  Sonnet 5.5  after a partial reply or failed check
edits  ─┘                          └─ deep      Opus 5.5    last resort, then the main session takes over
```

It configures **Claude Code, OpenCode, Codex and Pi** from one TUI, sets the rungs for **Gentle AI review agents**, and undoes everything with one command.

A **catalog** adds optional abilities on demand, for your user config or one repository: `agi install kaneo` adds Kaneo work tracking. See [Catalog](#catalog).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh | bash
```

Requires only **git** and **Node.js 22.12 or newer** (24 LTS recommended); the installer stops with a clear message if either is missing. The CLI ships prebuilt and self-contained in `dist/cli.mjs`, so nothing is installed or built on your machine: the installer clones to `~/.local/share/agent-config`, checks Node, adds `agent-config` to `~/.local/bin` (with `agi` as a short alias, linked to it unless another `agi` is already there) and opens the TUI. Update from the TUI (**Update agent-config version**), with `agent-config self-update`, or by re-running the one-liner; a failed update rolls back to the previous version.

Non-interactive (scripts and agents):

```sh
curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh \
  | bash -s -- install --runtime claude --runtime opencode --yes --json
```

## Uninstall

```sh
agent-config uninstall                 # undo the agent configuration, keep the tool
curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh | bash -s -- --uninstall
                                       # undo it and remove the tool, its command and saved choices
```

Uninstall restores what agent-config replaced: backed-up files come back, JSON keys and frontmatter return to their previous values, the managed instruction block is cut out of `CLAUDE.md`/`AGENTS.md`. Edits are byte-precise: comments, indentation, symlinks and file permissions in your configs survive install and uninstall. Anything you (or `gentle-ai sync`) changed after installing is left alone and reported; `--force` removes edited ladder files anyway. While such files remain, `install.sh --uninstall` keeps the tool installed so `--uninstall --force` still works. Re-installing over a ladder file you edited saves your copy to `~/.local/state/agent-config/backups` first.

## The TUI

`agent-config` in a terminal:

1. **Install / Update**: pick agents (detected ones are preselected), pick parts, pick models per rung (recommended ladder, keep current, or customize model and effort per rung), pick the rung for each Gentle AI review lens, set the read-guard threshold.
2. A colored plan per agent: `create`, `update`, `unchanged`, `skip`, with the target path.
3. Confirm, apply, done. Choices are saved to `~/.config/agent-config/config.json`.

**Catalog**: pick an item, install it for your user or for one project directory, pick agents and settings (such as the Kaneo URL), review the plan and apply; or uninstall one copy.

Also: **Status** (each installed item: `ok`, `drifted`, `missing`), **Doctor** (runtimes, Codex `multi_agent`, Pi subagent support, drift), **Uninstall**, **Update agent-config version** (checks GitHub, shows the installed and new versions, updates with rollback if the new version does not run, then offers to re-apply your saved configuration), **Reset saved choices**.

## Commands

| Command                                       | What it does                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-config`                                | Opens the TUI.                                                                                                                                          |
| `agent-config install`                        | Applies the saved choices (or detected runtimes on first run). Asks to confirm.                                                                         |
| `agent-config install <item>`                 | Adds a catalog item, e.g. `agi install kaneo`. `--project <dir>` installs it into one repository instead of your user config. See [Catalog](#catalog).  |
| `agent-config catalog`                        | Lists catalog items and where each one is installed.                                                                                                    |
| `agent-config status`                         | Lists what agent-config installed and whether it still matches.                                                                                         |
| `agent-config uninstall`                      | Undoes it. `--runtime` limits it to some agents.                                                                                                        |
| `agent-config uninstall <item>`               | Removes only that catalog item (`--project <dir>` for its project copy).                                                                                |
| `agent-config doctor`                         | Checks runtimes and prerequisites.                                                                                                                      |
| `agent-config config`                         | Prints the saved choices and their path.                                                                                                                |
| `agent-config self-update`                    | Updates agent-config itself from GitHub (`--dry-run` only checks). Then run `agent-config install` to re-apply your configuration with the new version. |
| `agent-config delegate <read\|edit> "<task>"` | Runs a ladder agent headlessly and prints only its reply. For agents that cannot spawn subagents. See below.                                            |

| Flag                                            | Meaning                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `--runtime <id>`                                | `claude`, `opencode`, `codex`, `pi` (repeatable).                              |
| `--component <id>`                              | `agents`, `skill`, `instructions`, `read-guard`, `review-models` (repeatable). |
| `--model <runtime>:<tier>=<id>`                 | e.g. `--model claude:fast=claude-haiku-5-5`. Empty id means "session model".   |
| `--effort <runtime>:<tier>=<low\|medium\|high>` | Reasoning effort (Codex, Pi).                                                  |
| `--review <lens>=<tier>`                        | e.g. `--review review-risk=deep`.                                              |
| `--min-lines <n>`                               | Read-guard threshold (default 350).                                            |
| `--project <dir>`                               | Catalog item: install into or remove from this repository.                     |
| `--url <base-url>`                              | `kaneo`: Kaneo base URL, e.g. `https://kaneo.example.com`.                     |
| `--yes`, `--dry-run`, `--force`, `--json`       | Skip confirmation; preview; remove edited files on uninstall; machine output.  |

Exit codes: `0` ok, `1` a step failed, `2` usage error or refusal (for example `install` without `--yes` outside a terminal), `3` uninstall finished but kept files you edited (re-run with `--force`), `130` cancelled.

## What gets installed

| Part                                                | Claude Code                                       | OpenCode                                  | Codex                           | Pi                                                                 |
| --------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `agents`: `ladder-{read,edit}-{fast,balanced,deep}` | `~/.claude/agents/*.md`                           | `~/.config/opencode/agents/*.md`          | `~/.codex/agents/*.toml`        | `~/.pi/agent/agents/*.md`                                          |
| `skill`: routing rules                              | `~/.claude/skills/model-ladder/`                  | `~/.config/opencode/skills/model-ladder/` | `~/.codex/skills/model-ladder/` | `~/.pi/agent/skills/model-ladder/`                                 |
| `instructions`: always-on block                     | `~/.claude/CLAUDE.md`                             | `~/.config/opencode/AGENTS.md`            | `~/.codex/AGENTS.md`            | `~/.pi/agent/AGENTS.md`                                            |
| `read-guard`: hook                                  | `~/.claude/hooks/agent-config/` + `settings.json` | —                                         | —                               | —                                                                  |
| `review-models`                                     | `~/.claude/agents/review-*.md`                    | `opencode.jsonc` `agent.review-*.model`   | —                               | agent frontmatter, `~/.pi/gentle-ai/models.json`, `subagents.json` |

Read agents get read-only tools (Claude `Read, Grep, Glob`; OpenCode `edit: deny, bash: deny`; Codex `sandbox_mode = "read-only"`; Pi `read, grep, find, ls`). Edit agents can write and run one verify command, but no agent can spawn further agents.

**Default models**

| Rung     | Claude Code         | OpenCode, Pi                  | Codex                        |
| -------- | ------------------- | ----------------------------- | ---------------------------- |
| fast     | `claude-haiku-5-5`  | `anthropic/claude-haiku-5-5`  | session model, low effort    |
| balanced | `claude-sonnet-5-5` | `anthropic/claude-sonnet-5-5` | session model, medium effort |
| deep     | `claude-opus-5-5`   | `anthropic/claude-opus-5-5`   | session model, high effort   |

Codex cannot run Claude models, so its ladder climbs by reasoning effort. Set cheaper Codex models per rung in the TUI or with `--model codex:fast=<id>`.

**Gentle AI review lenses** default to: readability on fast; risk, resilience, reliability and the refuter on balanced. Gentle AI owns these files: `gentle-ai sync` may reset the model. `agent-config status` shows that as `drifted`; `agent-config install` reapplies it.

## Catalog

Optional abilities, installed per item and scope through the same manifest as the ladder, so `status` tracks them and uninstall restores what they replaced.

```sh
agi catalog                                     # items and where they are installed
agi install kaneo --url https://kaneo.example.com   # user scope: every project
agi install kaneo --project .                   # one repository, committed with it
agi uninstall kaneo [--project .]               # remove that copy only
```

`--runtime` picks agents (default: the item's saved agents, else your configured ones, else detected). Settings come from the flag, else the saved entry, else what is already configured on the machine, else a prompt; outside a terminal a missing setting is a usage error. `agent-config install` without an item re-applies the ladder and every saved catalog entry. A project entry whose directory is gone is skipped with a warning; `agi uninstall <item> --project <dir>` still forgets it.

### kaneo

[Kaneo](https://kaneo.app) work tracking, moved here from [kaneo-work-tracking-skill](https://github.com/elvisgastelum/kaneo-work-tracking-skill):

- `kaneo-work-tracking` skill: stories, Fibonacci point labels, splitting with `blocks` relations, ticket identifiers such as `FEX-2`, branch names `FEX-2/short-description`, and PR bodies that link the ticket.
- Cheap models: the skill gathers ticket context with `ladder-read-fast` and hands ticket writes and board summaries to **`kaneo-scribe`**, an agent on your fast rung that only has the Kaneo MCP tools, so Kaneo JSON never fills the main session.
- An always-on instructions block, and the `kaneo` MCP server at `<base-url>/api/mcp`. A pasted dashboard or MCP link is cut back to the base URL, and a non-local `http://` URL gets a warning. When you omit `--url`, the URL is reused from an existing `kaneo` entry in `~/.claude.json`, OpenCode or Pi; for `--project` installs agent-config says so, because the URL lands in files you commit.

| Part           | User scope (Claude / OpenCode / Codex / Pi)                                                                                 | Project scope (`--project <dir>`)                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| skill          | `<runtime dir>/skills/kaneo-work-tracking/`                                                                                 | `.claude/skills/`, `.opencode/skills/`, `.agents/skills/`, `.pi/skills/`    |
| `kaneo-scribe` | `<runtime dir>/agents/`                                                                                                     | `.claude/agents/`, `.opencode/agents/`, `.codex/agents/`, `.pi/agents/`     |
| instructions   | `~/.claude/CLAUDE.md`, `AGENTS.md` of each runtime                                                                          | `CLAUDE.md`, `AGENTS.md` (one shared block naming each agent that reads it) |
| MCP server     | `~/.claude.json` `mcpServers`, `opencode.jsonc` `mcp`, `~/.codex/config.toml` `[mcp_servers.kaneo]`, `~/.pi/agent/mcp.json` | `.mcp.json`, `opencode.json`, `.codex/config.toml`, `.pi/mcp.json`          |

The Claude scribe may call only Kaneo MCP tools, the OpenCode one cannot edit or run shell commands, the Codex one runs read-only, and the Pi one has only `tool_search`, which loads undeclared MCP tools such as Kaneo's (not `codemode`, whose scripts can run `bash`).

A block left by the old standalone installer (`BEGIN kaneo-work-tracking-skill`) is replaced in place. When `config.toml` already defines `[mcp_servers.kaneo]` itself, agent-config leaves it alone.

## How the routing works

The skill (and the short instruction block that points to it) tells the main session:

- **Reads** of many files, files over ~350 lines it will not edit, logs and test output go to `ladder-read-fast`, which answers in terse `path:line` bullets. Flow tracing across modules starts at balanced.
- **Edits** that can be specified in a few lines plus a reference file go to `ladder-edit-fast` (tests, boilerplate, config, mechanical changes) or `ladder-edit-balanced` (new logic in one module). The agent runs one verify command and replies with a change list, never the code; the main session reads the diff and verifies.
- **Climbing**: every agent replies `STATUS: done | partial | escalate`. One attempt per rung; climb on `partial`/`escalate` or a failed check; after deep fails the main session does it itself.
- **Never delegated**: line-exact reads before an edit (read the range with offset/limit), debugging, design, and changes to auth, data or concurrency.

The **read guard** (Claude Code) makes the read rule stick: a `PreToolUse` hook denies whole-file `Read`s and plain `cat`/`less`/large `head`/`tail` of files over the threshold in the main session, with a message pointing at `ladder-read-fast` or a ranged read. Quoted paths, `~`, `$HOME` and `VAR=value` prefixes are understood; subagents, ranged reads (including `bat -r`), pipes, other substitutions, images and PDFs pass. `AGENT_CONFIG_GUARD=off` disables it for a session.

## Delegating from agents that cannot spawn agents

Subagents and parallel workers usually cannot start subagents of their own, but they can run shell commands. `agent-config delegate` gives them the same ladder:

```sh
agent-config delegate read --runtime claude "Question: where is retry configured? Scope: src/. Answer shape: bullets with path:line. Budget: <= 300 words"
agent-config delegate edit --tier balanced --verify "pnpm test src/retry.test.ts" "Spec: ... Allowed edit surfaces: ... Reference: ..."
printf '%s' "<long handoff>" | agent-config delegate read -
```

- Runs the matching ladder agent through the runtime's own headless mode: `claude -p --agent`, `opencode run --agent`, `codex exec` (agent instructions inlined, `read-only` or `workspace-write` sandbox) or `pi -p`.
- **Tools:** read agents get read tools only. Claude and Pi pass the tool list on the command line. OpenCode relies on the installed agent file, so `delegate` refuses when that file is missing or no longer denies edit and bash. Edit agents can write files, and run a shell command only through `--verify "<command>"`. On Claude that is exactly that command. Pi cannot limit bash to one command, so it gets bash only when `--verify` is set, and Codex stays in its `workspace-write` sandbox.
- **Time:** `--timeout` limits one rung (default 600 s) and `--max-time` all rungs together (default 1200 s). A `running…` line on stderr shows each rung as it starts.
- **Edits that climb:** the next rung is told which files the previous attempt already changed (`git diff --stat`), so it continues from there instead of starting over.
- **Task input:** the task is the argument, or stdin when you pass `-`. Put a task that starts with `-` after `--` (`agent-config delegate read -- "- item"`); the runtimes that take the task as a bare argument also get it prefixed with `Task:` so they never read it as a flag. Stdin is never read implicitly, so an open, never-closing stdin cannot hang it. `--cwd` must be an existing directory, and delegate-only flags are refused on other commands (and vice versa) instead of being ignored.
- Climbs by itself: fast → balanced → deep when a reply is `partial` or `escalate` or the agent fails, passing the previous reply to the next rung. `--tier` picks the first rung; `--no-climb` stays on it.
- Prints only the final reply on stdout. Rung, model and timing go to stderr, and `--json` gives structured output. Exit codes: `0` done, `3` still partial after the last rung, `1` failed, `4` refused.
- **No nested delegation.** Every agent it starts gets `AGENT_CONFIG_DELEGATED=1`, and `delegate` refuses to run (exit `4`) when it sees that marker. Ladder agents are also told never to delegate further. This stops normal recursion. It is a guard, not a sandbox: an edit agent with a shell could still unset the variable.
- The runtime is `--runtime`, else `$AGENT_CONFIG_RUNTIME`, else Claude Code when it runs inside it, else your first configured runtime.

The skill and the instruction block tell agents to use it when they have no agent tool.

## Background: the Spotify Portal post

This project applies the strategy from [Portal by Spotify cut my Claude Code token usage by 90%](https://portal.spotify.com/blog/portal-by-spotify-cut-my-claude-code-token-usage-by-90):

- **The idea**: most agent work is I/O, not reasoning. Send it to a cheap worker model and keep the frontier model for thinking. They measured about 90% fewer tokens in Claude's context for multi-file questions on a Java monorepo.
- **Their mechanism**: two hosted Portal "modes" (`bulk-reader`, `code-writer`) on Gemini 2.5 Flash, called by scripts; skills telling Claude when to call them; and hooks (the `shunt` plugin) blocking full reads over 350 lines, so the routing holds even when Claude ignores the skill.
- **Their limits**: summaries lacked reliable line numbers, so edits still need a direct read of the target range; the worker missed a subtle thread-safety bug, so reasoning stays on the frontier model; each delegation is a 10–30 s round trip, so small reads stay inline; generated code needs a reference file to match conventions.

What agent-config changes:

| Spotify Portal                                            | agent-config                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| One hosted cheap model (Gemini Flash) behind a Portal API | Native subagents of each runtime, no extra service or credentials                                |
| One rung                                                  | Three rungs per role with explicit escalation, so hard work fails up instead of failing silently |
| Reads and boilerplate writes                              | Reads and edits; edit agents verify their own change and report a change list, not code          |
| Claude Code only                                          | Claude Code, OpenCode, Codex, Pi                                                                 |
| `shunt` hooks                                             | `read-guard` hook with the same threshold idea, subagent-aware                                   |
| —                                                         | Gentle AI review lenses on matching rungs                                                        |

Their limits carry over: delegation costs a fresh agent context and some latency, so tiny reads are cheaper inline, and the main session must still read exact ranges before editing.

## Renamed from model-ladder

This tool was called `model-ladder` until v0.3.0; the routing feature keeps that name (the `model-ladder` skill and the `ladder-*` agents). Updating an older install moves it over by itself: run `model-ladder self-update` (twice from v0.2.0: the first run fetches the version that knows how to move) or re-run the one-liner. It then:

- moves `~/.local/share/model-ladder`, `~/.config/model-ladder` and `~/.local/state/model-ladder` to their `agent-config` names, keeping the records uninstall needs;
- installs `agent-config` and keeps `model-ladder` as an alias, so agents and scripts that call the old name keep working;
- on the next `agent-config install`, replaces the read-guard hook under `~/.claude/hooks/model-ladder/`, the `MODEL_LADDER_MIN_LINES` setting and the old instruction-block markers with their new names instead of adding second copies.

`MODEL_LADDER_*` environment variables are still read when the `AGENT_CONFIG_*` one is not set. `agent-config doctor` warns while an install is still in the old location.

## Development

The development stack is [Vite+](https://viteplus.dev) (`vp`), with Node 24.22.0 pinned in `package.json` `devEngines` and `.node-version`. Users never need it.

```sh
vp install      # dependencies
vp check        # format, lint, type check
vp test         # tests (includes a check that dist/ is current)
vp pack         # rebuild dist/cli.mjs — commit it with your change
node src/cli.ts --help
```

`dist/cli.mjs` is committed and bundles every dependency, so `install.sh` runs it with Node alone. Tests run against a temporary `HOME`; nothing touches your real agent configuration.
