# model-ladder

Objective: one-liner installable tool that configures Claude Code, OpenCode, Codex and Pi to route reads and edits to the cheapest capable model (Haiku 5.5 → Sonnet 5.5 → Opus 5.5) so the main session's context stays small. Branch: `main` (new repo, initial build). Delivery: single initial commit set, push is the user's decision. Test runner: `vp test` (Vitest).

## Specs

- S1. Analyze the reference post and apply its strategy: "delegate write and reads to a dumb llms models to not fill the context of the main smart llm session". Reference: https://portal.spotify.com/blog/portal-by-spotify-cut-my-claude-code-token-usage-by-90
- S2. Repo inside `~/Projects/github.com/elvisgastelum/<repo-name>` "with a good name for this", created with `vp create`, "use latest node lts pinned" (Node 24.22.0).
- S3. "a one-liner installable script using the patterns i like" (pattern: claude-curated-config `install.sh`: clone to `~/.local/share/<name>`, build, wrapper in `~/.local/bin`, start the TUI, rollback on failed update).
- S4. "To be able to configure claude, pi, codex, opencode, etc from running this scripts as needed with a good tui".
- S5. "The reads can scale from haiku 5.5, sonnet 5.5 up to opus 5.5" / "The edits can scale from haiku 5.5, sonnet 5.5 up to opus 5.5". Reads start at Haiku 5.5; edits mix Sonnet/Haiku by effort; Opus 5.5 only when a task "is getting issues to be completed as expected".
- S6. "The idea here is to use the right model for the right tasks always saving as much tokens as possible in the process".
- S7. "Reviews with gentle ai also get affected from this skills" — Gentle AI review lens agents get ladder model tiers.
- S8. "Add ability to uninstall this config if needed".
- Assumption A1: Codex cannot run Claude models; its tiers default to the configured Codex model with reasoning effort low/medium/high and are editable.
- Assumption A2: Gentle AI review agents are Gentle-AI-managed files; `gentle-ai sync` may overwrite the model; `status` reports drift and `install` reapplies.

## Tasks

- T1 [S2] scaffold + Node pin — inline — done
- T2 [S5,S6] tiers, agent prompts, skill and instructions content — inline — done
- T3 [S4,S7,S8] operation engine with manifest/backups, runtime adapters, review models, uninstall — inline — done
- T4 [S1,S6] Claude read-guard hook (shunt equivalent) — inline — done
- T5 [S4] CLI + clack TUI — inline — done
- T6 [S3,S8] install.sh one-liner with `--uninstall` — inline — done
- T7 [S1] README with post analysis — inline — done

Route evidence: all inline; units depend on the shared engine (no Writer trigger).

## Log

- L1 (2026-10-18, user): "Help me to analize this blog post from spotify where they apply a strategy to delegate write and reads to a dumb llms models to not fill the context of the main smart llm session / Create a repo inside ~/Projects/github.com/elvisgastelum/<repo-name> with a good name for this, with a one-liner installable script using the patterns i like. To be able to configure claude, pi, codex, opencode, etc from running this scripts as needed with a good tui / You can use a `vp create` command to be able to crete the project if needed, use latest node lts pinned, and read the vite plus llms.txt page to understand how to use it / The dumb model to use will be haiku-5.5 for reads, and we can have a mix between sonnet 5.5 and haiku 5.5 depending on the effort needed for the task, up to use opus 5.5 if the tasks is getting issues to be completed as expected / The reads can scale from haiku 5.5, sonnet 5.5 up to opus 5.5 / The edits can scale from haiku 5.5, sonnet 5.5 up to opus 5.5 / The idea here is to use the right model for the right tasks always saving as much tokens as possible in the process / Reviews with gentle ai also get affected from this skills / Add ability to uninstall this config if needed"
- L2 (2026-10-18, user): "Create a new repo for this, i will drop the current claude-curated-config repo later"
- L3 evidence: Claude subagents `~/.claude/agents/*.md` (`model:`); OpenCode `~/.config/opencode/agents/*.md` (`mode: subagent`, `model: provider/id`); Codex `~/.codex/agents/*.toml` (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`); Pi `~/.pi/agent/agents/*.md` (`model`, `thinking`, `tools`). Gentle AI review lenses: `~/.claude/agents/review-*.md` frontmatter, `~/.pi/gentle-ai/models.json`, `~/.pi/agent/subagents.json`, OpenCode `opencode.jsonc` `agent.review-*`. Claude hook input carries `agent_id`/`agent_type` only inside subagents.
- L4 Engram mirror pending: `mem_current_project` resolved cwd `/Users/dev`, not this repo.
- L5 (2026-10-18) evidence: `vp check` clean; `vp test` 25/25 (engine roundtrip incl. exact restore of CLAUDE.md, settings.json, review agent frontmatter, Pi/OpenCode review JSON; read guard; CLI --json/--dry-run/refusal/usage). `install.sh` end to end in a temp HOME from the local clone: install (24 ops, 0 errors), wrapper `status` 20 ok, `--uninstall` restored `CLAUDE.md` and `review-risk.md` byte-for-byte and removed checkout, wrapper and config. Fix after that run: uninstall now deletes JSON files and directories it created.
- L6 commits: initial `feat: add model-ladder cli, tui, ladder agents, read guard and installer`; follow-up for created-dir cleanup. Not pushed: no GitHub remote yet (user decision).
- L7 (2026-10-18) review: `gentle-ai review assess --base-ref <empty tree> --committed-only` → high (`review_due: high_risk`, 26 paths, 5261 lines incl. lockfile). Standing consent applied to target `sha256:0cc987df…216c`; START stopped with `lens_context_budget_exceeded` (no authority created). Native review needs smaller candidates; independent verifier launched for items 1 and 5 instead.
