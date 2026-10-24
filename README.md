# agent-config

Configure Claude Code, OpenCode, Codex and Pi from one TUI and a **catalog** of abilities you install on demand. The main one is the **model ladder** (`agi install model-ladder`):

Route reads and edits to the cheapest model that can do them, so your main agent session keeps its context (and your token budget) for reasoning.

```
reads  ─┐                          ┌─ fast      Haiku 5.5   first try
        ├─ ladder agents ──climb───┼─ balanced  Sonnet 5.5  after a partial reply or failed check
edits  ─┘                          └─ deep      Opus 5.5    last resort, then the main session takes over
```

It configures **Claude Code, OpenCode, Codex and Pi** from one TUI, sets the rungs for **Gentle AI review agents**, and undoes everything with one command.

Every ability is a catalog item, for your user config or (where it applies) one repository: `agi install model-ladder` adds the ladder, `agi install kaneo` adds Kaneo work tracking, `agi install commit` adds title-only commits drafted by a cheap model, `agi install continue` adds a `/continue` action that works the next Kaneo ticket, `agi install brief` adds a `/brief` action that prepares a `/continue` brief for a whole Kaneo epic, `agi install statusline` adds a compact Claude Code status line. See [Catalog](#catalog).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh | bash
```

Requires only **git** and **Node.js 22.13 or newer** (24 LTS recommended); the installer stops with a clear message if either is missing. The CLI ships prebuilt and self-contained in `dist/cli.mjs`, so nothing is installed or built on your machine: the installer clones to `~/.local/share/agent-config`, checks Node, adds `agent-config` to `~/.local/bin` (with `agi` as a short alias, linked to it unless another `agi` is already there) and opens the TUI. Update from the TUI (**Update agent-config version**), with `agent-config self-update` (or `agent-config update`, `agi u`), or by re-running the one-liner; a failed update rolls back to the previous version.

Non-interactive (scripts and agents):

```sh
curl -fsSL https://raw.githubusercontent.com/elvisgastelum/agent-config/main/install.sh \
  | bash -s -- install model-ladder --runtime claude --runtime opencode --yes --json
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

1. **Catalog**: pick an item, then install, update or uninstall it.
   - **Model ladder**: pick agents (detected ones are preselected), pick parts, pick models per rung (recommended ladder, keep current, or customize model and effort per rung), pick the rung for each Gentle AI review lens, set the read-guard threshold.
   - **Kaneo** (and other items): install it for your user or for one project directory, pick agents and settings (such as the Kaneo URL); or uninstall one copy.
2. A colored plan per agent: `create`, `update`, `unchanged`, `skip`, with the target path.
3. Confirm, apply, done. Choices are saved to `~/.config/agent-config/config.json`.

Also: **Re-apply installed items** (writes every saved item again), **Status** (each installed item: `ok`, `drifted`, `missing`), **Doctor** (runtimes, Codex `multi_agent`, Pi subagent support, drift), **Uninstall**, **Update agent-config version** (checks GitHub, shows the installed and new versions, updates with rollback if the new version does not run, then offers to re-apply your saved configuration), **Reset ladder choices** (recommended parts and models; installed items stay).

## Commands

| Command                                       | What it does                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-config`                                | Opens the TUI.                                                                                                                                                                                                                                                                       |
| `agent-config install`                        | Re-applies every saved catalog item and removes what an item this version no longer has installed; with nothing saved it asks you to add one. Asks to confirm. `agi i` is short for it.                                                                                              |
| `agent-config install <item>`                 | Adds a catalog item, e.g. `agi install model-ladder` or `agi install kaneo`. `--project <dir>` installs an item (not model-ladder) into one repository instead of your user config. See [Catalog](#catalog).                                                                         |
| `agent-config catalog`                        | Lists catalog items and where each one is installed.                                                                                                                                                                                                                                 |
| `agent-config status`                         | Lists what agent-config installed and whether it still matches.                                                                                                                                                                                                                      |
| `agent-config uninstall`                      | Undoes it. `--runtime` limits it to some agents.                                                                                                                                                                                                                                     |
| `agent-config uninstall <item>`               | Removes only that catalog item (`--project <dir>` for its project copy).                                                                                                                                                                                                             |
| `agent-config doctor`                         | Checks runtimes, prerequisites and which agent-config version wrote the installed files.                                                                                                                                                                                             |
| `agent-config config`                         | Prints the saved choices and their path.                                                                                                                                                                                                                                             |
| `agent-config self-update`                    | Updates agent-config itself from GitHub (`--dry-run` only checks). Then run `agent-config install` to re-apply your configuration with the new version: it rewrites what changed and removes what the new version no longer installs. `agent-config update` and `agi u` do the same. |
| `agent-config delegate <read\|edit> "<task>"` | Runs a ladder agent headlessly and prints only its reply. For agents that cannot spawn subagents. See below.                                                                                                                                                                         |

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

`--component`, `--model`, `--effort`, `--review` and `--min-lines` configure the model ladder: use them with `install model-ladder`. On a bare `install` they (and `--runtime`) install the ladder too, so scripts written before 0.5.0 that pass one of them keep working. A bare `install` with no flags and nothing saved no longer installs the ladder: it exits `2` and asks for an item.

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

Everything agent-config installs is a catalog item, installed per item and scope through one manifest, so `status` tracks it and uninstall restores what it replaced.

```sh
agi catalog                                     # items and where they are installed
agi install model-ladder                        # the ladder, for the detected agents
agi install kaneo --url https://kaneo.example.com   # user scope: every project
agi install kaneo --project .                   # one repository, committed with it
agi install commit                              # title-only commits, drafted by a cheap model
agi install continue                            # /continue: work the next Kaneo ticket end to end
agi install brief                               # /brief: prepare a /continue brief for a Kaneo epic
agi install planning                            # /planning: plan work with you, then tickets for /continue
agi install statusline                          # compact Claude Code status line
agi uninstall kaneo [--project .]               # remove that copy only
```

`--runtime` picks agents (default: the item's saved agents, else the ladder's agents, else detected). Settings come from the flag, else the saved entry, else what is already configured on the machine, else a prompt; outside a terminal a missing setting is a usage error. `agent-config install` without an item re-applies every saved catalog entry. A project entry whose directory is gone is skipped with a warning; `agi uninstall <item> --project <dir>` still forgets it.

### model-ladder

The ladder agents, routing skill, instructions block, read guard and review models described above, at user scope only (`--project` is refused). Configure it with the ladder flags or from the TUI. A ladder installed before 0.5.0 becomes this entry on the next run, with nothing reinstalled.

### kaneo

[Kaneo](https://kaneo.app) work tracking, moved here from [kaneo-work-tracking-skill](https://github.com/elvisgastelum/kaneo-work-tracking-skill):

- `kaneo-work-tracking` skill: stories, Fibonacci point labels, splitting with `blocks` relations, ticket identifiers such as `FEX-2`, branch names `FEX-2/short-description`, PR bodies that link the ticket, and epics: a task titled `Epic: <outcome>` labelled `epic`, with stories starting `Epic: <EPIC-ID>` and `Touches: <areas>` lines.
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

### commit

Title-only commits, moved here from [claude-commit-skill](https://github.com/elvisgastelum/claude-commit-skill):

- `commit` skill: every commit message is one title line (the repository's convention, else Conventional Commits) with no body, no trailers and no `Co-Authored-By` or `Generated with Claude Code` lines.
- Cheap models: the skill hands the staged diff to **`commit-writer`**, an agent on your fast rung at low thinking effort, which replies with one `TITLE:` line; the main session commits it. The diff never fills the main session. The writer runs only read-only git commands: the Claude one has Bash, Read, Grep and Glob, the OpenCode one cannot edit, the Codex one runs read-only.
- An always-on instructions block: no AI attribution in commits, PR titles, PR bodies or PR comments.
- Claude Code only: a `commit-guard` PreToolUse hook (Node, no dependencies) that denies `git commit` with trailers, heredocs, `-F`, a second `-m` or a multi-line message, and `attribution.commit`, `attribution.pr` set to `""` plus `includeCoAuthoredBy: false` in `settings.json`.

| Part            | User scope (Claude / OpenCode / Codex / Pi)                                | Project scope (`--project <dir>`)                                           |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| skill           | `<runtime dir>/skills/commit/`                                             | `.claude/skills/`, `.opencode/skills/`, `.agents/skills/`, `.pi/skills/`    |
| `commit-writer` | `<runtime dir>/agents/`                                                    | `.claude/agents/`, `.opencode/agents/`, `.codex/agents/`, `.pi/agents/`     |
| instructions    | `~/.claude/CLAUDE.md`, `AGENTS.md` of each runtime                         | `CLAUDE.md`, `AGENTS.md` (one shared block naming each agent that reads it) |
| guard, settings | `~/.claude/hooks/agent-config/commit-guard.mjs`, `~/.claude/settings.json` | `.claude/hooks/agent-config/commit-guard.mjs`, `.claude/settings.json`      |

A block left by the old standalone installer (`BEGIN claude-commit-skill`) is replaced in place. Its `~/.claude/hooks/commit-guard.sh` hook entry is left alone; remove it from `settings.json` once the agent-config guard is installed.

### continue

A manual action that works Kaneo tickets end to end, moved here from [claude-continue-skill](https://github.com/elvisgastelum/claude-continue-skill). Install `kaneo` and `commit` with it (and the model ladder for its read and edit agents).

- `/continue` (`$continue` in Codex) picks the next unblocked ticket, moves it to In Progress, branches `<IDENTIFIER>/<description>`, implements it with tests and docs, commits with the `commit` skill and opens the PR.
- `/continue [parallel [n] | parallel-wave]` (`$continue` with the same argument in Codex). `parallel [n]` (default 4) picks up to n tickets that do not block each other or touch the same area, builds each in its own worktree at `<repo-parent>/<repo-name>-worktrees/` with one sub-agent per ticket, then merges the PRs one at a time, bringing each branch up to date with the default branch first.
- `/continue parallel-wave` picks an open Kaneo epic (it asks which one when several can start in any order, and takes the recommendation when you skip), splits the epic's open stories into waves (no unfinished blocker; stories whose `Touches:` areas overlap move to the next wave), and builds the first wave in parallel worktrees through the brief phases: plan and risk on the deep rung, cheap edits, risk-routed review. It merges one by one into the integration branch (the epic's brief, else `dev` when `origin/dev` exists, else the default branch) and ends with a plain-language summary of what changed and what the next wave holds. One wave per run.
- Cheap models: Kaneo reads and writes go through `kaneo-scribe`, file, log and CI reads through `ladder-read-fast`, mechanical edits through the ladder edit agents and commit titles through `commit-writer`. Parallel workers run on your balanced rung instead of the session model. The main session keeps only the decisions.
- Never invoked by the model on its own: a Claude skill with `disable-model-invocation: true`, an OpenCode command, a Codex skill with `allow_implicit_invocation: false` in `agents/openai.yaml`, a Pi prompt template.

| Runtime  | User scope                                              | Project scope (`--project <dir>`)  |
| -------- | ------------------------------------------------------- | ---------------------------------- |
| Claude   | `~/.claude/skills/continue/SKILL.md`                    | `.claude/skills/continue/SKILL.md` |
| OpenCode | `~/.config/opencode/commands/continue.md`               | `.opencode/commands/continue.md`   |
| Codex    | `~/.codex/skills/continue/` (with `agents/openai.yaml`) | `.agents/skills/continue/`         |
| Pi       | `~/.pi/agent/prompts/continue.md`                       | `.pi/prompts/continue.md`          |

A `~/.claude/skills/continue/SKILL.md` left by the old standalone installer is replaced and put back on uninstall.

### brief

A manual action that reads a whole Kaneo epic, finds what is missing and writes a brief for `/continue`. It prepares the run; a fresh session that gets the brief does the work. Called `kick-off` before 0.16.0: a re-apply (`agi apply`) replaces the installed `/kick-off` with `/brief`. Install `kaneo`, `continue` and `commit` with it (and the model ladder for its read and diagnosis agents).

- `/brief <kaneo-epic-or-ticket-url | ticket-code>` (`$brief` in Codex) is never invoked by the model on its own.
- Step 1, what is missing to complete the epic: `kaneo-scribe` reads the epic and every related ticket (subtasks, related, blockers, done tickets and PR links); `ladder-read-deep` diagnoses the done and open tickets in dependency order, then finds missing tickets, gaps and parallel waves. The overview is shown to you.
- Step 2 asks four questions: create the missing tickets now, list them or leave them out; run parallel waves (`/continue parallel N`) or one ticket at a time; the integration branch (`dev`, the default branch or another); and review routing by risk (balanced for none or low, deep for medium or high), always deep, or fast for none risk.
- Step 3 writes a brief to `~/.local/state/agent-config/briefs/<EPIC-ID>.md` (`$XDG_STATE_HOME/agent-config/briefs`) and copies it with `pbcopy`, `wl-copy`, `xclip`, `xsel` or `clip.exe`. The brief starts with `/continue`, so a fresh session works the queue: Pick → Plan (deep, picks the edit rung, prefers fast) → Edit (fast or balanced, climbs) → Risk (deep: none, low, medium or high) → Review (routed by risk, never fast unless you approved it) → Fix until no findings (stops after 3 rounds) → PR into the integration branch, CI, merge, ticket Done → Next, until the epic's criteria are met.
- Every delegated handoff starts with `Phase: <phase>`. Claude's brief guard (a PreToolUse hook on `Agent|Task|Bash|Write`, Node, no dependencies) denies diagnose, plan and risk handoffs that are not on the deep rung, and reviews on fast unless the line right under the phase line is exactly `Fast review: approved by the user`. A brief must start with `/continue` and have every section: the guard checks a brief as it is written and again when it is copied. A command that copies to the clipboard and names a brief must be the copy alone, `pbcopy < <brief>` or `cat <brief> | pbcopy` (any clipboard tool, behind `env` or `sudo` too), so nothing in it can rewrite the brief after the check; a copy of a missing or incomplete brief is denied. It reads commands the way the shell splits them (pipelines, quotes, escapes, redirects, heredocs, `~` and environment variables) but cannot see a variable set inside the same command; such a copy goes through unchecked, like any input the guard cannot read. The guard reads the rung from `planner-<rung>` names too.
- `/continue` treats every line after its first as the run's brief.

| Runtime      | User scope (Claude / OpenCode / Codex / Pi)                               | Project scope (`--project <dir>`)                                     |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude       | `~/.claude/skills/brief/SKILL.md`                                         | `.claude/skills/brief/SKILL.md`                                       |
| OpenCode     | `~/.config/opencode/commands/brief.md`                                    | `.opencode/commands/brief.md`                                         |
| Codex        | `~/.codex/skills/brief/` (with `agents/openai.yaml`)                      | `.agents/skills/brief/`                                               |
| Pi           | `~/.pi/agent/prompts/brief.md`                                            | `.pi/prompts/brief.md`                                                |
| Claude guard | `~/.claude/hooks/agent-config/brief-guard.mjs`, `~/.claude/settings.json` | `.claude/hooks/agent-config/brief-guard.mjs`, `.claude/settings.json` |

### planning

A manual action that plans a project, epic, feature, fix or ticket with you before any work starts, keeping the plan in a SQLite store. Install `kaneo` with it to write Kaneo tickets, and `continue` and `kick-off` to run them (and the model ladder for its deep rung).

- `/planning [project | epic | feat | fix | ticket] <what to plan>` (`$planning` in Codex) is never invoked by the model on its own.
- It checks what agi installed (`agent-config catalog --json`) and whether the Kaneo MCP answers, then classifies the request on the deep rung.
- It interviews you in rounds of up to four questions. Each has a recommended answer and why it matters, in plain words; skipping a question takes the recommendation.
- Deep reviewers look for gaps, red flags and code smells through scope, design, risk, delivery and experience lenses, with at most 1 sub-agent at once for a fix or ticket, 2 for a feat, 3 for an epic and 5 for a project. For an epic or project the findings are reviewed again before you are asked about them.
- The item also installs three sub-agents, `planner-fast`, `planner-balanced` and `planner-deep`: one planning specialist on the fast, balanced and deep models from the ladder settings. Classification, gap reviews and every review run on `planner-deep`. Drafting starts on the kind's planner (fix and ticket `planner-fast`, feat and epic `planner-balanced`, project `planner-deep`); `planner-deep` reviews each draft, and a failed review (or an `escalate` reply) climbs one rung with every earlier finding passed along, like the model ladder. When the deep planner's draft still fails, its open findings go to you in the final review. Planners write the draft straight into the plan store.
- A final review repeats until nothing is open, or until you ask to write the tickets. Then each open gap becomes a `Gap:` ticket that blocks the work depending on it.
- The plan lives in a SQLite store at `.plans/<MM-yyyy>/<plan-title>/plan.sqlite`: facts, decisions, findings, epics, tickets, blocks, and a `waves` view, so agents query exactly what they need.
- With Kaneo it writes `Epic:` tasks and P5-or-smaller stories with `blocks` relations and `Touches:` lines, ready for `/continue parallel-wave` or `/brief`.
- Plans with a UI follow a design-system standard: every size token a multiple of 4 px, WCAG 2.2 AA accessibility, and scroll-driven motion as first-party components that animate only transform and opacity and honor `prefers-reduced-motion`.

| Runtime  | User scope                                              | Project scope (`--project <dir>`)  |
| -------- | ------------------------------------------------------- | ---------------------------------- |
| Claude   | `~/.claude/skills/planning/SKILL.md`                    | `.claude/skills/planning/SKILL.md` |
| OpenCode | `~/.config/opencode/commands/planning.md`               | `.opencode/commands/planning.md`   |
| Codex    | `~/.codex/skills/planning/` (with `agents/openai.yaml`) | `.agents/skills/planning/`         |
| Pi       | `~/.pi/agent/prompts/planning.md`                       | `.pi/prompts/planning.md`          |

The planner agents install beside the other agents as `agents/planner-<tier>.md` (Codex: `agents/planner-<tier>.toml`).

### statusline

A compact Claude Code status line styled after zap-prompt, moved here from [claude-statusline](https://github.com/elvisgastelum/claude-statusline). Claude Code only, user scope only; it needs `bash`, `git` and [`jq`](https://jqlang.org/).

```
⚡➜ my-project (* main) | Opus 5.5 | ctx 42% | 5h:12% 7d:30%
```

- Directory name, git branch with a red `*` when the working tree is dirty, model, context window usage, and 5-hour and 7-day rate-limit usage when Claude Code reports them.
- Writes `~/.claude/statusline.sh` and sets `statusLine` in `~/.claude/settings.json` to run it. Uninstall puts back the previous script and `statusLine`.
- The old standalone installer wrote the same path, so its copy is taken over in place. Edits to `~/.claude/statusline.sh` show as drifted in `status` and are saved to a backup when you reinstall.

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
vp run bump     # bump the version from the commits since the last release, rebuild dist/, commit
```

`vp run bump` reads the [Conventional Commits](https://www.conventionalcommits.org) since the last change to the `package.json` version: `fix`/`perf` bump the patch, `feat` the minor, and `!` or a `BREAKING CHANGE:` footer the major (the minor while the version is below 1.0.0). It writes the version, runs `vp pack` and commits `package.json` and `dist/` as `chore(release): <version>`, leaving any other change uncommitted. Pass `major`, `minor` or `patch` to choose the bump, `--dry-run` to only print it, and `--no-build` to skip `vp pack` (`vp run bump --dry-run`). `vpr bump` and `pnpm bump` work too.

`dist/cli.mjs` is committed and bundles every dependency, so `install.sh` runs it with Node alone. Tests run against a temporary `HOME`; nothing touches your real agent configuration.
