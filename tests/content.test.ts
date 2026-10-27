import { expect, test } from "vite-plus/test";
import { agentBody, instructionsBlock, orchestratorBody, skillMarkdown } from "../src/content.ts";

const models = { fast: "f", balanced: "b", deep: "d" };

test("the model-ladder skill description triggers on delegation, reads and edits", () => {
  for (const runtime of ["claude", "opencode", "codex", "pi"] as const) {
    const description = /^description: (.*)$/m.exec(skillMarkdown(runtime, models, 350))?.[1];
    expect(description).toMatch(/^ALWAYS use this before/);
    expect(description).toContain("subagent");
    expect(description).toContain("reading");
    expect(description).toContain("editing");
  }
});

test("the skill lists every ladder role per rung, the orchestrator and their delegate commands", () => {
  const skill = skillMarkdown("opencode", models, 350);
  expect(skill).toContain(
    "| Rung | Reads | Explores | Research | Design | UX | Edits | Reviews | Model |",
  );
  expect(skill).toContain(
    "| deep | `ladder-read-deep` | `ladder-explorer-deep` | `ladder-researcher-deep` | `ladder-designer-deep` | `ladder-user-experience-deep` | `ladder-edit-deep` | `ladder-reviewer-deep` | d |",
  );
  expect(skill).toContain("goes to `ladder-orchestrator` (d)");
  expect(skill).toContain("medium and high: `ladder-reviewer-deep`");
  for (const role of ["explore", "research", "design", "ux", "review"])
    expect(skill).toContain(`agent-config delegate ${role} --runtime opencode`);
});

test("every role has its own prompt, and the orchestrator delegates instead of doing the I/O", () => {
  expect(agentBody("explore", "fast")).toContain("CHANGE POINTS:");
  expect(agentBody("research", "fast")).toContain("SOURCES:");
  expect(agentBody("review", "deep")).toContain("VERDICT: approve | changes");
  expect(agentBody("design", "fast")).toContain("DESIGN RULES:");
  expect(agentBody("ux", "fast")).toContain("CLICKS:");
  expect(agentBody("ux", "fast")).toContain("RECOVERY:");
  for (const role of ["read", "explore", "research", "design", "ux", "edit", "review"] as const)
    expect(agentBody(role, "fast")).toContain("never delegate further");
  const lead = orchestratorBody("pi", models);
  expect(lead).toContain("Review with a reviewer whose intelligence matches the risk");
  expect(lead).toContain(
    'agent-config delegate review --runtime pi --cwd <your worktree> --tier <rung for the risk> "<handoff>"',
  );
  expect(lead).toContain("You are the top-level reviewer");
  expect(instructionsBlock("codex", 350)).toContain(
    "agent-config delegate read|explore|research|design|ux|edit|review --runtime codex",
  );
  expect(lead).toContain("`ladder-designer-<rung>`");
  expect(lead).toContain("`ladder-user-experience-<rung>`");
});

test("every agent knows the team and hands off work that belongs to another agent", () => {
  for (const role of ["read", "explore", "research", "design", "ux", "edit", "review"] as const) {
    const body = agentBody(role, "balanced");
    expect(body).toContain("## Team");
    expect(body).toContain("HANDOFF: <agent>: <exact question or spec>");
    for (const agent of [
      "ladder-designer-<rung>",
      "ladder-user-experience-<rung>",
      "ladder-orchestrator",
      "planner-<rung>",
      "kaneo-scribe",
      "commit-writer",
    ])
      expect(body).toContain(`\`${agent}\``);
  }
  expect(orchestratorBody("claude", models)).toContain("## Team");
});
