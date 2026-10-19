// Idempotent file operations with a manifest, so everything written can be undone.
//
// Each operation records what it replaced (a backup file, or the previous JSON or
// frontmatter value). Uninstall restores that only while the target still holds the
// value model-ladder wrote; anything the user or another tool changed since is left alone.

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { statePaths } from "./paths.ts";
import type { Runtime } from "./tiers.ts";

export const COMPONENTS = [
  "agents",
  "skill",
  "instructions",
  "read-guard",
  "review-models",
] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<Component, string> = {
  agents: "Ladder agents (read + edit on fast, balanced, deep)",
  skill: "Routing skill (when to delegate, how to climb)",
  instructions: "Always-on instructions block (CLAUDE.md / AGENTS.md)",
  "read-guard": "Read guard hook: blocks full reads of large files (Claude Code)",
  "review-models": "Gentle AI review agents on ladder models",
};

interface OpBase {
  runtime: Runtime;
  component: Component;
  path: string;
  label: string;
}

export type Op =
  | (OpBase & { kind: "file"; content: string; executable?: boolean })
  | (OpBase & { kind: "block"; content: string })
  | (OpBase & { kind: "json-set"; pointer: string[]; value: unknown; requireParent?: boolean })
  | (OpBase & { kind: "json-hook"; event: string; matcher: string; command: string })
  | (OpBase & { kind: "frontmatter"; key: string; value: string; requireFile?: boolean });

export type Action = "create" | "update" | "unchanged" | "skip";

export interface PlannedOp {
  op: Op;
  action: Action;
  reason?: string;
}

export interface ManifestRecord {
  kind: Op["kind"];
  runtime: Runtime;
  component: Component;
  path: string;
  label: string;
  /** file: hash of the content written. */
  sha?: string;
  /** file: where the replaced file was saved. */
  backup?: string;
  /** block, json-set, json-hook: the file did not exist before model-ladder created it. */
  createdFile?: boolean;
  /** Directories model-ladder created for this path, deepest first; removed on uninstall when empty. */
  createdDirs?: string[];
  /** json-set: JSON pointer segments; frontmatter: the key. */
  pointer?: string[];
  key?: string;
  /** json-set / frontmatter: the value model-ladder wrote and what was there before. */
  value?: unknown;
  prev?: { present: boolean; value?: unknown };
  /** json-set: how many leading pointer segments existed before; deeper parents are pruned on uninstall when empty. */
  existingDepth?: number;
  /** json-hook */
  event?: string;
  command?: string;
}

export interface Manifest {
  version: 1;
  records: ManifestRecord[];
}

export const BLOCK_BEGIN =
  "<!-- BEGIN model-ladder: managed by model-ladder, edits inside this block are overwritten -->";
