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

- T1 [S3] PV-1 named managed blocks in the ops engine — inline
- T2 [S1,S2] PV-2 kaneo content rendered per runtime with cheap-model delegation — inline
- T3 [S3,S4] PV-3 catalog item ops for every runtime and both scopes — inline
- T4 [S5] PV-4 CLI `install kaneo`, `uninstall kaneo`, `catalog` — inline
- T5 [S4] PV-5 TUI catalog section — inline
- T6 [S1] PV-6 README, CLAUDE.md, `vp pack` dist — inline

Route evidence: one feature in one module set; no Writer trigger (units depend on each other), so the parent writes inline.

## Log

- L1 (2026-10-18) Move to this agent-config repo the kaneo-work-tracking skill to make it installable from here being aware of the cheap models to extract context to kaneo and save tickets into kaneo using cheap subagents too, look at my repos to get the code from that place but follow the agent-config patterns to install the skill, create a section "catalog" to make this kaneo-work-tracking as a installable and uninstallable skill with his mcp for a system or project as selected by the user or running a simple `agi install kaneo` to add the new ability to the agents; i already created this project to track the agent-config repo work: https://kaneo.elvisgastelum.com/dashboard/workspace/hvGC20t2pPWwL3iamuq86zXJgvHchGXh/project/xt5aarkpa7iu44awxurrij3s
- L2 Kaneo tickets PV-1..PV-6 created by a Haiku subagent (blocks: PV-1→PV-3, PV-2→PV-3, PV-3→PV-4, PV-4→PV-5, PV-4→PV-6, PV-5→PV-6). The Kaneo project is named "Pilot V1.0".
