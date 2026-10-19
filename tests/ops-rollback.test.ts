import { lstatSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { applyPlan, loadManifest } from "../src/ops.ts";
import { put, sandbox } from "./helpers.ts";

// Writes to a path containing "FAIL" throw, as on a full disk.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (String(path).includes("FAIL")) throw new Error("ENOSPC: no space left on device");
      return (fs.writeFileSync as (...a: unknown[]) => void)(path, ...rest);
    }) as typeof fs.writeFileSync,
  };
});

let box: ReturnType<typeof sandbox>;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => box.restore());

test("a write that fails after a broken symlink was replaced puts the symlink back", () => {
  const skills = join(box.home, ".codex/skills");
  put(join(skills, "keep.txt"), "x");
  const link = join(skills, "kaneo");
  symlinkSync(join(box.home, "gone"), link);
  const result = applyPlan([
    {
      op: {
        kind: "file",
        runtime: "codex",
        component: "skill",
        path: join(link, "FAIL.md"),
        content: "x\n",
        label: "skill",
      },
      action: "create",
    },
  ]);
  expect(result.errors).toHaveLength(1);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(loadManifest().records).toEqual([]);
});