export const BLOCK_END = "<!-- END model-ladder -->";

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function writeAtomic(path: string, text: string, executable = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.model-ladder-tmp`;
  writeFileSync(tmp, text);
  if (executable) chmodSync(tmp, 0o755);
  renameSync(tmp, path);
}

export function recordKey(r: {
  kind: string;
  path: string;
  pointer?: string[];
  key?: string;
  command?: string;
}): string {
  return [r.kind, r.path, r.pointer?.join("/") ?? r.key ?? r.command ?? ""].join("\u0000");
}

function opKey(op: Op): string {
  switch (op.kind) {
    case "json-set":
      return recordKey({ kind: op.kind, path: op.path, pointer: op.pointer });
    case "frontmatter":
      return recordKey({ kind: op.kind, path: op.path, key: op.key });
    case "json-hook":
      return recordKey({ kind: op.kind, path: op.path, command: op.command });
    default:
      return recordKey({ kind: op.kind, path: op.path });
  }
}

// ---------------------------------------------------------------- manifest

export function loadManifest(): Manifest {
  const text = readText(statePaths().manifest);
  if (!text) return { version: 1, records: [] };
  const data = JSON.parse(text) as Manifest;
  return { version: 1, records: Array.isArray(data.records) ? data.records : [] };
}

export function saveManifest(manifest: Manifest): void {
  writeAtomic(statePaths().manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------- JSON helpers

function parseJson(path: string, text: string): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new Error(`${path} is not valid JSON; fix it and re-run.`);
  return value;
}

function getAt(root: unknown, pointer: string[]): { present: boolean; value?: unknown } {
  let node: unknown = root;
  for (const seg of pointer) {
    if (node === null || typeof node !== "object" || !(seg in (node as Record<string, unknown>))) {
      return { present: false };
    }
    node = (node as Record<string, unknown>)[seg];
  }
  return { present: true, value: node };
}

function existingPrefix(root: unknown, pointer: string[]): number {
  let depth = 0;
  while (depth < pointer.length - 1 && getAt(root, pointer.slice(0, depth + 1)).present) depth++;
  return depth;
}

/** Removes the now-empty parent objects model-ladder created for a key. */
function pruneParents(text: string, pointer: string[], keepDepth: number): string {
  let out = text;
  for (let depth = pointer.length - 1; depth > keepDepth; depth--) {
    const parent = pointer.slice(0, depth);
    const got = getAt(parseJson("json", out), parent);
    if (
      !got.present ||
      got.value === null ||
      typeof got.value !== "object" ||
      Object.keys(got.value).length > 0
    )
      break;
    out = setJson(out, parent, undefined);
  }
  return out;
}

function setJson(text: string, pointer: (string | number)[], value: unknown): string {
  return applyEdits(text, modify(text, pointer, value, FORMAT));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------- frontmatter helpers

interface Frontmatter {
  lines: string[];
  start: number; // index of first line after opening ---
  end: number; // index of closing ---
}

function splitFrontmatter(text: string): Frontmatter | undefined {
  const lines = text.split("\n");
  if (lines[0] !== "---") return undefined;
  const end = lines.indexOf("---", 1);
  if (end < 0) return undefined;
  return { lines, start: 1, end };
}

function frontmatterLine(fm: Frontmatter, key: string): number {
  for (let i = fm.start; i < fm.end; i++) {
    if (fm.lines[i]?.startsWith(`${key}:`)) return i;
  }
  return -1;
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

export function getFrontmatter(text: string, key: string): { present: boolean; value?: string } {
  const fm = splitFrontmatter(text);
  if (!fm) return { present: false };
  const i = frontmatterLine(fm, key);
  if (i < 0) return { present: false };
  return { present: true, value: unquote((fm.lines[i] ?? "").slice(key.length + 1)) };
}

export function setFrontmatter(text: string, key: string, value: string | undefined): string {
  const fm = splitFrontmatter(text);
  if (!fm) throw new Error("file has no frontmatter");
  const i = frontmatterLine(fm, key);
  const lines = [...fm.lines];
  if (value === undefined) {
    if (i >= 0) lines.splice(i, 1);
  } else if (i >= 0) {
    lines[i] = `${key}: ${value}`;
  } else {
    const after = frontmatterLine(fm, "description");
    lines.splice(after >= 0 ? after + 1 : fm.end, 0, `${key}: ${value}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- managed block helpers

export function stripBlock(text: string): string {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin < 0) return text;
  const endIdx = text.indexOf(BLOCK_END, begin);
  if (endIdx < 0) return text;
  const before = text.slice(0, begin).replace(/\n+$/, "");
  const after = text.slice(endIdx + BLOCK_END.length).replace(/^\n+/, "");
  if (!before) return after;
  return after ? `${before}\n\n${after}` : `${before}\n`;
}

export function withBlock(text: string, content: string): string {
  const block = `${BLOCK_BEGIN}\n${content.trim()}\n${BLOCK_END}\n`;
  const begin = text.indexOf(BLOCK_BEGIN);
  const endIdx = begin >= 0 ? text.indexOf(BLOCK_END, begin) : -1;
  if (begin >= 0 && endIdx >= 0) {
    const tail = text.slice(endIdx + BLOCK_END.length).replace(/^\n/, "");
    return `${text.slice(0, begin)}${block}${tail}`;
  }
  if (!text.trim()) return block;
  return `${text.replace(/\n*$/, "")}\n\n${block}`;
}

