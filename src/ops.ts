// Idempotent file operations with a manifest, so everything written can be undone.
//
// Each operation records what it replaced (a backup file, or the previous JSON or
// frontmatter value). Uninstall restores that only while the target still holds the
// value agent-config wrote; anything the user or another tool changed since is left alone.

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  type ParseError,
} from "jsonc-parser";
import { resolveBackup } from "./migrate.ts";
import { statePaths } from "./paths.ts";
import type { Runtime } from "./tiers.ts";
import { VERSION } from "./version.ts";

export const COMPONENTS = [
  "agents",
  "skill",
  "instructions",
  "read-guard",
  "review-models",
] as const;
export type LadderComponent = (typeof COMPONENTS)[number];
/** Ladder parts, plus "catalog" for items installed from the catalog (see `item`). */
export type Component = LadderComponent | "catalog";

/** The ladder's catalog item; its parts keep their own components instead of "catalog". */
export const LADDER_ITEM = "model-ladder";
/** The ladder's entry key: it installs at user scope only. */
export const LADDER_KEY = `${LADDER_ITEM}@user`;

export const COMPONENT_LABELS: Record<Component, string> = {
  agents: "Ladder agents (read + edit on fast, balanced, deep)",
  skill: "Routing skill (when to delegate, how to climb)",
  instructions: "Always-on instructions block (CLAUDE.md / AGENTS.md)",
  "read-guard": "Read guard hook: blocks full reads of large files (Claude Code)",
  "review-models": "Gentle AI review agents on ladder models",
  catalog: "Catalog items",
};

interface OpBase {
  runtime: Runtime;
  component: Component;
  path: string;
  label: string;
  /** catalog: the catalog item and scope this op belongs to, such as "kaneo@user". */
  item?: string;
}

/** BEGIN/END marker lines; the first pair is written, later pairs are older markers replaced in place. */
export type Markers = [string, string][];

export type Op =
  | (OpBase & { kind: "file"; content: string; executable?: boolean })
  | (OpBase & { kind: "block"; content: string; markers?: Markers; conflict?: string })
  | (OpBase & { kind: "json-set"; pointer: string[]; value: unknown; requireParent?: boolean })
  | (OpBase & { kind: "json-hook"; event: string; matcher: string; command: string })
  | (OpBase & { kind: "frontmatter"; key: string; value: string; requireFile?: boolean });

export type Action = "create" | "update" | "unchanged" | "skip" | "remove";

export interface PlannedOp {
  op: Op;
  action: Action;
  reason?: string;
  /** remove: the installed item to undo, because the configuration no longer produces it. */
  record?: ManifestRecord;
}

/** Plans undoing an installed item that the current configuration no longer produces. */
export function planRemoval(record: ManifestRecord): PlannedOp {
  const op = {
    kind: record.kind,
    runtime: record.runtime,
    component: record.component,
    path: record.path,
    label: record.label,
    ...(record.item ? { item: record.item } : {}),
  } as Op;
  return { op, action: "remove", reason: "no longer part of the configuration", record };
}

export interface ManifestRecord {
  kind: Op["kind"];
  runtime: Runtime;
  component: Component;
  path: string;
  label: string;
  /** catalog: the catalog item and scope, such as "kaneo@user". */
  item?: string;
  /** file: hash of the content written. */
  sha?: string;
  /** file: where the replaced file was saved. */
  backup?: string;
  /** block, json-set, json-hook: the file did not exist before agent-config created it. */
  createdFile?: boolean;
  /** Directories agent-config created for this path, deepest first; removed on uninstall when empty. */
  createdDirs?: string[];
  /** json-set: JSON pointer segments; frontmatter: the key. */
  pointer?: string[];
  key?: string;
  /** json-set / frontmatter: the value agent-config wrote and what was there before. */
  value?: unknown;
  prev?: { present: boolean; value?: unknown };
  /** json-set: how many leading pointer segments existed before; deeper parents are pruned on uninstall when empty. */
  existingDepth?: number;
  /** json-hook */
  event?: string;
  command?: string;
  hookCreated?: HookCreated;
  /** block: whether the file ended with a newline before the block was added. */
  trailingNewline?: boolean;
  /** Broken symlinks on the path that agent-config replaced; put back on uninstall. */
  replacedLinks?: { path: string; target: string }[];
  /** block: its own markers; absent for the agent-config block. */
  markers?: Markers;
  /** The agent-config version that last wrote or confirmed it; absent before 0.15.0. */
  version?: string;
}

