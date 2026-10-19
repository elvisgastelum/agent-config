import { expect, test } from "vite-plus/test";
import { skillMarkdown } from "../src/content.ts";

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