// ---------------------------------------------------------------- hooks helpers

interface HookGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

function hookGroups(root: unknown, event: string): HookGroup[] {
  const got = getAt(root, ["hooks", event]);
  return got.present && Array.isArray(got.value) ? (got.value as HookGroup[]) : [];
}

function hasHook(root: unknown, event: string, matcher: string, command: string): boolean {
  return hookGroups(root, event).some(
    (g) => g.matcher === matcher && (g.hooks ?? []).some((h) => h.command === command),
  );
}

function removeHook(text: string, event: string, command: string): string {
  const root = parseJson("settings", text);
  const groups = hookGroups(root, event);
  const next = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => h.command !== command) }))
    .filter((g) => g.hooks.length > 0);
  if (next.length === groups.length && deepEqual(next, groups)) return text;
  let out = setJson(text, ["hooks", event], next.length > 0 ? next : undefined);
  const hooks = getAt(parseJson("settings", out), ["hooks"]);
  if (hooks.present && hooks.value && Object.keys(hooks.value as object).length === 0) {
    out = setJson(out, ["hooks"], undefined);
  }
  return out;
}

// ---------------------------------------------------------------- plan

export function planOp(op: Op): PlannedOp {
  const current = readText(op.path);
  switch (op.kind) {
    case "file":
      if (current === undefined) return { op, action: "create" };
      return { op, action: current === op.content ? "unchanged" : "update" };
    case "block": {
      if (current === undefined) return { op, action: "create" };
      return { op, action: withBlock(current, op.content) === current ? "unchanged" : "update" };
    }
    case "json-set": {
      if (current === undefined) {
        if (op.requireParent) return { op, action: "skip", reason: "not installed" };
        return { op, action: "create" };
      }
      const root = parseJson(op.path, current);
      if (op.requireParent && !getAt(root, op.pointer.slice(0, -1)).present) {
        return { op, action: "skip", reason: "not installed" };
      }
      const got = getAt(root, op.pointer);
      if (got.present && deepEqual(got.value, op.value)) return { op, action: "unchanged" };
      return { op, action: got.present ? "update" : "create" };
    }
    case "json-hook": {
      if (current === undefined) return { op, action: "create" };
      const root = parseJson(op.path, current);
      return {
        op,
        action: hasHook(root, op.event, op.matcher, op.command) ? "unchanged" : "update",
      };
    }
    case "frontmatter": {
      if (current === undefined) return { op, action: "skip", reason: "not installed" };
      if (!splitFrontmatter(current)) return { op, action: "skip", reason: "no frontmatter" };
      const got = getFrontmatter(current, op.key);
      return { op, action: got.present && got.value === op.value ? "unchanged" : "update" };
    }
  }
}

// ---------------------------------------------------------------- apply

function missingDirs(dir: string): string[] {
  const dirs: string[] = [];
  for (let d = dir; !existsSync(d) && dirname(d) !== d; d = dirname(d)) dirs.push(d);
  return dirs;
}

/** Deletes a JSON file model-ladder created once nothing but `{}` is left in it. */
function writeOrDropJson(r: ManifestRecord, text: string): void {
  const value = parseJson(r.path, text);
  if (r.createdFile && value && typeof value === "object" && Object.keys(value).length === 0) {
    rmSync(r.path, { force: true });
  } else {
    writeAtomic(r.path, text);
  }
}

function backupFile(path: string): string {
  const { backups } = statePaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backups, stamp, path.replace(/^\/+/, ""));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(path, dest);
  return dest;
}

