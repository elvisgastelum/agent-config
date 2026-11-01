// The fix-claude-code-permissions catalog item: its ID, title and the skill that tells an agent
// how to run `agent-config fix-claude-code` without ever seeing the admin password.

import { FIX_COMMAND } from "./macfix.ts";
import { T3_GATE, T3_SECTION_HEADING, T3_SERVER } from "./t3.ts";

/** The catalog item's ID, and the name of the skill it installs. */
export const MACFIX_ITEM = "fix-claude-code-permissions";
export const MACFIX_SKILL = MACFIX_ITEM;

export const MACFIX_TITLE = "Fix Claude Code Permissions (MacOS)";

const CMD = `agent-config ${FIX_COMMAND}`;

/** The skill: diagnose first, repair only on request, and keep the admin password out of the chat. */
export function macfixSkillMarkdown(): string {
  return `---
name: ${MACFIX_SKILL}
description: Use when the Claude Code binary on a Mac hangs or never starts (\`claude --version\` hangs, "AppleSystemPolicy: Security policy would not allow process", a stuck Gatekeeper prompt, a wedged syspolicyd), on this Mac or on another one over ssh with no GUI session. Diagnoses first, then repairs with \`${CMD}\`, taking the admin password without ever putting it in the chat or in a command.
---

# Fix Claude Code permissions (macOS)

The Claude Code binary is fine (Anthropic Developer ID, Team \`Q6L2SF6YDW\`, notarized); macOS holds its launch, usually because \`syspolicyd\` is wedged or a Gatekeeper prompt sits on a screen nobody can see. \`${CMD}\` repairs it without a GUI.

## Steps

1. Diagnose first. It changes nothing: \`${CMD} diagnose\`, or \`${CMD} remote <host> diagnose\` for another Mac (\`<host>\` is an ssh alias or \`user@host\`; the Mac needs agent-config installed and key-based ssh).
2. Exit codes: 0 launches fine (stop), 1 still failing, 2 refused (not Anthropic-signed and notarized, or no binary found: \`--binary PATH\`), 130 cancelled.
3. Only when the user asks for the repair, run \`fix\`. It removes \`com.apple.quarantine\` from that one binary, and only if the launch still hangs runs \`sudo killall syspolicyd\` (launchd respawns it). It stops as soon as \`claude --version\` works, never reboots and never touches other binaries.
4. If \`fix\` still fails: approve the binary on the machine (System Settings > Privacy & Security > Open Anyway) or reboot it. Check that remote login survives a reboot first (FileVault pre-boot login blocks ssh).

Options: \`--binary PATH\`, \`--timeout SECONDS\` (each launch test, default 20), \`--password-stdin\`, \`--password-file PATH\`.

## The admin password

The password is needed only for the \`sudo killall syspolicyd\` step, and only the user may provide it.

- Never ask for it in chat, never read it, and never put it in a command, an argument, an environment variable or a file you write. Never echo or log it.
- The user can type it hidden in the agent-config TUI (\`agent-config\`, then "Fix Claude Code permissions"): it goes to \`sudo -S\` and over ssh through stdin only, and is not saved.
- Or in a terminal: \`${CMD} remote <host> fix\` prompts without echo. On this Mac, a file from \`--password-file\` or a pipe into \`--password-stdin\` is the user's to create; do not create one for them.
- With passwordless sudo, \`fix\` needs no password at all.

${T3_SECTION_HEADING}

${T3_GATE}

When the repair needs the admin password, ask for it with \`request_secret\` (\`mcp__${T3_SERVER}__request_secret\` in Claude Code): it opens a private card, you never see the value, and with \`delivery:"file"\` it returns a private file path.

1. Run \`diagnose\` first and confirm the user wants the repair.
2. \`request_secret\` with \`label:"Admin password"\`, \`delivery:"file"\` and a \`reason\` naming the Mac (or host) and \`sudo killall syspolicyd\`. A cancel or timeout means no password: stop, or run \`fix\` without one only if the user says sudo is passwordless.
3. Run the repair with the path as the only trace of the secret: \`${CMD} remote <host> fix --password-file <path>\` for another Mac, \`${CMD} fix --password-file <path>\` for this one. The tool reads the first line, sends it to \`sudo -S\` through stdin and prints nothing of it.
4. Never \`cat\` the file, copy it, or paste its contents into any command. Report the exit code and the output lines, and a new \`request_secret\` for every new run.
`;
}
