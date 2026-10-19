# kaneo-catalog

Objective: move the kaneo-work-tracking skill into agent-config as the first installable and uninstallable catalog item (skill, instructions, MCP server, cheap scribe agent), at user or project scope. Branch: `PV-3/kaneo-catalog-item`. Delivery: ask-on-risk, work-unit commits; push and PR are the user's decision. Test runner: `vp test` (Vitest).

## Specs

- S1. "Move to this agent-config repo the kaneo-work-tracking skill to make it installable from here" — source: `elvisgastelum/kaneo-work-tracking-skill` (`skills/kaneo-work-tracking/SKILL.md`, `instructions/kaneo.md`, MCP entry `kaneo` = `<base-url>/api/mcp`).
- S2. "being aware of the cheap models to extract context to kaneo and save tickets into kaneo using cheap subagents too" — the skill routes context gathering to ladder read agents and Kaneo writes to a `kaneo-scribe` agent on the fast rung.
- S3. "follow the agent-config patterns to install the skill" — every write is a manifest-recorded `Op`, so uninstall restores what was there.
- S4. "create a section "catalog" to make this kaneo-work-tracking as a installable and uninstallable skill with his mcp for a system or project as selected by the user" — user scope (home config) or project scope (a repository directory), in the TUI and the CLI.
- S5. "or running a simple `agi install kaneo` to add the new ability to the agents" — plus `agi uninstall kaneo`.
- S6. Track the work in Kaneo project https://kaneo.elvisgastelum.com/dashboard/workspace/hvGC20t2pPWwL3iamuq86zXJgvHchGXh/project/xt5aarkpa7iu44awxurrij3s (slug `PV`).
- Assumption A1: Pi gets MCP through its MCP adapter at user scope (`~/.pi/agent/mcp.json`); project-scope Pi MCP is skipped because no project file is documented.
- Assumption A2: a pre-existing `kaneo-work-tracking-skill` block in CLAUDE.md is replaced in place by the agent-config block.

## Tasks

- T1 [S3] PV-1 named managed blocks in the ops engine — inline — done (0021aa2)
- T2 [S1,S2] PV-2 kaneo content rendered per runtime with cheap-model delegation — inline — done (0021aa2)
- T3 [S3,S4] PV-3 catalog item ops for every runtime and both scopes — inline (tests by ladder-edit-balanced) — done (0021aa2)
- T4 [S5] PV-4 CLI `install kaneo`, `uninstall kaneo`, `catalog` — inline — done (0021aa2)
- T5 [S4] PV-5 TUI catalog section — inline — done (0b3fd06)
- T6 [S1] PV-6 README, CLAUDE.md, `vp pack` dist — inline — done (10612c2)

Route evidence: one feature in one module set; no Writer trigger (units depend on each other), so the parent writes inline.

## Log

- L1 (2026-10-18) Move to this agent-config repo the kaneo-work-tracking skill to make it installable from here being aware of the cheap models to extract context to kaneo and save tickets into kaneo using cheap subagents too, look at my repos to get the code from that place but follow the agent-config patterns to install the skill, create a section "catalog" to make this kaneo-work-tracking as a installable and uninstallable skill with his mcp for a system or project as selected by the user or running a simple `agi install kaneo` to add the new ability to the agents; i already created this project to track the agent-config repo work: https://kaneo.elvisgastelum.com/dashboard/workspace/hvGC20t2pPWwL3iamuq86zXJgvHchGXh/project/xt5aarkpa7iu44awxurrij3s
- L2 Kaneo tickets PV-1..PV-6 created by a Haiku subagent (blocks: PV-1→PV-3, PV-2→PV-3, PV-3→PV-4, PV-4→PV-5, PV-4→PV-6, PV-5→PV-6). The Kaneo project is named "Pilot V1.0".
- L3 Evidence: `vp check` clean, `vp test` 95/95. Differential (bash, base origin/main vs branch, fresh HOMEs): install/status/uninstall/dry-run ladder outputs identical (645 lines). TUI smoke via expect reached "Apply 13 change(s)?" for project scope; cancel wrote nothing. Real-machine `install kaneo --dry-run`: URL discovered, existing MCP entries unchanged, legacy CLAUDE.md block updated in place. RED was not observed first: tests were written after the code.
- L4 Risk: item 3 (shared ops engine and buildPlan). Independent verifier launched, then native review (assess: high, review_due).
- L5 Independent verifier (Sonnet): S1-S6 and probes 1-6 pass, no blockers; advisory: uninstall after a legacy-block migration does not restore the old standalone block (A2 only asks for replacement in place).
- L6 Native review (risk + reliability) of origin/main..10612c2 approved and acknowledged; advisories fixed test-first in 6f5f74a (dry-run uninstall kept read-only, apply <item>, shared AGENTS.md block restored after partial uninstall; RED observed), then 8f67627 and 592ba5d (restore only removed paths, report restore errors, results printed before exit 1). Each fix commit reviewed (reliability), approved and acknowledged. Open non-blocking advisories: Pi scribe has no tool allowlist (documented in README), http Kaneo URLs accepted, TUI restore path and restore-failure exit untested. vp test 98/98, differential vs origin/main unchanged.
- L7 Next: push and PR are the user's decision; the PR body starts with the Kaneo PV-3 link and links PV-1, PV-2, PV-4, PV-5, PV-6.