/** Applies one planned op and returns the manifest record to keep for it. */
export function applyOp(
  planned: PlannedOp,
  existing: ManifestRecord | undefined,
): ManifestRecord | undefined {
  const { op, action } = planned;
  if (action === "skip") return existing;
  const base: ManifestRecord = {
    kind: op.kind,
    runtime: op.runtime,
    component: op.component,
    path: op.path,
    label: op.label,
  };
  const current = readText(op.path);
  base.createdDirs = existing?.createdDirs ?? missingDirs(dirname(op.path));
  const createdFile = existing?.createdFile ?? current === undefined;
  switch (op.kind) {
    case "file": {
      let backup = existing?.backup;
      // Back up a file model-ladder did not write, the first time it is replaced.
      if (current !== undefined && !existing && current !== op.content)
        backup = backupFile(op.path);
      if (action !== "unchanged") writeAtomic(op.path, op.content, op.executable);
      else if (op.executable) chmodSync(op.path, 0o755);
      return { ...base, sha: sha256(op.content), ...(backup ? { backup } : {}) };
    }
    case "block": {
      if (action !== "unchanged") writeAtomic(op.path, withBlock(current ?? "", op.content));
      return { ...base, createdFile };
    }
    case "json-set": {
      const text = current ?? "{}\n";
      const root = parseJson(op.path, text);
      const prev = existing?.prev ?? getAt(root, op.pointer);
      const existingDepth = existing?.existingDepth ?? existingPrefix(root, op.pointer);
      if (action !== "unchanged") writeAtomic(op.path, setJson(text, op.pointer, op.value));
      return { ...base, pointer: op.pointer, value: op.value, prev, existingDepth, createdFile };
    }
    case "json-hook": {
      const text = current ?? "{}\n";
      if (action !== "unchanged") {
        const root = parseJson(op.path, text);
        const groups = hookGroups(root, op.event);
        const entry = { type: "command", command: op.command };
        const idx = groups.findIndex((g) => g.matcher === op.matcher);
        const next =
          idx >= 0
            ? groups.map((g, i) => (i === idx ? { ...g, hooks: [...(g.hooks ?? []), entry] } : g))
            : [...groups, { matcher: op.matcher, hooks: [entry] }];
        writeAtomic(op.path, setJson(text, ["hooks", op.event], next));
      }
      return { ...base, event: op.event, command: op.command, createdFile };
    }
    case "frontmatter": {
      const text = current ?? "";
      const prev = existing?.prev ?? getFrontmatter(text, op.key);
      if (action !== "unchanged") writeAtomic(op.path, setFrontmatter(text, op.key, op.value));
      return { ...base, key: op.key, value: op.value, prev };
    }
  }
}

export interface ApplyResult {
  applied: PlannedOp[];
  errors: { op: Op; error: string }[];
}

