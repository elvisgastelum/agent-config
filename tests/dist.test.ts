import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// install.sh runs the committed dist/cli.mjs with Node alone, so it must be current and
// self-contained. Rebuild with `vp pack` and commit dist/ when this fails.
const root = join(import.meta.dirname, "..");
const committed = readFileSync(join(root, "dist", "cli.mjs"), "utf8");

test("dist/cli.mjs imports only Node built-ins", () => {
  const specifiers = [...committed.matchAll(/\bfrom\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/g)].map(
    (m) => m[1] ?? m[2],
  );
  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.filter((s) => !s?.startsWith("node:"))).toEqual([]);
});

test("dist/cli.mjs matches a fresh build", () => {
  const out = mkdtempSync(join(tmpdir(), "model-ladder-dist-"));
  try {
    execFileSync(join(root, "node_modules", ".bin", "vp"), ["pack", "--out-dir", out], {
      cwd: root,
      stdio: "ignore",
    });
    expect(readFileSync(join(out, "cli.mjs"), "utf8")).toBe(committed);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 60_000);
