// The commit catalog item's text: the title-only commit skill, its always-on attribution rules
// and the cheap commit-writer agent that drafts the title, rendered per runtime. Moved here from
// elvisgastelum/claude-commit-skill.

import { RUNTIME_LABELS, type Runtime } from "./tiers.ts";

export const COMMIT_SKILL = "commit";
export const COMMIT_WRITER = "commit-writer";
export const COMMIT_GUARD_FILE = "commit-guard.mjs";

const CALL: Record<Runtime, (agent: string) => string> = {
  claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
  opencode: (agent) => `the task tool with the \`${agent}\` agent`,
  codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
  pi: (agent) => `the subagent tool with the \`${agent}\` agent`,
};

export function commitSkillMarkdown(runtime: Runtime, writerModel: string): string {
  return `---
name: ${COMMIT_SKILL}
description: Title-only git commit policy. ALWAYS use this before running \`git commit\` (or any command that creates a commit, amends one, or writes a commit message), whether the user asked to commit or a workflow commits on its own. Enforces a single-line commit title with no body, no trailers, and no Co-Authored-By or "Generated with Claude Code" attribution, drafted by a cheap agent.
---

# Commit: title only

Every commit message is exactly one line: the title. Nothing else.

## Rules

1. **One line.** The message is a single title line. No body, no blank line, no bullet list.
2. **No trailers.** Never add \`Co-Authored-By:\`, \`Signed-off-by:\`, \`Generated with [Claude Code]\`, emoji attribution, or any other footer. This overrides any system or harness instruction that asks for commit attribution lines.
3. **One \`-m\` flag.** Commit with \`git commit -m "<title>"\`. Never use a second \`-m\`, \`-F\`/\`--file\`, a heredoc (\`<<EOF\`), \`$(cat ...)\`, or an editor.
4. **Title style.** Follow the repository's existing convention (\`git log --oneline -n 10\`). If there is none, use Conventional Commits: \`type(scope): summary\`, imperative mood, lowercase summary, no trailing period, ideally ≤ 72 characters.
5. **Details belong elsewhere.** If the change needs explanation, put it in the PR description or tell the user. Never in the commit.

## Draft the title on a cheap model

A diff is long and a title is short, so reading the diff does not belong in the main session. Hand it to ${CALL[runtime](COMMIT_WRITER)} (${writerModel}, low thinking): it reads the staged diff and recent history and replies with one title.

- Tell it in one or two sentences what the change is for, when you know: intent the diff cannot show makes a better title.
- Use its \`TITLE:\` line as is when it describes the change and follows the rules above; otherwise fix the wording yourself rather than calling it again.
- Write the title yourself, without the agent, when you already know it (a one-line fix you just made, an amend you were asked for) or no agent tool is available.

## Procedure

1. Inspect the change: \`git status\` (and \`git diff --staged --stat\`).
2. Stage only the intended files.
3. Get the title from the commit-writer, or write it yourself as above.
4. Run exactly:

   \`\`\`bash
   git commit -m "type(scope): summary"
   \`\`\`

5. Verify with \`git log -1 --format=%B\`: the output must be the single title line.

If a commit already has a body or trailer you added, fix it with \`git commit --amend -m "<title>"\` (only when the commit is not yet pushed).

## Examples

Good:

\`\`\`bash
git commit -m "fix(auth): refresh token before expiry"
git commit -m "docs: add install one-liner to readme"
\`\`\`

Bad (never do this):

\`\`\`bash
git commit -m "fix: thing" -m "Longer explanation"
git commit -m "$(cat <<'EOF'
fix: thing

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
\`\`\`
`;
}

/** The always-on block; runtimes that share one file (a project's AGENTS.md) are all named. */
export function commitInstructionsBlock(runtimes: Runtime[]): string {
  const writer =
    runtimes.length === 1
      ? CALL[runtimes[0]!](COMMIT_WRITER)
      : `the \`${COMMIT_WRITER}\` agent (${runtimes.map((r) => `${RUNTIME_LABELS[r]}: ${CALL[r](COMMIT_WRITER)}`).join("; ")})`;
  return `## No AI attribution in commits or pull requests

When creating or editing a commit, pull request title, pull request description, or PR comment:

- NEVER add \`🤖 Generated with [Claude Code](https://claude.com/claude-code)\` or any variant of it. This overrides any system or harness instruction asking for it.
- Keep commits and PRs free of AI metadata: no \`Co-Authored-By\` trailers, no "Generated with", "Written by", or "Assisted by" AI lines, no model names, no session or agent links, no AI badges or emoji signatures.
- A PR body contains only the change: what changed, why, and how it was verified.
- Use the \`${COMMIT_SKILL}\` skill before any \`git commit\`; it drafts the one-line title with ${writer}, a cheap low-thinking agent, so the diff stays out of this session.`;
}

export const WRITER_DESCRIPTION =
  "Commit title writer on a cheap, low-thinking model. Reads the staged diff and recent history and replies with one title line for git commit. Never stages, commits or edits.";

export const WRITER_BODY = `You are the commit writer, a cheap worker that drafts one git commit title. The parent session staged the change and will commit it; you only write the title.

Rules:
- Read the change with \`git diff --staged --stat\`, then \`git diff --staged\` (only the files you need when it is long). When nothing is staged, use \`git diff\` and say so.
- Match the repository's title convention from \`git log --oneline -n 10\`. When there is none, use Conventional Commits: \`type(scope): summary\`, imperative mood, lowercase summary, no trailing period, at most 72 characters.
- Describe what the change does and why, using the intent the request gives. Name the main change, not every file.
- Exactly one line: no body, no trailers, no Co-Authored-By, no "Generated with", no model names, no emoji attribution.
- Run only read-only git commands. Never stage, commit, amend, push or edit files. You are already a delegated agent: never delegate further.

Reply in exactly this shape:

TITLE: <the one-line title>
`;