export function applyPlan(plan: PlannedOp[]): ApplyResult {
  const manifest = loadManifest();
  const byKey = new Map(manifest.records.map((r) => [recordKey(r), r]));
  const result: ApplyResult = { applied: [], errors: [] };
  for (const planned of plan) {
    const key = opKey(planned.op);
    try {
      const record = applyOp(planned, byKey.get(key));
      if (record) byKey.set(key, record);
      result.applied.push(planned);
    } catch (error) {
      result.errors.push({
        op: planned.op,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Save after every op so a crash midway still leaves an accurate manifest.
    saveManifest({ version: 1, records: [...byKey.values()] });
  }
  return result;
}

// ---------------------------------------------------------------- status

export type RecordState = "ok" | "drifted" | "missing";

export function recordState(r: ManifestRecord): RecordState {
  const current = readText(r.path);
  if (current === undefined) return "missing";
  switch (r.kind) {
    case "file":
      return sha256(current) === r.sha ? "ok" : "drifted";
    case "block":
      return current.includes(BLOCK_BEGIN) ? "ok" : "missing";
    case "json-set": {
      const got = getAt(parseJson(r.path, current), r.pointer ?? []);
      return got.present && deepEqual(got.value, r.value) ? "ok" : "drifted";
    }
    case "json-hook": {
      const groups = hookGroups(parseJson(r.path, current), r.event ?? "");
      return groups.some((g) => (g.hooks ?? []).some((h) => h.command === r.command))
        ? "ok"
        : "missing";
    }
    case "frontmatter": {
      const got = getFrontmatter(current, r.key ?? "");
      return got.present && got.value === r.value ? "ok" : "drifted";
    }
  }
}

// ---------------------------------------------------------------- uninstall

export type UndoOutcome = "removed" | "restored" | "kept-modified" | "already-gone";

export interface UndoResult {
  record: ManifestRecord;
  outcome: UndoOutcome;
  note?: string;
}

export function undoRecord(r: ManifestRecord, force = false): UndoResult {
  const current = readText(r.path);
  if (current === undefined) return { record: r, outcome: "already-gone" };
  switch (r.kind) {
    case "file": {
      if (sha256(current) !== r.sha && !force) {
        return {
          record: r,
          outcome: "kept-modified",
          note: "changed since install; re-run with --force to remove",
        };
      }
      if (r.backup && existsSync(r.backup)) {
        copyFileSync(r.backup, r.path);
        return { record: r, outcome: "restored", note: `restored from ${r.backup}` };
      }
      rmSync(r.path, { force: true });
      return { record: r, outcome: "removed" };
    }
    case "block": {
      const next = stripBlock(current);
      if (next === current) return { record: r, outcome: "already-gone" };
      if (r.createdFile && !next.trim()) {
        rmSync(r.path, { force: true });
        return { record: r, outcome: "removed" };
      }
      writeAtomic(r.path, next);
      return { record: r, outcome: "removed" };
    }
    case "json-set": {
      const got = getAt(parseJson(r.path, current), r.pointer ?? []);
      if (!(got.present && deepEqual(got.value, r.value)) && !force) {
        return {
          record: r,
          outcome: "kept-modified",
          note: "value changed since install; left as is",
        };
      }
      const pointer = r.pointer ?? [];
      let next = setJson(current, pointer, r.prev?.present ? r.prev.value : undefined);
      if (!r.prev?.present)
        next = pruneParents(next, pointer, r.existingDepth ?? pointer.length - 1);
      writeOrDropJson(r, next);
      return { record: r, outcome: r.prev?.present ? "restored" : "removed" };
    }
    case "json-hook": {
      const next = removeHook(current, r.event ?? "", r.command ?? "");
      if (next === current) return { record: r, outcome: "already-gone" };
      writeOrDropJson(r, next);
      return { record: r, outcome: "removed" };
    }
    case "frontmatter": {
      const got = getFrontmatter(current, r.key ?? "");
      if (!(got.present && got.value === r.value) && !force) {
        return {
          record: r,
          outcome: "kept-modified",
          note: "value changed since install (gentle-ai sync?); left as is",
        };
      }
      const prev = r.prev?.present ? String(r.prev.value) : undefined;
      writeAtomic(r.path, setFrontmatter(current, r.key ?? "", prev));
      return { record: r, outcome: r.prev?.present ? "restored" : "removed" };
    }
  }
}

export function uninstall(filter: (r: ManifestRecord) => boolean, force = false): UndoResult[] {
  const manifest = loadManifest();
  const results: UndoResult[] = [];
  const keep: ManifestRecord[] = [];
  // Undo in reverse order of application.
  for (const r of [...manifest.records].reverse()) {
    if (!filter(r)) {
      keep.unshift(r);
      continue;
    }
    const res = undoRecord(r, force);
    results.push(res);
    if (res.outcome === "kept-modified") keep.unshift(r);
  }
  // Remove directories model-ladder created, deepest first, once they are empty.
  const dirs = new Set(
    results.filter((r) => r.outcome !== "kept-modified").flatMap((r) => r.record.createdDirs ?? []),
  );
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // Already gone or not removable: leave it.
    }
  }
  saveManifest({ version: 1, records: keep });
  return results;
}