export interface Manifest {
  version: 1;
  records: ManifestRecord[];
}

export const BLOCK_BEGIN =
  "<!-- BEGIN agent-config: managed by agent-config, edits inside this block are overwritten -->";
export const BLOCK_END = "<!-- END agent-config -->";

/** Matches the file's own indentation so edits do not reformat what they did not touch. */
function formatFor(text: string) {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const tabs = indent.startsWith("\t");
  return { insertSpaces: !tabs, tabSize: tabs ? 1 : indent.length, eol: "\n" };
}

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

/**
 * Writes through symlinks (dotfile managers link these files) and keeps the existing
 * file's permissions, so a private settings.json stays private.
 */
function writeAtomic(path: string, text: string, executable = false): void {
  let target = path;
  let mode: number | undefined;
  try {
    target = realpathSync(path);
    mode = statSync(target).mode & 0o7777;
  } catch {
    // New file: write it at the given path with default permissions.
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.agent-config-tmp`;
  writeFileSync(tmp, text);
  if (executable) chmodSync(tmp, (mode ?? 0o644) | 0o111);
  else if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, target);
}

export function recordKey(r: {
  kind: string;
  path: string;
  pointer?: string[];
  key?: string;
  command?: string;
  markers?: Markers;
}): string {
  return [
    r.kind,
    r.path,
    r.pointer?.join("/") ?? r.key ?? r.command ?? r.markers?.[0]?.[0] ?? "",
  ].join("\u0000");
}

export function opKey(op: Op): string {
  switch (op.kind) {
    case "json-set":
      return recordKey({ kind: op.kind, path: op.path, pointer: op.pointer });
    case "frontmatter":
      return recordKey({ kind: op.kind, path: op.path, key: op.key });
    case "json-hook":
      return recordKey({ kind: op.kind, path: op.path, command: op.command });
    case "block":
      return recordKey({ kind: op.kind, path: op.path, markers: op.markers });
    default:
      return recordKey({ kind: op.kind, path: op.path });
  }
}

// ---------------------------------------------------------------- manifest

export function loadManifest(): Manifest {
  const text = readText(statePaths().manifest);
  if (!text) return { version: 1, records: [] };
  const data = JSON.parse(text) as Manifest;
  const records = Array.isArray(data.records) ? data.records : [];
  // Before 0.5.0 the ladder was not a catalog item, so its records carry no item.
  return {
    version: 1,
    records: records.map((r) =>
      r.item === undefined && r.component !== "catalog" ? { ...r, item: LADDER_KEY } : r,
    ),
  };
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

/** Removes the now-empty parent objects agent-config created for a key. */
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
  return applyEdits(text, modify(text, pointer, value, { formattingOptions: formatFor(text) }));
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

/** `value` is unquoted for comparison; `raw` is the text as written, used to restore it exactly. */
export function getFrontmatter(
  text: string,
  key: string,
): { present: boolean; value?: string; raw?: string } {
  const fm = splitFrontmatter(text);
  if (!fm) return { present: false };
  const i = frontmatterLine(fm, key);
  if (i < 0) return { present: false };
  const raw = (fm.lines[i] ?? "").slice(key.length + 1).trim();
  return { present: true, value: unquote(raw), raw };
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
    // Append before the closing fence: inserting mid-way could split a multi-line value.
    lines.splice(fm.end, 0, `${key}: ${value}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- managed block helpers

/** The block markers written before the rename to agent-config; still found and replaced. */
export const LEGACY_BLOCK_BEGIN =
  "<!-- BEGIN model-ladder: managed by model-ladder, edits inside this block are overwritten -->";
export const LEGACY_BLOCK_END = "<!-- END model-ladder -->";

const MARKERS: [string, string][] = [
  [BLOCK_BEGIN, BLOCK_END],
  [LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END],
];

/** The managed block's position, under the current or the older markers. */
function findBlock(
  text: string,
  markers: Markers = MARKERS,
): { begin: number; end: number } | undefined {
  for (const [open, close] of markers) {
    const begin = text.indexOf(open);
    const endIdx = begin >= 0 ? text.indexOf(close, begin) : -1;
    if (begin >= 0 && endIdx >= 0) return { begin, end: endIdx + close.length };
  }
  return undefined;
}

export function hasBlock(text: string, markers?: Markers): boolean {
  return findBlock(text, markers) !== undefined;
}

export function stripBlock(text: string, markers?: Markers): string {
  const found = findBlock(text, markers);
  if (!found) return text;
  const before = text.slice(0, found.begin).replace(/\n+$/, "");
  const after = text.slice(found.end).replace(/^\n+/, "");
  if (!before) return after;
  return after ? `${before}\n\n${after}` : `${before}\n`;
}

export function withBlock(text: string, content: string, markers: Markers = MARKERS): string {
  const [open, close] = markers[0] ?? [BLOCK_BEGIN, BLOCK_END];
  const block = `${open}\n${content.trim()}\n${close}\n`;
  const found = findBlock(text, markers);
  if (found) {
    const tail = text.slice(found.end).replace(/^\n/, "");
    return `${text.slice(0, found.begin)}${block}${tail}`;
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

function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}

/** Appends a compact value to an existing array, leaving every other byte as it was. */
function appendToArray(text: string, pointer: (string | number)[], value: unknown): string {
  const node = findNodeAtLocation(
    parseTree(text) ?? { type: "null", offset: 0, length: 0 },
    pointer,
  );
  if (!node || node.type !== "array") throw new Error("expected an array");
  const json = JSON.stringify(value);
  const items = node.children ?? [];
  const last = items.at(-1);
  if (!last) {
    const indent = lineIndent(text, node.offset);
    const unit = formatFor(text).insertSpaces ? " ".repeat(formatFor(text).tabSize) : "\t";
    const at = node.offset + 1;
    return `${text.slice(0, at)}\n${indent}${unit}${json}\n${indent}${text.slice(node.offset + node.length - 1)}`;
  }
  const end = last.offset + last.length;
  const sameLine = !text.slice(node.offset, last.offset).includes("\n");
  const sep = sameLine ? ", " : `,\n${lineIndent(text, last.offset)}`;
  return `${text.slice(0, end)}${sep}${json}${text.slice(end)}`;
}

/** Removes one array element and its separating comma, leaving every other byte as it was. */
function removeFromArray(text: string, pointer: (string | number)[], index: number): string {
  const node = findNodeAtLocation(
    parseTree(text) ?? { type: "null", offset: 0, length: 0 },
    pointer,
  );
  const items = node?.children ?? [];
  const item = items[index];
  if (!node || !item) return text;
  if (items.length === 1) {
    return `${text.slice(0, node.offset + 1)}${text.slice(node.offset + node.length - 1)}`;
  }
  if (index > 0) {
    const prev = items[index - 1];
    const from = (prev?.offset ?? 0) + (prev?.length ?? 0);
    return `${text.slice(0, from)}${text.slice(item.offset + item.length)}`;
  }
  const next = items[1];
  return `${text.slice(0, item.offset)}${text.slice(next?.offset ?? item.offset + item.length)}`;
}

/** The outermost container agent-config had to create for its hook entry. */
export type HookCreated = "hooks" | "event" | "group" | "entry";

/** Adds one hook entry in place, touching nothing else in the file. */
function addHook(
  text: string,
  event: string,
  matcher: string,
  command: string,
): { text: string; created: HookCreated } {
  const root = parseJson("settings", text);
  const entry = { type: "command", command };
  const group = { matcher, hooks: [entry] };
  if (!getAt(root, ["hooks"]).present) {
    return { text: setJson(text, ["hooks"], { [event]: [group] }), created: "hooks" };
  }
  if (!getAt(root, ["hooks", event]).present) {
    return { text: setJson(text, ["hooks", event], [group]), created: "event" };
  }
  const groups = hookGroups(root, event);
  const idx = groups.findIndex((g) => g.matcher === matcher && Array.isArray(g.hooks));
  if (idx < 0) {
    return { text: appendToArray(text, ["hooks", event], group), created: "group" };
  }
  return { text: appendToArray(text, ["hooks", event, idx, "hooks"], entry), created: "entry" };
}

/** Removes the hook entry and only the containers agent-config created for it. */
function removeHook(text: string, event: string, command: string, created: HookCreated): string {
  const groups = hookGroups(parseJson("settings", text), event);
  const gi = groups.findIndex((g) => (g.hooks ?? []).some((h) => h.command === command));
  if (gi < 0) return text;
  const hooks = groups[gi]?.hooks ?? [];
  const hi = hooks.findIndex((h) => h.command === command);
  let out =
    created !== "entry" && hooks.length === 1
      ? removeFromArray(text, ["hooks", event], gi)
      : removeFromArray(text, ["hooks", event, gi, "hooks"], hi);
  const isEmpty = (pointer: string[]): boolean => {
    const got = getAt(parseJson("settings", out), pointer);
    return (
      got.present &&
      !!got.value &&
      typeof got.value === "object" &&
      Object.keys(got.value).length === 0
    );
  };
  if ((created === "event" || created === "hooks") && isEmpty(["hooks", event])) {
    out = setJson(out, ["hooks", event], undefined);
  }
  if (created === "hooks" && isEmpty(["hooks"])) out = setJson(out, ["hooks"], undefined);
  return out;
}

// ---------------------------------------------------------------- plan

/** A symlink whose target no longer exists. */
function isDangling(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
  } catch {
    return false; // Nothing there at all.
  }
  try {
    statSync(path);
    return false;
  } catch (error) {
    // Only a target that is truly missing: a loop (ELOOP) or an unreadable target (EACCES) is a
    // live link the user still owns, and is left alone.
    const code = (error as { code?: string }).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

/**
 * Broken symlinks on a target path: the file itself or a parent directory. An older installer
 * may have linked a skill folder into a checkout that is gone; nothing can be written through it.
 */
function danglingLinks(path: string): string[] {
  const found: string[] = [];
  for (let p = path; dirname(p) !== p; p = dirname(p)) if (isDangling(p)) found.push(p);
  return found;
}

/** Removes the broken symlinks on a path and returns them, so uninstall can put them back. */
function replaceDanglingLinks(path: string): { path: string; target: string }[] {
  return danglingLinks(path).map((link) => {
    const target = readlinkSync(link);
    unlinkSync(link);
    return { path: link, target };
  });
}

export function planOp(op: Op, recorded?: ManifestRecord): PlannedOp {
  const planned = planTarget(op, recorded);
  const broken = danglingLinks(op.path)[0];
  if (broken && (planned.action === "create" || planned.action === "update") && !planned.reason)
    return { ...planned, reason: `replaces a broken symlink at ${broken}` };
  return planned;
}

function planTarget(op: Op, recorded?: ManifestRecord): PlannedOp {
  const current = readText(op.path);
  switch (op.kind) {
    case "file":
      if (current === undefined) return { op, action: "create" };
      if (current === op.content) return { op, action: "unchanged" };
      if (recorded?.sha && sha256(current) !== recorded.sha) {
        return {
          op,
          action: "update",
          reason: "edited since install; your copy will be backed up",
        };
      }
      return { op, action: "update" };
    case "block": {
      if (current === undefined) return { op, action: "create" };
      // A line the block would define twice (a TOML table the user already has) wins over it.
      if (op.conflict && !hasBlock(current, op.markers)) {
        const line = op.conflict;
        if (current.split("\n").some((l) => l.trim() === line)) {
          return { op, action: "skip", reason: `already configured (${line})` };
        }
      }
      return {
        op,
        action: withBlock(current, op.content, op.markers) === current ? "unchanged" : "update",
      };
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

/** Deletes a JSON file agent-config created once nothing but `{}` is left in it. */
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
  notes: string[] = [],
): ManifestRecord | undefined {
  if (planned.action === "skip") return existing;
  // Replaced before anything else, so the missing directories below are real ones to create.
  const fresh = replaceDanglingLinks(planned.op.path);
  try {
    return writeTarget(planned, existing, notes, [...(existing?.replacedLinks ?? []), ...fresh]);
  } catch (error) {
    // Nothing was recorded, so put the links back now or they would be lost: first clear what
    // this write left in their place (a temp file, folders up to the link), deepest first.
    try {
      rmSync(`${planned.op.path}.agent-config-tmp`, { force: true });
    } catch {
      // Left behind; the links below still come back where they can.
    }
    for (const link of fresh) {
      for (
        let d = dirname(planned.op.path);
        d === link.path || d.startsWith(`${link.path}/`);
        d = dirname(d)
      ) {
        try {
          rmdirSync(d);
        } catch {
          break; // Not created by this write, or holds something else.
        }
      }
      try {
        symlinkSync(link.target, link.path);
      } catch {
        // Occupied: the error below still reports the failed write.
      }
    }
    throw error;
  }
}

function writeTarget(
  planned: PlannedOp,
  existing: ManifestRecord | undefined,
  notes: string[],
  replacedLinks: { path: string; target: string }[],
): ManifestRecord {
  const { op, action } = planned;
  const base: ManifestRecord = {
    kind: op.kind,
    runtime: op.runtime,
    component: op.component,
    path: op.path,
    label: op.label,
    ...(op.item ? { item: op.item } : {}),
    ...(replacedLinks.length > 0 ? { replacedLinks } : {}),
  };
  const current = readText(op.path);
  base.createdDirs = existing?.createdDirs ?? missingDirs(dirname(op.path));
  const createdFile = existing?.createdFile ?? current === undefined;
  switch (op.kind) {
    case "file": {
      let backup = existing?.backup;
      // Back up a file agent-config did not write the first time it takes it over, even when
      // identical, so uninstall gives it back instead of deleting it.
      if (current !== undefined && !existing) backup = backupFile(op.path);
      // A ladder file the user edited after install: keep their copy before overwriting it.
      if (
        current !== undefined &&
        existing?.sha &&
        sha256(current) !== existing.sha &&
        current !== op.content
      ) {
        notes.push(
          `${op.path} was edited since install; your copy was saved to ${backupFile(op.path)}`,
        );
      }
      if (action !== "unchanged") writeAtomic(op.path, op.content, op.executable);
      else if (op.executable) chmodSync(op.path, 0o755);
      return { ...base, sha: sha256(op.content), ...(backup ? { backup } : {}) };
    }
    case "block": {
      if (action !== "unchanged")
        writeAtomic(op.path, withBlock(current ?? "", op.content, op.markers));
      const trailingNewline =
        existing?.trailingNewline ??
        (current === undefined || current === "" || current.endsWith("\n"));
      return {
        ...base,
        createdFile,
        trailingNewline,
        ...(op.markers ? { markers: op.markers } : {}),
      };
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
      let hookCreated = existing?.hookCreated;
      if (action !== "unchanged") {
        const added = addHook(current ?? "{}\n", op.event, op.matcher, op.command);
        writeAtomic(op.path, added.text);
        hookCreated ??= added.created;
      }
      return { ...base, event: op.event, command: op.command, createdFile, hookCreated };
    }
    case "frontmatter": {
      const text = current ?? "";
      const got = getFrontmatter(text, op.key);
      const prev = existing?.prev ?? { present: got.present, value: got.raw };
      if (action !== "unchanged") writeAtomic(op.path, setFrontmatter(text, op.key, op.value));
      return { ...base, key: op.key, value: op.value, prev };
    }
  }
}

export interface ApplyResult {
  applied: PlannedOp[];
  /** Things the user should know, such as where an edited file was backed up. */
  notes: string[];
  errors: { op: Op; error: string }[];
}

export function applyPlan(plan: PlannedOp[]): ApplyResult {
  const manifest = loadManifest();
  const byKey = new Map(manifest.records.map((r) => [recordKey(r), r]));
  const result: ApplyResult = { applied: [], notes: [], errors: [] };
  for (const planned of plan) {
    if (planned.action === "remove" && planned.record) {
      const record = planned.record;
      try {
        const res = undoRecord(record);
        // Either way the configuration no longer produces it, so stop managing it; an item
        // the user changed is left as they have it instead of being offered again each run.
        byKey.delete(recordKey(record));
        if (res.outcome === "kept-modified") {
          // Its backup is no longer referenced, so say where the original is.
          const original = record.backup ? resolveBackup(record.backup) : undefined;
          result.notes.push(
            `${record.path} was left as you changed it and is no longer managed` +
              (original && existsSync(original) ? `; your original is saved at ${original}` : ""),
          );
        } else {
          pruneCreatedDirs([record]);
          for (const note of restoreLinks([record], [...byKey.values()]).values())
            result.notes.push(note);
        }
        result.applied.push(planned);
      } catch (error) {
        result.errors.push({
          op: planned.op,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      saveManifest({ version: 1, records: [...byKey.values()] });
      continue;
    }
    const key = opKey(planned.op);
    try {
      const record = applyOp(planned, byKey.get(key), result.notes);
      // A skipped op wrote nothing, so its record keeps the version that did.
      if (record)
        byKey.set(key, planned.action === "skip" ? record : { ...record, version: VERSION });
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
      return hasBlock(current, r.markers) ? "ok" : "missing";
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
      const backup = r.backup && resolveBackup(r.backup);
      if (backup && existsSync(backup)) {
        writeAtomic(r.path, readFileSync(backup, "utf8"));
        return { record: r, outcome: "restored", note: `restored from ${backup}` };
      }
      rmSync(r.path, { force: true });
      return { record: r, outcome: "removed" };
    }
    case "block": {
      let next = stripBlock(current, r.markers);
      if (next === current) return { record: r, outcome: "already-gone" };
      if (r.trailingNewline === false) next = next.replace(/\n$/, "");
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
      const next = removeHook(current, r.event ?? "", r.command ?? "", r.hookCreated ?? "group");
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
      const prev = r.prev?.present ? String(r.prev.value) : undefined; // raw text as found
      writeAtomic(r.path, setFrontmatter(current, r.key ?? "", prev));
      return { record: r, outcome: r.prev?.present ? "restored" : "removed" };
    }
  }
}

/** Removes directories agent-config created for these records, deepest first, once empty. */
function pruneCreatedDirs(records: ManifestRecord[]): void {
  const dirs = new Set(records.flatMap((r) => r.createdDirs ?? []));
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // Already gone or not removable: leave it.
    }
  }
}

/**
 * Puts back the broken symlinks these undone records replaced. A link whose folder still holds
 * other managed files moves to one of those records (`remaining`), to come back when the last one
 * goes. Returns why each link that could not be put back was not, by record.
 */
function restoreLinks(
  records: ManifestRecord[],
  remaining: ManifestRecord[],
): Map<ManifestRecord, string> {
  const failed = new Map<ManifestRecord, string>();
  const fail = (r: ManifestRecord, note: string) =>
    failed.set(r, failed.has(r) ? `${failed.get(r)}; ${note}` : note);
  for (const r of records) {
    for (const link of r.replacedLinks ?? []) {
      const lost = `could not restore the symlink ${link.path} -> ${link.target}`;
      let occupied = true;
      try {
        lstatSync(link.path);
      } catch {
        occupied = false;
      }
      if (occupied) {
        const heir = remaining.find(
          (k) => k !== r && (k.path === link.path || k.path.startsWith(`${link.path}/`)),
        );
        if (heir) {
          heir.replacedLinks = [
            ...(heir.replacedLinks ?? []).filter((l) => l.path !== link.path),
            link,
          ];
          // The folders created in the link's place go along, so the heir prunes them first.
          const inside = (r.createdDirs ?? []).filter(
            (d) => d === link.path || d.startsWith(`${link.path}/`),
          );
          heir.createdDirs = [...new Set([...(heir.createdDirs ?? []), ...inside])].sort(
            (a, b) => b.length - a.length,
          );
        } else {
          fail(r, `${lost}: something else is there now`);
        }
        continue;
      }
      try {
        symlinkSync(link.target, link.path);
      } catch (error) {
        fail(r, `${lost}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return failed;
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
  const undone = results.filter((r) => r.outcome !== "kept-modified").map((r) => r.record);
  pruneCreatedDirs(undone);
  const failed = restoreLinks(undone, keep);
  for (const res of results) {
    const note = failed.get(res.record);
    if (note) res.note = res.note ? `${res.note}; ${note}` : note;
  }
  saveManifest({ version: 1, records: keep });
  return results;
}
