#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs, styleText } from "node:util";
import process$1, { stdin, stdout } from "node:process";
import l__default, * as l from "node:readline";
import { ReadStream } from "node:tty";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod, mod.exports), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/utils.js
const getCodePointsLength = (() => {
	const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
	return (input) => {
		let surrogatePairsNr = 0;
		SURROGATE_PAIR_RE.lastIndex = 0;
		while (SURROGATE_PAIR_RE.test(input)) surrogatePairsNr += 1;
		return input.length - surrogatePairsNr;
	};
})();
const isFullWidth = (x) => {
	return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
const isWideNotCJKTNotEmoji = (x) => {
	return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};
//#endregion
//#region node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/index.js
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
const CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
const CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/uy;
const TAB_RE = /\t{1,1000}/y;
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/uy;
const LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
const MODIFIER_RE = /\p{M}+/gu;
const NO_TRUNCATION$1 = {
	limit: Infinity,
	ellipsis: ""
};
const getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
	const LIMIT = truncationOptions.limit ?? Infinity;
	const ELLIPSIS = truncationOptions.ellipsis ?? "";
	const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION$1, widthOptions).width : 0);
	const ANSI_WIDTH = 0;
	const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
	const TAB_WIDTH = widthOptions.tabWidth ?? 8;
	const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
	const FULL_WIDTH_WIDTH = 2;
	const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
	const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
	const PARSE_BLOCKS = [
		[LATIN_RE, REGULAR_WIDTH],
		[ANSI_RE, ANSI_WIDTH],
		[CONTROL_RE, CONTROL_WIDTH],
		[TAB_RE, TAB_WIDTH],
		[EMOJI_RE, EMOJI_WIDTH],
		[CJKT_WIDE_RE, WIDE_WIDTH]
	];
	let indexPrev = 0;
	let index = 0;
	let length = input.length;
	let lengthExtra = 0;
	let truncationEnabled = false;
	let truncationIndex = length;
	let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
	let unmatchedStart = 0;
	let unmatchedEnd = 0;
	let width = 0;
	let widthExtra = 0;
	outer: while (true) {
		if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
			const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
			lengthExtra = 0;
			for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
				const codePoint = char.codePointAt(0) || 0;
				if (isFullWidth(codePoint)) widthExtra = FULL_WIDTH_WIDTH;
				else if (isWideNotCJKTNotEmoji(codePoint)) widthExtra = WIDE_WIDTH;
				else widthExtra = REGULAR_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				lengthExtra += char.length;
				width += widthExtra;
			}
			unmatchedStart = unmatchedEnd = 0;
		}
		if (index >= length) break outer;
		for (let i = 0, l = PARSE_BLOCKS.length; i < l; i++) {
			const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
			BLOCK_RE.lastIndex = index;
			if (BLOCK_RE.test(input)) {
				lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
				widthExtra = lengthExtra * BLOCK_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				width += widthExtra;
				unmatchedStart = indexPrev;
				unmatchedEnd = index;
				index = indexPrev = BLOCK_RE.lastIndex;
				continue outer;
			}
		}
		index += 1;
	}
	return {
		width: truncationEnabled ? truncationLimit : width,
		index: truncationEnabled ? truncationIndex : length,
		truncated: truncationEnabled,
		ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
	};
};
//#endregion
//#region node_modules/.pnpm/fast-string-width@3.0.2/node_modules/fast-string-width/dist/index.js
const NO_TRUNCATION = {
	limit: Infinity,
	ellipsis: "",
	ellipsisWidth: 0
};
const fastStringWidth = (input, options = {}) => {
	return getStringTruncatedWidth(input, NO_TRUNCATION, options).width;
};
//#endregion
//#region node_modules/.pnpm/fast-wrap-ansi@0.2.2/node_modules/fast-wrap-ansi/lib/main.js
const ESC = "\x1B";
const CSI = "";
const END_CODE = 39;
const ANSI_ESCAPE_BELL = "\x07";
const ANSI_CSI = "[";
const ANSI_OSC = "]";
const ANSI_SGR_TERMINATOR = "m";
const ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
const GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
const getClosingCode = (openingCode) => {
	if (openingCode >= 30 && openingCode <= 37) return 39;
	if (openingCode >= 90 && openingCode <= 97) return 39;
	if (openingCode >= 40 && openingCode <= 47) return 49;
	if (openingCode >= 100 && openingCode <= 107) return 49;
	if (openingCode === 1 || openingCode === 2) return 22;
	if (openingCode === 3) return 23;
	if (openingCode === 4) return 24;
	if (openingCode === 7) return 27;
	if (openingCode === 8) return 28;
	if (openingCode === 9) return 29;
	if (openingCode === 0) return 0;
};
const wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
const wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
const wrapWord = (rows, word, columns) => {
	const characters = word[Symbol.iterator]();
	let isInsideEscape = false;
	let isInsideLinkEscape = false;
	let lastRow = rows.at(-1);
	let visible = lastRow === void 0 ? 0 : fastStringWidth(lastRow);
	let currentCharacter = characters.next();
	let nextCharacter = characters.next();
	let rawCharacterIndex = 0;
	while (!currentCharacter.done) {
		const character = currentCharacter.value;
		const characterLength = fastStringWidth(character);
		if (visible + characterLength <= columns) rows[rows.length - 1] += character;
		else {
			rows.push(character);
			visible = 0;
		}
		if (character === ESC || character === CSI) {
			isInsideEscape = true;
			isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
		}
		if (isInsideEscape) {
			if (isInsideLinkEscape) {
				if (character === ANSI_ESCAPE_BELL) {
					isInsideEscape = false;
					isInsideLinkEscape = false;
				}
			} else if (character === ANSI_SGR_TERMINATOR) isInsideEscape = false;
		} else {
			visible += characterLength;
			if (visible === columns && !nextCharacter.done) {
				rows.push("");
				visible = 0;
			}
		}
		currentCharacter = nextCharacter;
		nextCharacter = characters.next();
		rawCharacterIndex += character.length;
	}
	lastRow = rows.at(-1);
	if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) rows[rows.length - 2] += rows.pop();
};
const stringVisibleTrimSpacesRight = (string) => {
	const words = string.split(" ");
	let last = words.length;
	while (last) {
		if (fastStringWidth(words[last - 1])) break;
		last--;
	}
	if (last === words.length) return string;
	return words.slice(0, last).join(" ") + words.slice(last).join("");
};
const exec = (string, columns, options = {}) => {
	if (options.trim !== false && string.trim() === "") return "";
	let returnValue = "";
	let escapeCode;
	let escapeUrl;
	const words = string.split(" ");
	let rows = [""];
	let rowLength = 0;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (options.trim !== false) {
			const row = rows.at(-1) ?? "";
			const trimmed = row.trimStart();
			if (row.length !== trimmed.length) {
				rows[rows.length - 1] = trimmed;
				rowLength = fastStringWidth(trimmed);
			}
		}
		if (index !== 0) {
			if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
				rows.push("");
				rowLength = 0;
			}
			if (rowLength || options.trim === false) {
				rows[rows.length - 1] += " ";
				rowLength++;
			}
		}
		const wordLength = fastStringWidth(word);
		if (options.hard && wordLength > columns) {
			const remainingColumns = columns - rowLength;
			const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
			if (Math.floor((wordLength - 1) / columns) < breaksStartingThisLine) rows.push("");
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		if (rowLength + wordLength > columns && rowLength && wordLength) {
			if (options.wordWrap === false && rowLength < columns) {
				wrapWord(rows, word, columns);
				rowLength = fastStringWidth(rows.at(-1) ?? "");
				continue;
			}
			rows.push("");
			rowLength = 0;
		}
		if (rowLength + wordLength > columns && options.wordWrap === false) {
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		rows[rows.length - 1] += word;
		rowLength += wordLength;
	}
	if (options.trim !== false) rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
	const preString = rows.join("\n");
	let inSurrogate = false;
	for (let i = 0; i < preString.length; i++) {
		const character = preString[i];
		returnValue += character;
		if (!inSurrogate) {
			inSurrogate = character >= "\ud800" && character <= "\udbff";
			if (inSurrogate) continue;
		} else inSurrogate = false;
		if (character === ESC || character === CSI) {
			GROUP_REGEX.lastIndex = i + 1;
			const groups = GROUP_REGEX.exec(preString)?.groups;
			if (groups?.code !== void 0) {
				const code = Number.parseFloat(groups.code);
				escapeCode = code === END_CODE ? void 0 : code;
			} else if (groups?.uri !== void 0) escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
		}
		if (preString[i + 1] === "\n") {
			if (escapeUrl) returnValue += wrapAnsiHyperlink("");
			const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
			if (escapeCode && closingCode) returnValue += wrapAnsiCode(closingCode);
		} else if (character === "\n") {
			if (escapeCode && getClosingCode(escapeCode)) returnValue += wrapAnsiCode(escapeCode);
			if (escapeUrl) returnValue += wrapAnsiHyperlink(escapeUrl);
		}
	}
	return returnValue;
};
const CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
	return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}
//#endregion
//#region node_modules/.pnpm/@clack+core@1.5.1/node_modules/@clack/core/dist/index.mjs
var import_src = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const ESC = "\x1B";
	const CSI = `${ESC}[`;
	const beep = "\x07";
	const cursor = {
		to(x, y) {
			if (!y) return `${CSI}${x + 1}G`;
			return `${CSI}${y + 1};${x + 1}H`;
		},
		move(x, y) {
			let ret = "";
			if (x < 0) ret += `${CSI}${-x}D`;
			else if (x > 0) ret += `${CSI}${x}C`;
			if (y < 0) ret += `${CSI}${-y}A`;
			else if (y > 0) ret += `${CSI}${y}B`;
			return ret;
		},
		up: (count = 1) => `${CSI}${count}A`,
		down: (count = 1) => `${CSI}${count}B`,
		forward: (count = 1) => `${CSI}${count}C`,
		backward: (count = 1) => `${CSI}${count}D`,
		nextLine: (count = 1) => `${CSI}E`.repeat(count),
		prevLine: (count = 1) => `${CSI}F`.repeat(count),
		left: `${CSI}G`,
		hide: `${CSI}?25l`,
		show: `${CSI}?25h`,
		save: `${ESC}7`,
		restore: `${ESC}8`
	};
	module.exports = {
		cursor,
		scroll: {
			up: (count = 1) => `${CSI}S`.repeat(count),
			down: (count = 1) => `${CSI}T`.repeat(count)
		},
		erase: {
			screen: `${CSI}2J`,
			up: (count = 1) => `${CSI}1J`.repeat(count),
			down: (count = 1) => `${CSI}J`.repeat(count),
			line: `${CSI}2K`,
			lineEnd: `${CSI}K`,
			lineStart: `${CSI}1K`,
			lines(count) {
				let clear = "";
				for (let i = 0; i < count; i++) clear += this.line + (i < count - 1 ? cursor.up() : "");
				if (count) clear += cursor.left;
				return clear;
			}
		},
		beep
	};
})))();
function findCursor(s, o, l) {
	if (!l.some((r) => !r.disabled)) return s;
	const t = s + o, n = Math.max(l.length - 1, 0), e = t < 0 ? n : t > n ? 0 : t;
	return l[e]?.disabled ? findCursor(e, o < 0 ? -1 : 1, l) : e;
}
const settings = {
	actions: /* @__PURE__ */ new Set([
		"up",
		"down",
		"left",
		"right",
		"space",
		"enter",
		"cancel"
	]),
	aliases: /* @__PURE__ */ new Map([
		["k", "up"],
		["j", "down"],
		["h", "left"],
		["l", "right"],
		["", "cancel"],
		["escape", "cancel"]
	]),
	messages: {
		cancel: "Canceled",
		error: "Something went wrong"
	},
	withGuide: true,
	accessible: void 0,
	date: {
		monthNames: [...[
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December"
		]],
		messages: {
			required: "Please enter a valid date",
			invalidMonth: "There are only 12 months in a year",
			invalidDay: (n, e) => `There are only ${n} days in ${e}`,
			afterMin: (n) => `Date must be on or after ${n.toISOString().slice(0, 10)}`,
			beforeMax: (n) => `Date must be on or before ${n.toISOString().slice(0, 10)}`
		}
	}
};
function isAccessible(n) {
	if (n !== void 0) return n;
	if (settings.accessible !== void 0) return settings.accessible;
	const e = process.env.ACCESSIBLE;
	return e !== void 0 && e !== "" && e !== "0" && e !== "false";
}
function isActionKey(n, e) {
	if (typeof n == "string") return settings.aliases.get(n) === e;
	for (const s of n) if (s !== void 0 && isActionKey(s, e)) return true;
	return false;
}
function diffLines(i, s) {
	if (i === s) return;
	const e = i.split(`
`), t = s.split(`
`), r = Math.max(e.length, t.length), f = [];
	for (let n = 0; n < r; n++) e[n] !== t[n] && f.push(n);
	return {
		lines: f,
		numLinesBefore: e.length,
		numLinesAfter: t.length,
		numLines: r
	};
}
const R = globalThis.process.platform.startsWith("win");
const CANCEL_SYMBOL = Symbol("clack:cancel");
function isCancel(e) {
	return e === CANCEL_SYMBOL;
}
function setRawMode(e, r) {
	const o = e;
	o.isTTY && o.setRawMode(r);
}
function block({ input: e = stdin, output: r = stdout, overwrite: o = true, hideCursor: n = true } = {}) {
	const s = l.createInterface({
		input: e,
		output: r,
		prompt: "",
		tabSize: 1
	});
	l.emitKeypressEvents(e, s), e instanceof ReadStream && e.isTTY && e.setRawMode(true);
	const t = (f, { name: a, sequence: w }) => {
		if (isActionKey([
			String(f),
			a,
			w
		], "cancel")) {
			n && r.write(import_src.cursor.show), process.exit(0);
			return;
		}
		if (!o) return;
		const i = a === "return" ? 0 : -1, m = a === "return" ? -1 : 0;
		l.moveCursor(r, i, m, () => {
			l.clearLine(r, 1, () => {
				e.once("keypress", t);
			});
		});
	};
	return n && r.write(import_src.cursor.hide), e.once("keypress", t), () => {
		e.off("keypress", t), n && r.write(import_src.cursor.show), e instanceof ReadStream && e.isTTY && !R && e.setRawMode(false), s.terminal = false, s.close();
	};
}
const getColumns = (e) => "columns" in e && typeof e.columns == "number" ? e.columns : 80;
const getRows = (e) => "rows" in e && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r, o, n = o, s = o, t) {
	return wrapAnsi(r, getColumns(e ?? stdout) - o.length, {
		hard: true,
		trim: false
	}).split(`
`).map((c, i, m) => {
		const d = t ? t(c, i) : c;
		return i === 0 ? `${n}${d}` : i === m.length - 1 ? `${s}${d}` : `${o}${d}`;
	}).join(`
`);
}
function runValidation(e, a) {
	if ("~standard" in e) {
		const n = e["~standard"].validate(a);
		return n instanceof Promise ? n.then((r) => r.issues?.at(0)?.message) : n.issues?.at(0)?.message;
	}
	return e(a);
}
var y = class {
	input;
	output;
	_abortSignal;
	rl;
	opts;
	_render;
	_track = false;
	_prevFrame = "";
	_subscribers = /* @__PURE__ */ new Map();
	_cursor = 0;
	state = "initial";
	error = "";
	value;
	userInput = "";
	/**
	* Whether accessible (static, screen-reader friendly) output is enabled for
	* this prompt, resolved from the `accessible` option, the global setting,
	* and the `ACCESSIBLE` env var.
	*/
	get accessible() {
		return isAccessible(this.opts.accessible);
	}
	constructor(t, e = true) {
		const { input: i = stdin, output: s = stdout, render: r, signal: n, ...o } = t;
		this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = r.bind(this), this._track = e, this._abortSignal = n, this.input = i, this.output = s;
	}
	/**
	* Unsubscribe all listeners
	*/
	unsubscribe() {
		this._subscribers.clear();
	}
	/**
	* Set a subscriber with opts
	* @param event - The event name
	*/
	setSubscriber(t, e) {
		const i = this._subscribers.get(t) ?? [];
		i.push(e), this._subscribers.set(t, i);
	}
	/**
	* Subscribe to an event
	* @param event - The event name
	* @param cb - The callback
	*/
	on(t, e) {
		this.setSubscriber(t, { cb: e });
	}
	/**
	* Subscribe to an event once
	* @param event - The event name
	* @param cb - The callback
	*/
	once(t, e) {
		this.setSubscriber(t, {
			cb: e,
			once: true
		});
	}
	/**
	* Emit an event with data
	* @param event - The event name
	* @param data - The data to pass to the callback
	*/
	emit(t, ...e) {
		const i = this._subscribers.get(t) ?? [], s = [];
		for (const r of i) r.cb(...e), r.once && s.push(() => i.splice(i.indexOf(r), 1));
		for (const r of s) r();
	}
	prompt() {
		return new Promise((t) => {
			if (this._abortSignal) {
				if (this._abortSignal.aborted) return this.state = "cancel", this.close(), t(CANCEL_SYMBOL);
				this._abortSignal.addEventListener("abort", () => {
					this.state = "cancel", this.close();
				}, { once: true });
			}
			this.rl = l__default.createInterface({
				input: this.input,
				tabSize: 2,
				prompt: "",
				escapeCodeTimeout: 50,
				terminal: true
			}), this.rl.prompt(), this.opts.initialUserInput !== void 0 && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), setRawMode(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(this.value);
			}), this.once("cancel", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(CANCEL_SYMBOL);
			});
		});
	}
	_isActionKey(t, e) {
		return t === "	";
	}
	_shouldSubmit(t, e) {
		return true;
	}
	_setValue(t) {
		this.value = t, this.emit("value", this.value);
	}
	_setUserInput(t, e) {
		this.userInput = t ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
	}
	_clearUserInput() {
		this.rl?.write(null, {
			ctrl: true,
			name: "u"
		}), this._setUserInput("");
	}
	async onKeypress(t, e) {
		if (this.state !== "validating") {
			if (this._track && e.name !== "return" && (e.name && this._isActionKey(t, e) && this.rl?.write(null, {
				ctrl: true,
				name: "h"
			}), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings.aliases.has(e.name) && this.emit("cursor", settings.aliases.get(e.name)), settings.actions.has(e.name) && this.emit("cursor", e.name)), t && (t.toLowerCase() === "y" || t.toLowerCase() === "n") && this.emit("confirm", t.toLowerCase() === "y"), this.emit("key", t, e), e?.name === "return" && this._shouldSubmit(t, e)) {
				if (this.opts.validate) {
					const i = runValidation(this.opts.validate, this.value);
					let s;
					i instanceof Promise ? (this.state = "validating", this.render(), s = await i) : s = i, s && (this.error = s instanceof Error ? s.message : s, this.state = "error", this.rl?.write(this.userInput));
				}
				this.state !== "error" && (this.state = "submit");
			}
			isActionKey([
				t,
				e?.name,
				e?.sequence
			], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
		}
	}
	close() {
		this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
	}
	restoreCursor() {
		const t = wrapAnsi(this._prevFrame, process.stdout.columns, {
			hard: true,
			trim: false
		}).split(`
`).length - 1;
		this.output.write(import_src.cursor.move(-999, t * -1));
	}
	render() {
		const t = wrapAnsi(this._render(this) ?? "", process.stdout.columns, {
			hard: true,
			trim: false
		});
		if (t !== this._prevFrame) {
			if (this.state === "initial") this.output.write(import_src.cursor.hide);
			else {
				const e = diffLines(this._prevFrame, t), i = getRows(this.output);
				if (this.restoreCursor(), e) {
					const s = Math.max(0, e.numLinesAfter - i), r = Math.max(0, e.numLinesBefore - i);
					let n = e.lines.find((o) => o >= s);
					if (n === void 0) {
						this._prevFrame = t;
						return;
					}
					if (e.lines.length === 1) {
						this.output.write(import_src.cursor.move(0, n - r)), this.output.write(import_src.erase.lines(1));
						const o = t.split(`
`);
						this.output.write(o[n]), this._prevFrame = t, this.output.write(import_src.cursor.move(0, o.length - n - 1));
						return;
					} else if (e.lines.length > 1) {
						if (s < r) n = s;
						else {
							const h = n - r;
							h > 0 && this.output.write(import_src.cursor.move(0, h));
						}
						this.output.write(import_src.erase.down());
						const f = t.split(`
`).slice(n);
						this.output.write(f.join(`
`)), this._prevFrame = t;
						return;
					}
				}
				this.output.write(import_src.erase.down());
			}
			this.output.write(t), this.state === "initial" && (this.state = "active"), this._prevFrame = t;
		}
	}
};
var r = class extends y {
	get cursor() {
		return this.value ? 0 : 1;
	}
	get _value() {
		return this.cursor === 0;
	}
	constructor(t) {
		super(t, false), this.value = !!t.initialValue, this.on("userInput", () => {
			this.value = this._value;
		}), this.on("confirm", (i) => {
			this.output.write(import_src.cursor.move(0, -1)), this.value = i, this.state = "submit", this.close();
		}), this.on("cursor", () => {
			this.value = !this.value;
		});
	}
};
var a = class extends y {
	options;
	cursor = 0;
	get _value() {
		return this.options[this.cursor]?.value;
	}
	get _enabledOptions() {
		return this.options.filter((e) => e.disabled !== true);
	}
	toggleAll() {
		const e = this._enabledOptions, i = this.value !== void 0 && this.value.length === e.length;
		this.value = i ? [] : e.map((t) => t.value);
	}
	toggleInvert() {
		const e = this.value;
		if (!e) return;
		const i = this._enabledOptions.filter((t) => !e.includes(t.value));
		this.value = i.map((t) => t.value);
	}
	toggleValue() {
		this.value === void 0 && (this.value = []);
		const e = this.value.includes(this._value);
		this.value = e ? this.value.filter((i) => i !== this._value) : [...this.value, this._value];
	}
	constructor(e) {
		super(e, false), this.options = e.options, this.value = [...e.initialValues ?? []];
		const i = Math.max(this.options.findIndex(({ value: t }) => t === e.cursorAt), 0);
		this.cursor = this.options[i]?.disabled ? findCursor(i, 1, this.options) : i, this.on("key", (t, l) => {
			l.name === "a" && this.toggleAll(), l.name === "i" && this.toggleInvert();
		}), this.on("cursor", (t) => {
			switch (t) {
				case "left":
				case "up":
					this.cursor = findCursor(this.cursor, -1, this.options);
					break;
				case "down":
				case "right":
					this.cursor = findCursor(this.cursor, 1, this.options);
					break;
				case "space": this.toggleValue();
			}
		});
	}
};
let n$1 = class n extends y {
	options;
	cursor = 0;
	get _selectedValue() {
		return this.options[this.cursor];
	}
	changeValue() {
		const e = this._selectedValue;
		this.value = e === void 0 ? void 0 : e.value;
	}
	constructor(e) {
		super(e, false), this.options = e.options;
		const o = this.options.findIndex(({ value: s }) => s === e.initialValue), t = o === -1 ? 0 : o;
		this.cursor = this.options[t]?.disabled ? findCursor(t, 1, this.options) : t, this.changeValue(), this.on("cursor", (s) => {
			switch (s) {
				case "left":
				case "up":
					this.cursor = findCursor(this.cursor, -1, this.options);
					break;
				case "down":
				case "right": this.cursor = findCursor(this.cursor, 1, this.options);
			}
			this.changeValue();
		});
	}
};
var n = class extends y {
	get userInputWithCursor() {
		if (this.state === "submit") return this.userInput;
		const t = this.userInput;
		if (this.cursor >= t.length) return `${this.userInput}\u2588`;
		const r = t.slice(0, this.cursor), s = t.slice(this.cursor, this.cursor + 1), e = t.slice(this.cursor + 1);
		return `${r}${styleText("inverse", s)}${e}`;
	}
	get cursor() {
		return this._cursor;
	}
	constructor(t) {
		super({
			...t,
			initialUserInput: t.initialUserInput ?? t.initialValue
		}), this.on("userInput", (r) => {
			this._setValue(r);
		}), this.on("finalize", () => {
			this.value || (this.value = t.defaultValue), this.value === void 0 && (this.value = "");
		});
	}
};
//#endregion
//#region node_modules/.pnpm/@clack+prompts@1.8.1/node_modules/@clack/prompts/dist/index.mjs
function isUnicodeSupported() {
	if (process$1.platform !== "win32") return process$1.env.TERM !== "linux";
	return Boolean(process$1.env.CI) || Boolean(process$1.env.WT_SESSION) || Boolean(process$1.env.TERMINUS_SUBLIME) || process$1.env.ConEmuTask === "{cmd::Cmder}" || process$1.env.TERM_PROGRAM === "Terminus-Sublime" || process$1.env.TERM_PROGRAM === "vscode" || process$1.env.TERM === "xterm-256color" || process$1.env.TERM === "alacritty" || process$1.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
const unicode = isUnicodeSupported();
const isCI = () => process.env.CI === "true";
const unicodeOr = (o, e) => unicode ? o : e;
const S_STEP_ACTIVE = unicodeOr("◆", "*");
const S_STEP_CANCEL = unicodeOr("■", "x");
const S_STEP_ERROR = unicodeOr("▲", "x");
const S_STEP_SUBMIT = unicodeOr("◇", "o");
const S_BAR_START = unicodeOr("┌", "T");
const S_BAR = unicodeOr("│", "|");
const S_BAR_END = unicodeOr("└", "—");
const S_RADIO_ACTIVE = unicodeOr("●", ">");
const S_RADIO_INACTIVE = unicodeOr("○", " ");
const S_CHECKBOX_ACTIVE = unicodeOr("◻", "[•]");
const S_CHECKBOX_SELECTED = unicodeOr("◼", "[+]");
const S_CHECKBOX_INACTIVE = unicodeOr("◻", "[ ]");
const S_BAR_H = unicodeOr("─", "-");
const S_CORNER_TOP_RIGHT = unicodeOr("╮", "+");
const S_CONNECT_LEFT = unicodeOr("├", "+");
const S_CORNER_BOTTOM_RIGHT = unicodeOr("╯", "+");
const S_CORNER_BOTTOM_LEFT = unicodeOr("╰", "+");
const S_INFO = unicodeOr("●", "•");
const S_SUCCESS = unicodeOr("◆", "*");
const S_WARN = unicodeOr("▲", "!");
const S_ERROR = unicodeOr("■", "x");
const symbol = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_STEP_ACTIVE);
		case "cancel": return styleText("red", S_STEP_CANCEL);
		case "error": return styleText("yellow", S_STEP_ERROR);
		case "submit": return styleText("green", S_STEP_SUBMIT);
		case "validating": return styleText("dim", S_STEP_ACTIVE);
	}
};
const symbolBar = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_BAR);
		case "cancel": return styleText("red", S_BAR);
		case "error": return styleText("yellow", S_BAR);
		case "submit": return styleText("green", S_BAR);
	}
};
function formatInstructionFooter(o, e) {
	const r = [`${e ? `${styleText("cyan", S_BAR)}  ` : ""}${o.join(" • ")}`];
	return e && r.push(styleText("cyan", S_BAR_END)), r;
}
const I = (l, e, w, p, b, C = false) => {
	let r = e, O = 0;
	if (C) for (let i = p - 1; i >= w; i--) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	else for (let i = w; i < p; i++) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	return {
		lineCount: r,
		removals: O
	};
};
const limitOptions = ({ cursor: l, options: e, style: w, output: p = process.stdout, maxItems: b = Number.POSITIVE_INFINITY, columnPadding: C = 0, rowPadding: r = 4 }) => {
	const i = getColumns(p) - C, m = getRows(p), M = styleText("dim", "..."), v = Math.max(m - r, 0), a = Math.max(Math.min(b, v), 5);
	let f = 0;
	l >= a - 3 && (f = Math.max(Math.min(l - a + 3, e.length - a), 0));
	let d = a < e.length && f > 0, c = a < e.length && f + a < e.length;
	const W = Math.min(f + a, e.length), s = [];
	let g = 0;
	d && g++, c && g++;
	const T = f + (d ? 1 : 0), y = W - (c ? 1 : 0);
	for (let t = T; t < y; t++) {
		const n = e[t], h = wrapAnsi(n ? w(n, t === l) : "", i, {
			hard: true,
			trim: false
		}).split(`
`);
		s.push(h), g += h.length;
	}
	if (g > v) {
		let t = 0, n = 0, o = g;
		const h = l - T;
		let u = v;
		const L = () => I(s, o, 0, h, u), E = () => I(s, o, h + 1, s.length, u, true);
		d ? ({lineCount: o, removals: t} = L(), o > u && (c || (u -= 1), {lineCount: o, removals: n} = E())) : (c || (u -= 1), {lineCount: o, removals: n} = E(), o > u && (u -= 1, {lineCount: o, removals: t} = L())), t > 0 && (d = true, s.splice(0, t)), n > 0 && (c = true, s.splice(s.length - n, n));
	}
	const x = [];
	d && x.push(M);
	for (const t of s) for (const n of t) x.push(n);
	return c && x.push(M), x;
};
const confirm = (e) => {
	const a = e.active ?? "Yes", o = e.inactive ?? "No";
	return new r({
		active: a,
		inactive: o,
		signal: e.signal,
		input: e.input,
		output: e.output,
		initialValue: e.initialValue ?? true,
		render() {
			const i = e.withGuide ?? settings.withGuide, u = `${symbol(this.state)}  `, l = i ? `${styleText("gray", S_BAR)}  ` : "", f = wrapTextWithPrefix(e.output, e.message, l, u), s = `${i ? `${styleText("gray", S_BAR)}
` : ""}${f}
`, c = this.value ? a : o;
			switch (this.state) {
				case "submit": return `${s}${i ? `${styleText("gray", S_BAR)}  ` : ""}${styleText("dim", c)}`;
				case "cancel": return `${s}${i ? `${styleText("gray", S_BAR)}  ` : ""}${styleText(["strikethrough", "dim"], c)}${i ? `
${styleText("gray", S_BAR)}` : ""}`;
				default: {
					const r = i ? `${styleText("cyan", S_BAR)}  ` : "", g = i ? styleText("cyan", S_BAR_END) : "";
					return `${s}${r}${this.value ? `${styleText("green", S_RADIO_ACTIVE)} ${a}` : `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", a)}`}${e.vertical ? i ? `
${styleText("cyan", S_BAR)}  ` : `
` : ` ${styleText("dim", "/")} `}${this.value ? `${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", o)}` : `${styleText("green", S_RADIO_ACTIVE)} ${o}`}
${g}
`;
				}
			}
		}
	}).prompt();
};
const MULTISELECT_INSTRUCTIONS = [
	`${styleText("dim", "↑/↓")} to navigate`,
	`${styleText("dim", "Space:")} select`,
	`${styleText("dim", "Enter:")} confirm`
];
const m = (i, u) => i.split(`
`).map((d) => u(d)).join(`
`);
const multiselect = (i) => {
	const u = (t, a) => {
		const r = t.label ?? String(t.value);
		return a === "disabled" ? `${styleText("gray", S_CHECKBOX_INACTIVE)} ${m(r, (o) => styleText(["strikethrough", "gray"], o))}${t.hint ? ` ${styleText("dim", `(${t.hint ?? "disabled"})`)}` : ""}` : a === "active" ? `${styleText("cyan", S_CHECKBOX_ACTIVE)} ${r}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "selected" ? `${styleText("green", S_CHECKBOX_SELECTED)} ${m(r, (o) => styleText("dim", o))}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "cancelled" ? `${m(r, (o) => styleText(["strikethrough", "dim"], o))}` : a === "active-selected" ? `${styleText("green", S_CHECKBOX_SELECTED)} ${r}${t.hint ? ` ${styleText("dim", `(${t.hint})`)}` : ""}` : a === "submitted" ? `${m(r, (o) => styleText("dim", o))}` : `${styleText("dim", S_CHECKBOX_INACTIVE)} ${m(r, (o) => styleText("dim", o))}`;
	}, d = i.required ?? true, x = i.showInstructions ?? true;
	return new a({
		options: i.options,
		signal: i.signal,
		input: i.input,
		output: i.output,
		initialValues: i.initialValues,
		required: d,
		cursorAt: i.cursorAt,
		validate(t) {
			if (d && (t === void 0 || t.length === 0)) return `Please select at least one option.
${styleText("reset", styleText("dim", `Press ${styleText([
				"gray",
				"bgWhite",
				"inverse"
			], " space ")} to select, ${styleText("gray", styleText("bgWhite", styleText("inverse", " enter ")))} to submit`))}`;
		},
		render() {
			const t = i.withGuide ?? settings.withGuide, a = wrapTextWithPrefix(i.output, i.message, t ? `${symbolBar(this.state)}  ` : "", `${symbol(this.state)}  `), r = `${t ? `${styleText("gray", S_BAR)}
` : ""}${a}
`, o = this.value ?? [], g = (n, l) => {
				if (n.disabled) return u(n, "disabled");
				const s = o.includes(n.value);
				return l && s ? u(n, "active-selected") : s ? u(n, "selected") : u(n, l ? "active" : "inactive");
			};
			switch (this.state) {
				case "submit": {
					const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "submitted")).join(styleText("dim", ", ")) || styleText("dim", "none");
					return `${r}${wrapTextWithPrefix(i.output, n, t ? `${styleText("gray", S_BAR)}  ` : "")}`;
				}
				case "cancel": {
					const n = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u(s, "cancelled")).join(styleText("dim", ", "));
					if (n.trim() === "") return `${r}${styleText("gray", S_BAR)}`;
					return `${r}${wrapTextWithPrefix(i.output, n, t ? `${styleText("gray", S_BAR)}  ` : "")}${t ? `
${styleText("gray", S_BAR)}` : ""}`;
				}
				case "error": {
					const n = t ? `${styleText("yellow", S_BAR)}  ` : "", l = this.error.split(`
`).map(($, v) => v === 0 ? `${t ? `${styleText("yellow", S_BAR_END)}  ` : ""}${styleText("yellow", $)}` : `   ${$}`).join(`
`), s = r.split(`
`).length, h = l.split(`
`).length + 1;
					return `${r}${n}${limitOptions({
						output: i.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: i.maxItems,
						columnPadding: n.length,
						rowPadding: s + h,
						style: g
					}).join(`
${n}`)}
${l}
`;
				}
				default: {
					const n = t ? `${styleText("cyan", S_BAR)}  ` : "", l = r.split(`
`).length, s = x ? formatInstructionFooter(MULTISELECT_INSTRUCTIONS, t) : t ? [styleText("cyan", S_BAR_END)] : [], h = s.join(`
`), $ = s.length + 1;
					return `${r}${n}${limitOptions({
						output: i.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: i.maxItems,
						columnPadding: n.length,
						rowPadding: l + $,
						style: g
					}).join(`
${n}`)}
${h}
`;
				}
			}
		}
	}).prompt();
};
const log = {
	message: (s = [], { symbol: e = styleText("gray", S_BAR), secondarySymbol: r = styleText("gray", S_BAR), output: m = process.stdout, spacing: l = 1, withGuide: c } = {}) => {
		const t = [], o = c ?? settings.withGuide, f = o ? r : "", O = o ? `${e}  ` : "", u = o ? `${r}  ` : "";
		for (let i = 0; i < l; i++) t.push(f);
		const g = Array.isArray(s) ? s : s.split(`
`);
		if (g.length > 0) {
			const [i, ...y] = g;
			i.length > 0 ? t.push(`${O}${i}`) : t.push(o ? e : "");
			for (const p of y) p.length > 0 ? t.push(`${u}${p}`) : t.push(o ? r : "");
		}
		m.write(`${t.join(`
`)}
`);
	},
	info: (s, e) => {
		log.message(s, {
			...e,
			symbol: styleText("blue", S_INFO)
		});
	},
	success: (s, e) => {
		log.message(s, {
			...e,
			symbol: styleText("green", S_SUCCESS)
		});
	},
	step: (s, e) => {
		log.message(s, {
			...e,
			symbol: styleText("green", S_STEP_SUBMIT)
		});
	},
	warn: (s, e) => {
		log.message(s, {
			...e,
			symbol: styleText("yellow", S_WARN)
		});
	},
	/** alias for `log.warn()`. */
	warning: (s, e) => {
		log.warn(s, e);
	},
	error: (s, e) => {
		log.message(s, {
			...e,
			symbol: styleText("red", S_ERROR)
		});
	}
};
const cancel = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR_END)}  ` : "";
	i.write(`${e}${styleText("red", o)}

`);
};
const intro = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR_START)}  ` : "";
	i.write(`${e}${o}
`);
};
const outro = (o = "", t) => {
	const i = t?.output ?? process.stdout, e = t?.withGuide ?? settings.withGuide ? `${styleText("gray", S_BAR)}
${styleText("gray", S_BAR_END)}  ` : "";
	i.write(`${e}${o}

`);
};
const W$1 = (o) => o;
const C = (o, e, s) => {
	const a = {
		hard: true,
		trim: false
	}, i = wrapAnsi(o, e, a).split(`
`), c = i.reduce((n, t) => Math.max(fastStringWidth(t), n), 0);
	return wrapAnsi(o, e - (i.map(s).reduce((n, t) => Math.max(fastStringWidth(t), n), 0) - c), a);
};
const note = (o = "", e = "", s) => {
	const a = s?.output ?? process$1.stdout, i = s?.withGuide ?? settings.withGuide, c = s?.format ?? W$1, g = [
		"",
		...C(o, getColumns(a) - 6, c).split(`
`).map(c),
		""
	], n = fastStringWidth(e), t = Math.max(g.reduce((m, F) => {
		const O = fastStringWidth(F);
		return O > m ? O : m;
	}, 0), n) + 2, h = g.map((m) => `${styleText("gray", S_BAR)}  ${m}${" ".repeat(t - fastStringWidth(m))}${styleText("gray", S_BAR)}`).join(`
`), T = i ? `${styleText("gray", S_BAR)}
` : "", l$1 = i ? S_CONNECT_LEFT : S_CORNER_BOTTOM_LEFT;
	a.write(`${T}${styleText("green", S_STEP_SUBMIT)}  ${styleText("reset", e)} ${styleText("gray", S_BAR_H.repeat(Math.max(t - n - 1, 1)) + S_CORNER_TOP_RIGHT)}
${h}
${styleText("gray", l$1 + S_BAR_H.repeat(t + 2) + S_CORNER_BOTTOM_RIGHT)}
`);
};
const W = (l) => styleText("magenta", l);
const spinner = ({ indicator: l = "dots", onCancel: h, output: n = process.stdout, cancelMessage: G, errorMessage: O, frames: E = unicode ? [
	"◒",
	"◐",
	"◓",
	"◑"
] : [
	"•",
	"o",
	"O",
	"0"
], delay: F = unicode ? 80 : 120, signal: m, ...I } = {}) => {
	const u = isCI();
	let M, T, d = false, S = false, s = "", p, w = performance.now();
	const x = getColumns(n), k = I?.styleFrame ?? W, g = (e) => {
		const r = e > 1 ? O ?? settings.messages.error : G ?? settings.messages.cancel;
		S = e === 1, d && (a(r, e), S && typeof h == "function" && h());
	}, f = () => g(2), i = () => g(1), A = () => {
		process.on("uncaughtExceptionMonitor", f), process.on("unhandledRejection", f), process.on("SIGINT", i), process.on("SIGTERM", i), process.on("exit", g), m && m.addEventListener("abort", i);
	}, H = () => {
		process.removeListener("uncaughtExceptionMonitor", f), process.removeListener("unhandledRejection", f), process.removeListener("SIGINT", i), process.removeListener("SIGTERM", i), process.removeListener("exit", g), m && m.removeEventListener("abort", i);
	}, y = () => {
		if (p === void 0) return;
		u && n.write(`
`);
		const r = wrapAnsi(p, x, {
			hard: true,
			trim: false
		}).split(`
`);
		r.length > 1 && n.write(import_src.cursor.up(r.length - 1)), n.write(import_src.cursor.to(0)), n.write(import_src.erase.down());
	}, C = (e) => e.replace(/\.+$/, ""), _ = (e) => {
		const r = (performance.now() - e) / 1e3, t = Math.floor(r / 60), o = Math.floor(r % 60);
		return t > 0 ? `[${t}m ${o}s]` : `[${o}s]`;
	}, N = I.withGuide ?? settings.withGuide, P = (e = "") => {
		d = true, M = block({ output: n }), s = C(e), w = performance.now(), N && n.write(`${styleText("gray", S_BAR)}
`);
		let r = 0, t = 0;
		A(), T = setInterval(() => {
			if (u && s === p) return;
			y(), p = s;
			const o = k(E[r]);
			let v;
			if (u) v = `${o}  ${s}...`;
			else if (l === "timer") v = `${o}  ${s} ${_(w)}`;
			else {
				const B = ".".repeat(Math.floor(t)).slice(0, 3);
				v = `${o}  ${s}${B}`;
			}
			const j = wrapAnsi(v, x, {
				hard: true,
				trim: false
			});
			n.write(j), r = r + 1 < E.length ? r + 1 : 0, t = t < 4 ? t + .125 : 0;
		}, F);
	}, a = (e = "", r = 0, t = false) => {
		if (!d) return;
		d = false, clearInterval(T), y();
		const o = r === 0 ? styleText("green", S_STEP_SUBMIT) : r === 1 ? styleText("red", S_STEP_CANCEL) : styleText("red", S_STEP_ERROR);
		s = e ?? s, t || (l === "timer" ? n.write(`${o}  ${s} ${_(w)}
`) : n.write(`${o}  ${s}
`)), H(), M();
	};
	return {
		start: P,
		stop: (e = "") => a(e, 0),
		message: (e = "") => {
			s = C(e ?? s);
		},
		cancel: (e = "") => a(e, 1),
		error: (e = "") => a(e, 2),
		clear: () => a("", 0, true),
		get isCancelled() {
			return S;
		}
	};
};
const SELECT_INSTRUCTIONS = [`${styleText("dim", "↑/↓")} to navigate`, `${styleText("dim", "Enter:")} confirm`];
const c = (t, o) => t.includes(`
`) ? t.split(`
`).map((d) => o(d)).join(`
`) : o(t);
const select = (t) => {
	const o = (n, m) => {
		if (n === void 0) return "";
		const s = n.label ?? String(n.value);
		switch (m) {
			case "disabled": return `${styleText("gray", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("gray", i))}${n.hint ? ` ${styleText("dim", `(${n.hint ?? "disabled"})`)}` : ""}`;
			case "selected": return `${c(s, (i) => styleText("dim", i))}`;
			case "active": return `${styleText("green", S_RADIO_ACTIVE)} ${s}${n.hint ? ` ${styleText("dim", `(${n.hint})`)}` : ""}`;
			case "cancelled": return `${c(s, (i) => styleText(["strikethrough", "dim"], i))}`;
			default: return `${styleText("dim", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("dim", i))}`;
		}
	}, d = t.showInstructions ?? true;
	return new n$1({
		options: t.options,
		signal: t.signal,
		input: t.input,
		output: t.output,
		initialValue: t.initialValue,
		render() {
			const n = t.withGuide ?? settings.withGuide, m = `${symbol(this.state)}  `, s = `${symbolBar(this.state)}  `, i = wrapTextWithPrefix(t.output, t.message, s, m), u = `${n ? `${styleText("gray", S_BAR)}
` : ""}${i}
`;
			switch (this.state) {
				case "submit": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "selected"), r)}`;
				}
				case "cancel": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "cancelled"), r)}${n ? `
${styleText("gray", S_BAR)}` : ""}`;
				}
				default: {
					const r = n ? `${styleText("cyan", S_BAR)}  ` : "", a = u.split(`
`).length, p = d ? formatInstructionFooter(SELECT_INSTRUCTIONS, n) : n ? [styleText("cyan", S_BAR_END)] : [], f = p.join(`
`), b = p.length + 1;
					return `${u}${r}${limitOptions({
						output: t.output,
						cursor: this.cursor,
						options: this.options,
						maxItems: t.maxItems,
						columnPadding: r.length,
						rowPadding: a + b,
						style: (g, x) => o(g, g.disabled ? "disabled" : x ? "active" : "inactive")
					}).join(`
${r}`)}
${f}
`;
				}
			}
		}
	}).prompt();
};
`${styleText("gray", S_BAR)}`;
const text = (t) => new n({
	validate: t.validate,
	placeholder: t.placeholder,
	defaultValue: t.defaultValue,
	initialValue: t.initialValue,
	output: t.output,
	signal: t.signal,
	input: t.input,
	render() {
		const r = t?.withGuide ?? settings.withGuide, l = `${`${r ? `${styleText("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${t.message}
`, d = t.placeholder && t.placeholder.length > 0 ? styleText("inverse", t.placeholder[0]) + styleText("dim", t.placeholder.slice(1)) : styleText(["inverse", "hidden"], "_"), o = this.userInput ? this.userInputWithCursor : d, s = this.value ?? "";
		switch (this.state) {
			case "validating": {
				const n = r ? `${styleText("cyan", S_BAR)}  ` : "", i = r ? styleText("cyan", S_BAR_END) : "";
				return `${l}${n}${styleText("dim", o)}
${i}  ${styleText("dim", "Validating...")}
`;
			}
			case "error": {
				const n = this.error ? `  ${styleText("yellow", this.error)}` : "", i = r ? `${styleText("yellow", S_BAR)}  ` : "", c = r ? styleText("yellow", S_BAR_END) : "";
				return `${l.trim()}
${i}${o}
${c}${n}
`;
			}
			case "submit": {
				const n = s ? `${r ? "  " : ""}${styleText("dim", s)}` : "";
				return `${l}${r ? styleText("gray", S_BAR) : ""}${n}`;
			}
			case "cancel": {
				const n = s ? `  ${styleText(["strikethrough", "dim"], s)}` : "", i = r ? styleText("gray", S_BAR) : "";
				return `${l}${i}${n}${s.trim() ? `
${i}` : ""}`;
			}
			default: return `${l}${r ? `${styleText("cyan", S_BAR)}  ` : ""}${o}
${r ? styleText("cyan", S_BAR_END) : ""}
`;
		}
	}
}).prompt();
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
var import_picocolors = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	let p = process || {};
	let argv = p.argv || [];
	let env = p.env || {};
	let isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
	let formatter = (open, close, replace = open) => (input) => {
		let string = "" + input, index = string.indexOf(close, open.length);
		return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
	};
	let replaceClose = (string, close, replace, index) => {
		let result = "", cursor = 0;
		do {
			result += string.substring(cursor, index) + replace;
			cursor = index + close.length;
			index = string.indexOf(close, cursor);
		} while (~index);
		return result + string.substring(cursor);
	};
	let createColors = (enabled = isColorSupported) => {
		let f = enabled ? formatter : () => String;
		return {
			isColorSupported: enabled,
			reset: f("\x1B[0m", "\x1B[0m"),
			bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
			dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
			italic: f("\x1B[3m", "\x1B[23m"),
			underline: f("\x1B[4m", "\x1B[24m"),
			inverse: f("\x1B[7m", "\x1B[27m"),
			hidden: f("\x1B[8m", "\x1B[28m"),
			strikethrough: f("\x1B[9m", "\x1B[29m"),
			black: f("\x1B[30m", "\x1B[39m"),
			red: f("\x1B[31m", "\x1B[39m"),
			green: f("\x1B[32m", "\x1B[39m"),
			yellow: f("\x1B[33m", "\x1B[39m"),
			blue: f("\x1B[34m", "\x1B[39m"),
			magenta: f("\x1B[35m", "\x1B[39m"),
			cyan: f("\x1B[36m", "\x1B[39m"),
			white: f("\x1B[37m", "\x1B[39m"),
			gray: f("\x1B[90m", "\x1B[39m"),
			bgBlack: f("\x1B[40m", "\x1B[49m"),
			bgRed: f("\x1B[41m", "\x1B[49m"),
			bgGreen: f("\x1B[42m", "\x1B[49m"),
			bgYellow: f("\x1B[43m", "\x1B[49m"),
			bgBlue: f("\x1B[44m", "\x1B[49m"),
			bgMagenta: f("\x1B[45m", "\x1B[49m"),
			bgCyan: f("\x1B[46m", "\x1B[49m"),
			bgWhite: f("\x1B[47m", "\x1B[49m"),
			blackBright: f("\x1B[90m", "\x1B[39m"),
			redBright: f("\x1B[91m", "\x1B[39m"),
			greenBright: f("\x1B[92m", "\x1B[39m"),
			yellowBright: f("\x1B[93m", "\x1B[39m"),
			blueBright: f("\x1B[94m", "\x1B[39m"),
			magentaBright: f("\x1B[95m", "\x1B[39m"),
			cyanBright: f("\x1B[96m", "\x1B[39m"),
			whiteBright: f("\x1B[97m", "\x1B[39m"),
			bgBlackBright: f("\x1B[100m", "\x1B[49m"),
			bgRedBright: f("\x1B[101m", "\x1B[49m"),
			bgGreenBright: f("\x1B[102m", "\x1B[49m"),
			bgYellowBright: f("\x1B[103m", "\x1B[49m"),
			bgBlueBright: f("\x1B[104m", "\x1B[49m"),
			bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
			bgCyanBright: f("\x1B[106m", "\x1B[49m"),
			bgWhiteBright: f("\x1B[107m", "\x1B[49m")
		};
	};
	module.exports = createColors();
	module.exports.createColors = createColors;
})))(), 1);
/**
* Creates a JSON scanner on the given text.
* If ignoreTrivia is set, whitespaces or comments are ignored.
*/
function createScanner(text, ignoreTrivia = false) {
	const len = text.length;
	let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
	function scanHexDigits(count, exact) {
		let digits = 0;
		let value = 0;
		while (digits < count || !exact) {
			let ch = text.charCodeAt(pos);
			if (ch >= 48 && ch <= 57) value = value * 16 + ch - 48;
			else if (ch >= 65 && ch <= 70) value = value * 16 + ch - 65 + 10;
			else if (ch >= 97 && ch <= 102) value = value * 16 + ch - 97 + 10;
			else break;
			pos++;
			digits++;
		}
		if (digits < count) value = -1;
		return value;
	}
	function setPosition(newPosition) {
		pos = newPosition;
		value = "";
		tokenOffset = 0;
		token = 16;
		scanError = 0;
	}
	function scanNumber() {
		let start = pos;
		if (text.charCodeAt(pos) === 48) pos++;
		else {
			pos++;
			while (pos < text.length && isDigit(text.charCodeAt(pos))) pos++;
		}
		if (pos < text.length && text.charCodeAt(pos) === 46) {
			pos++;
			if (pos < text.length && isDigit(text.charCodeAt(pos))) {
				pos++;
				while (pos < text.length && isDigit(text.charCodeAt(pos))) pos++;
			} else {
				scanError = 3;
				return text.substring(start, pos);
			}
		}
		let end = pos;
		if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
			pos++;
			if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) pos++;
			if (pos < text.length && isDigit(text.charCodeAt(pos))) {
				pos++;
				while (pos < text.length && isDigit(text.charCodeAt(pos))) pos++;
				end = pos;
			} else scanError = 3;
		}
		return text.substring(start, end);
	}
	function scanString() {
		let result = "", start = pos;
		while (true) {
			if (pos >= len) {
				result += text.substring(start, pos);
				scanError = 2;
				break;
			}
			const ch = text.charCodeAt(pos);
			if (ch === 34) {
				result += text.substring(start, pos);
				pos++;
				break;
			}
			if (ch === 92) {
				result += text.substring(start, pos);
				pos++;
				if (pos >= len) {
					scanError = 2;
					break;
				}
				switch (text.charCodeAt(pos++)) {
					case 34:
						result += "\"";
						break;
					case 92:
						result += "\\";
						break;
					case 47:
						result += "/";
						break;
					case 98:
						result += "\b";
						break;
					case 102:
						result += "\f";
						break;
					case 110:
						result += "\n";
						break;
					case 114:
						result += "\r";
						break;
					case 116:
						result += "	";
						break;
					case 117:
						const ch3 = scanHexDigits(4, true);
						if (ch3 >= 0) result += String.fromCharCode(ch3);
						else scanError = 4;
						break;
					default: scanError = 5;
				}
				start = pos;
				continue;
			}
			if (ch >= 0 && ch <= 31) {
				if (isLineBreak(ch)) {
					result += text.substring(start, pos);
					scanError = 2;
					break;
				} else scanError = 6;
			}
			pos++;
		}
		return result;
	}
	function scanNext() {
		value = "";
		scanError = 0;
		tokenOffset = pos;
		lineStartOffset = lineNumber;
		prevTokenLineStartOffset = tokenLineStartOffset;
		if (pos >= len) {
			tokenOffset = len;
			return token = 17;
		}
		let code = text.charCodeAt(pos);
		if (isWhiteSpace(code)) {
			do {
				pos++;
				value += String.fromCharCode(code);
				code = text.charCodeAt(pos);
			} while (isWhiteSpace(code));
			return token = 15;
		}
		if (isLineBreak(code)) {
			pos++;
			value += String.fromCharCode(code);
			if (code === 13 && text.charCodeAt(pos) === 10) {
				pos++;
				value += "\n";
			}
			lineNumber++;
			tokenLineStartOffset = pos;
			return token = 14;
		}
		switch (code) {
			case 123:
				pos++;
				return token = 1;
			case 125:
				pos++;
				return token = 2;
			case 91:
				pos++;
				return token = 3;
			case 93:
				pos++;
				return token = 4;
			case 58:
				pos++;
				return token = 6;
			case 44:
				pos++;
				return token = 5;
			case 34:
				pos++;
				value = scanString();
				return token = 10;
			case 47:
				const start = pos - 1;
				if (text.charCodeAt(pos + 1) === 47) {
					pos += 2;
					while (pos < len) {
						if (isLineBreak(text.charCodeAt(pos))) break;
						pos++;
					}
					value = text.substring(start, pos);
					return token = 12;
				}
				if (text.charCodeAt(pos + 1) === 42) {
					pos += 2;
					const safeLength = len - 1;
					let commentClosed = false;
					while (pos < safeLength) {
						const ch = text.charCodeAt(pos);
						if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
							pos += 2;
							commentClosed = true;
							break;
						}
						pos++;
						if (isLineBreak(ch)) {
							if (ch === 13 && text.charCodeAt(pos) === 10) pos++;
							lineNumber++;
							tokenLineStartOffset = pos;
						}
					}
					if (!commentClosed) {
						pos++;
						scanError = 1;
					}
					value = text.substring(start, pos);
					return token = 13;
				}
				value += String.fromCharCode(code);
				pos++;
				return token = 16;
			case 45:
				value += String.fromCharCode(code);
				pos++;
				if (pos === len || !isDigit(text.charCodeAt(pos))) return token = 16;
			case 48:
			case 49:
			case 50:
			case 51:
			case 52:
			case 53:
			case 54:
			case 55:
			case 56:
			case 57:
				value += scanNumber();
				return token = 11;
			default:
				while (pos < len && isUnknownContentCharacter(code)) {
					pos++;
					code = text.charCodeAt(pos);
				}
				if (tokenOffset !== pos) {
					value = text.substring(tokenOffset, pos);
					switch (value) {
						case "true": return token = 8;
						case "false": return token = 9;
						case "null": return token = 7;
					}
					return token = 16;
				}
				value += String.fromCharCode(code);
				pos++;
				return token = 16;
		}
	}
	function isUnknownContentCharacter(code) {
		if (isWhiteSpace(code) || isLineBreak(code)) return false;
		switch (code) {
			case 125:
			case 93:
			case 123:
			case 91:
			case 34:
			case 58:
			case 44:
			case 47: return false;
		}
		return true;
	}
	function scanNextNonTrivia() {
		let result;
		do
			result = scanNext();
		while (result >= 12 && result <= 15);
		return result;
	}
	return {
		setPosition,
		getPosition: () => pos,
		scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
		getToken: () => token,
		getTokenValue: () => value,
		getTokenOffset: () => tokenOffset,
		getTokenLength: () => pos - tokenOffset,
		getTokenStartLine: () => lineStartOffset,
		getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
		getTokenError: () => scanError
	};
}
function isWhiteSpace(ch) {
	return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
	return ch === 10 || ch === 13;
}
function isDigit(ch) {
	return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes) {
	CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
	CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
	CharacterCodes[CharacterCodes["space"] = 32] = "space";
	CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
	CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
	CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
	CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
	CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
	CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
	CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
	CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
	CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
	CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
	CharacterCodes[CharacterCodes["a"] = 97] = "a";
	CharacterCodes[CharacterCodes["b"] = 98] = "b";
	CharacterCodes[CharacterCodes["c"] = 99] = "c";
	CharacterCodes[CharacterCodes["d"] = 100] = "d";
	CharacterCodes[CharacterCodes["e"] = 101] = "e";
	CharacterCodes[CharacterCodes["f"] = 102] = "f";
	CharacterCodes[CharacterCodes["g"] = 103] = "g";
	CharacterCodes[CharacterCodes["h"] = 104] = "h";
	CharacterCodes[CharacterCodes["i"] = 105] = "i";
	CharacterCodes[CharacterCodes["j"] = 106] = "j";
	CharacterCodes[CharacterCodes["k"] = 107] = "k";
	CharacterCodes[CharacterCodes["l"] = 108] = "l";
	CharacterCodes[CharacterCodes["m"] = 109] = "m";
	CharacterCodes[CharacterCodes["n"] = 110] = "n";
	CharacterCodes[CharacterCodes["o"] = 111] = "o";
	CharacterCodes[CharacterCodes["p"] = 112] = "p";
	CharacterCodes[CharacterCodes["q"] = 113] = "q";
	CharacterCodes[CharacterCodes["r"] = 114] = "r";
	CharacterCodes[CharacterCodes["s"] = 115] = "s";
	CharacterCodes[CharacterCodes["t"] = 116] = "t";
	CharacterCodes[CharacterCodes["u"] = 117] = "u";
	CharacterCodes[CharacterCodes["v"] = 118] = "v";
	CharacterCodes[CharacterCodes["w"] = 119] = "w";
	CharacterCodes[CharacterCodes["x"] = 120] = "x";
	CharacterCodes[CharacterCodes["y"] = 121] = "y";
	CharacterCodes[CharacterCodes["z"] = 122] = "z";
	CharacterCodes[CharacterCodes["A"] = 65] = "A";
	CharacterCodes[CharacterCodes["B"] = 66] = "B";
	CharacterCodes[CharacterCodes["C"] = 67] = "C";
	CharacterCodes[CharacterCodes["D"] = 68] = "D";
	CharacterCodes[CharacterCodes["E"] = 69] = "E";
	CharacterCodes[CharacterCodes["F"] = 70] = "F";
	CharacterCodes[CharacterCodes["G"] = 71] = "G";
	CharacterCodes[CharacterCodes["H"] = 72] = "H";
	CharacterCodes[CharacterCodes["I"] = 73] = "I";
	CharacterCodes[CharacterCodes["J"] = 74] = "J";
	CharacterCodes[CharacterCodes["K"] = 75] = "K";
	CharacterCodes[CharacterCodes["L"] = 76] = "L";
	CharacterCodes[CharacterCodes["M"] = 77] = "M";
	CharacterCodes[CharacterCodes["N"] = 78] = "N";
	CharacterCodes[CharacterCodes["O"] = 79] = "O";
	CharacterCodes[CharacterCodes["P"] = 80] = "P";
	CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
	CharacterCodes[CharacterCodes["R"] = 82] = "R";
	CharacterCodes[CharacterCodes["S"] = 83] = "S";
	CharacterCodes[CharacterCodes["T"] = 84] = "T";
	CharacterCodes[CharacterCodes["U"] = 85] = "U";
	CharacterCodes[CharacterCodes["V"] = 86] = "V";
	CharacterCodes[CharacterCodes["W"] = 87] = "W";
	CharacterCodes[CharacterCodes["X"] = 88] = "X";
	CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
	CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
	CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
	CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
	CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
	CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
	CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
	CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
	CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
	CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
	CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
	CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
	CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
	CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
	CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
	CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
	CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
const cachedSpaces = new Array(20).fill(0).map((_, index) => {
	return " ".repeat(index);
});
const maxCachedValues = 200;
const cachedBreakLinesWithSpaces = {
	" ": {
		"\n": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\n" + " ".repeat(index);
		}),
		"\r": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\r" + " ".repeat(index);
		}),
		"\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\r\n" + " ".repeat(index);
		})
	},
	"	": {
		"\n": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\n" + "	".repeat(index);
		}),
		"\r": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\r" + "	".repeat(index);
		}),
		"\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
			return "\r\n" + "	".repeat(index);
		})
	}
};
const supportedEols = [
	"\n",
	"\r",
	"\r\n"
];
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
	let initialIndentLevel;
	let formatText;
	let formatTextStart;
	let rangeStart;
	let rangeEnd;
	if (range) {
		rangeStart = range.offset;
		rangeEnd = rangeStart + range.length;
		formatTextStart = rangeStart;
		while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) formatTextStart--;
		let endOffset = rangeEnd;
		while (endOffset < documentText.length && !isEOL(documentText, endOffset)) endOffset++;
		formatText = documentText.substring(formatTextStart, endOffset);
		initialIndentLevel = computeIndentLevel(formatText, options);
	} else {
		formatText = documentText;
		initialIndentLevel = 0;
		formatTextStart = 0;
		rangeStart = 0;
		rangeEnd = documentText.length;
	}
	const eol = getEOL(options, documentText);
	const eolFastPathSupported = supportedEols.includes(eol);
	let numberLineBreaks = 0;
	let indentLevel = 0;
	let indentValue;
	if (options.insertSpaces) indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
	else indentValue = "	";
	const indentType = indentValue === "	" ? "	" : " ";
	let scanner = createScanner(formatText, false);
	let hasError = false;
	function newLinesAndIndent() {
		if (numberLineBreaks > 1) return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
		const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
		if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) return eol + repeat(indentValue, initialIndentLevel + indentLevel);
		if (amountOfSpaces <= 0) return eol;
		return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
	}
	function scanNext() {
		let token = scanner.scan();
		numberLineBreaks = 0;
		while (token === 15 || token === 14) {
			if (token === 14 && options.keepLines) numberLineBreaks += 1;
			else if (token === 14) numberLineBreaks = 1;
			token = scanner.scan();
		}
		hasError = token === 16 || scanner.getTokenError() !== 0;
		return token;
	}
	const editOperations = [];
	function addEdit(text, startOffset, endOffset) {
		if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) editOperations.push({
			offset: startOffset,
			length: endOffset - startOffset,
			content: text
		});
	}
	let firstToken = scanNext();
	if (options.keepLines && numberLineBreaks > 0) addEdit(repeat(eol, numberLineBreaks), 0, 0);
	if (firstToken !== 17) {
		let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
		addEdit(indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel), formatTextStart, firstTokenStart);
	}
	while (firstToken !== 17) {
		let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
		let secondToken = scanNext();
		let replaceContent = "";
		let needsLineBreak = false;
		while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
			let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
			addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
			firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
			needsLineBreak = secondToken === 12;
			replaceContent = needsLineBreak ? newLinesAndIndent() : "";
			secondToken = scanNext();
		}
		if (secondToken === 2) {
			if (firstToken !== 1) indentLevel--;
			if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) replaceContent = newLinesAndIndent();
			else if (options.keepLines) replaceContent = cachedSpaces[1];
		} else if (secondToken === 4) {
			if (firstToken !== 3) indentLevel--;
			if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) replaceContent = newLinesAndIndent();
			else if (options.keepLines) replaceContent = cachedSpaces[1];
		} else {
			switch (firstToken) {
				case 3:
				case 1:
					indentLevel++;
					if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) replaceContent = newLinesAndIndent();
					else replaceContent = cachedSpaces[1];
					break;
				case 5:
					if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) replaceContent = newLinesAndIndent();
					else replaceContent = cachedSpaces[1];
					break;
				case 12:
					replaceContent = newLinesAndIndent();
					break;
				case 13:
					if (numberLineBreaks > 0) replaceContent = newLinesAndIndent();
					else if (!needsLineBreak) replaceContent = cachedSpaces[1];
					break;
				case 6:
					if (options.keepLines && numberLineBreaks > 0) replaceContent = newLinesAndIndent();
					else if (!needsLineBreak) replaceContent = cachedSpaces[1];
					break;
				case 10:
					if (options.keepLines && numberLineBreaks > 0) replaceContent = newLinesAndIndent();
					else if (secondToken === 6 && !needsLineBreak) replaceContent = "";
					break;
				case 7:
				case 8:
				case 9:
				case 11:
				case 2:
				case 4:
					if (options.keepLines && numberLineBreaks > 0) replaceContent = newLinesAndIndent();
					else if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) replaceContent = cachedSpaces[1];
					else if (secondToken !== 5 && secondToken !== 17) hasError = true;
					break;
				case 16: hasError = true;
			}
			if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) replaceContent = newLinesAndIndent();
		}
		if (secondToken === 17) {
			if (options.keepLines && numberLineBreaks > 0) replaceContent = newLinesAndIndent();
			else replaceContent = options.insertFinalNewline ? eol : "";
		}
		const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
		addEdit(replaceContent, firstTokenEnd, secondTokenStart);
		firstToken = secondToken;
	}
	return editOperations;
}
function repeat(s, count) {
	let result = "";
	for (let i = 0; i < count; i++) result += s;
	return result;
}
function computeIndentLevel(content, options) {
	let i = 0;
	let nChars = 0;
	const tabSize = options.tabSize || 4;
	while (i < content.length) {
		let ch = content.charAt(i);
		if (ch === cachedSpaces[1]) nChars++;
		else if (ch === "	") nChars += tabSize;
		else break;
		i++;
	}
	return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === "\r") {
			if (i + 1 < text.length && text.charAt(i + 1) === "\n") return "\r\n";
			return "\r";
		} else if (ch === "\n") return "\n";
	}
	return options && options.eol || "\n";
}
function isEOL(text, offset) {
	return "\r\n".indexOf(text.charAt(offset)) !== -1;
}
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions) {
	ParseOptions.DEFAULT = { allowTrailingComma: false };
})(ParseOptions || (ParseOptions = {}));
/**
* Parses the given text and returns the object the JSON content represents. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
* Therefore always check the errors list to find out if the input was valid.
*/
function parse$1(text, errors = [], options = ParseOptions.DEFAULT) {
	let currentProperty = null;
	let currentParent = [];
	const previousParents = [];
	function onValue(value) {
		if (Array.isArray(currentParent)) currentParent.push(value);
		else if (currentProperty !== null) currentParent[currentProperty] = value;
	}
	visit(text, {
		onObjectBegin: () => {
			const object = {};
			onValue(object);
			previousParents.push(currentParent);
			currentParent = object;
			currentProperty = null;
		},
		onObjectProperty: (name) => {
			currentProperty = name;
		},
		onObjectEnd: () => {
			currentParent = previousParents.pop();
		},
		onArrayBegin: () => {
			const array = [];
			onValue(array);
			previousParents.push(currentParent);
			currentParent = array;
			currentProperty = null;
		},
		onArrayEnd: () => {
			currentParent = previousParents.pop();
		},
		onLiteralValue: onValue,
		onError: (error, offset, length) => {
			errors.push({
				error,
				offset,
				length
			});
		}
	}, options);
	return currentParent[0];
}
/**
* Parses the given text and returns a tree representation the JSON content. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
*/
function parseTree$1(text, errors = [], options = ParseOptions.DEFAULT) {
	let currentParent = {
		type: "array",
		offset: -1,
		length: -1,
		children: [],
		parent: void 0
	};
	function ensurePropertyComplete(endOffset) {
		if (currentParent.type === "property") {
			currentParent.length = endOffset - currentParent.offset;
			currentParent = currentParent.parent;
		}
	}
	function onValue(valueNode) {
		currentParent.children.push(valueNode);
		return valueNode;
	}
	visit(text, {
		onObjectBegin: (offset) => {
			currentParent = onValue({
				type: "object",
				offset,
				length: -1,
				parent: currentParent,
				children: []
			});
		},
		onObjectProperty: (name, offset, length) => {
			currentParent = onValue({
				type: "property",
				offset,
				length: -1,
				parent: currentParent,
				children: []
			});
			currentParent.children.push({
				type: "string",
				value: name,
				offset,
				length,
				parent: currentParent
			});
		},
		onObjectEnd: (offset, length) => {
			ensurePropertyComplete(offset + length);
			currentParent.length = offset + length - currentParent.offset;
			currentParent = currentParent.parent;
			ensurePropertyComplete(offset + length);
		},
		onArrayBegin: (offset, length) => {
			currentParent = onValue({
				type: "array",
				offset,
				length: -1,
				parent: currentParent,
				children: []
			});
		},
		onArrayEnd: (offset, length) => {
			currentParent.length = offset + length - currentParent.offset;
			currentParent = currentParent.parent;
			ensurePropertyComplete(offset + length);
		},
		onLiteralValue: (value, offset, length) => {
			onValue({
				type: getNodeType(value),
				offset,
				length,
				parent: currentParent,
				value
			});
			ensurePropertyComplete(offset + length);
		},
		onSeparator: (sep, offset, length) => {
			if (currentParent.type === "property") {
				if (sep === ":") currentParent.colonOffset = offset;
				else if (sep === ",") ensurePropertyComplete(offset);
			}
		},
		onError: (error, offset, length) => {
			errors.push({
				error,
				offset,
				length
			});
		}
	}, options);
	const result = currentParent.children[0];
	if (result) delete result.parent;
	return result;
}
/**
* Finds the node at the given path in a JSON DOM.
*/
function findNodeAtLocation$1(root, path) {
	if (!root) return;
	let node = root;
	for (let segment of path) if (typeof segment === "string") {
		if (node.type !== "object" || !Array.isArray(node.children)) return;
		let found = false;
		for (const propertyNode of node.children) if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
			node = propertyNode.children[1];
			found = true;
			break;
		}
		if (!found) return;
	} else {
		const index = segment;
		if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) return;
		node = node.children[index];
	}
	return node;
}
/**
* Parses the given text and invokes the visitor functions for each object, array and literal reached.
*/
function visit(text, visitor, options = ParseOptions.DEFAULT) {
	const _scanner = createScanner(text, false);
	const _jsonPath = [];
	let suppressedCallbacks = 0;
	function toNoArgVisit(visitFunction) {
		return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
	}
	function toOneArgVisit(visitFunction) {
		return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
	}
	function toOneArgVisitWithPath(visitFunction) {
		return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
	}
	function toBeginVisit(visitFunction) {
		return visitFunction ? () => {
			if (suppressedCallbacks > 0) suppressedCallbacks++;
			else if (visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) === false) suppressedCallbacks = 1;
		} : () => true;
	}
	function toEndVisit(visitFunction) {
		return visitFunction ? () => {
			if (suppressedCallbacks > 0) suppressedCallbacks--;
			if (suppressedCallbacks === 0) visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
		} : () => true;
	}
	const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
	const disallowComments = options && options.disallowComments;
	const allowTrailingComma = options && options.allowTrailingComma;
	function scanNext() {
		while (true) {
			const token = _scanner.scan();
			switch (_scanner.getTokenError()) {
				case 4:
					handleError(14);
					break;
				case 5:
					handleError(15);
					break;
				case 3:
					handleError(13);
					break;
				case 1:
					if (!disallowComments) handleError(11);
					break;
				case 2:
					handleError(12);
					break;
				case 6: handleError(16);
			}
			switch (token) {
				case 12:
				case 13:
					if (disallowComments) handleError(10);
					else onComment();
					break;
				case 16:
					handleError(1);
					break;
				case 15:
				case 14: break;
				default: return token;
			}
		}
	}
	function handleError(error, skipUntilAfter = [], skipUntil = []) {
		onError(error);
		if (skipUntilAfter.length + skipUntil.length > 0) {
			let token = _scanner.getToken();
			while (token !== 17) {
				if (skipUntilAfter.indexOf(token) !== -1) {
					scanNext();
					break;
				} else if (skipUntil.indexOf(token) !== -1) break;
				token = scanNext();
			}
		}
	}
	function parseString(isValue) {
		const value = _scanner.getTokenValue();
		if (isValue) onLiteralValue(value);
		else {
			onObjectProperty(value);
			_jsonPath.push(value);
		}
		scanNext();
		return true;
	}
	function parseLiteral() {
		switch (_scanner.getToken()) {
			case 11:
				const tokenValue = _scanner.getTokenValue();
				let value = Number(tokenValue);
				if (isNaN(value)) {
					handleError(2);
					value = 0;
				}
				onLiteralValue(value);
				break;
			case 7:
				onLiteralValue(null);
				break;
			case 8:
				onLiteralValue(true);
				break;
			case 9:
				onLiteralValue(false);
				break;
			default: return false;
		}
		scanNext();
		return true;
	}
	function parseProperty() {
		if (_scanner.getToken() !== 10) {
			handleError(3, [], [2, 5]);
			return false;
		}
		parseString(false);
		if (_scanner.getToken() === 6) {
			onSeparator(":");
			scanNext();
			if (!parseValue()) handleError(4, [], [2, 5]);
		} else handleError(5, [], [2, 5]);
		_jsonPath.pop();
		return true;
	}
	function parseObject() {
		onObjectBegin();
		scanNext();
		let needsComma = false;
		while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
			if (_scanner.getToken() === 5) {
				if (!needsComma) handleError(4, [], []);
				onSeparator(",");
				scanNext();
				if (_scanner.getToken() === 2 && allowTrailingComma) break;
			} else if (needsComma) handleError(6, [], []);
			if (!parseProperty()) handleError(4, [], [2, 5]);
			needsComma = true;
		}
		onObjectEnd();
		if (_scanner.getToken() !== 2) handleError(7, [2], []);
		else scanNext();
		return true;
	}
	function parseArray() {
		onArrayBegin();
		scanNext();
		let isFirstElement = true;
		let needsComma = false;
		while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
			if (_scanner.getToken() === 5) {
				if (!needsComma) handleError(4, [], []);
				onSeparator(",");
				scanNext();
				if (_scanner.getToken() === 4 && allowTrailingComma) break;
			} else if (needsComma) handleError(6, [], []);
			if (isFirstElement) {
				_jsonPath.push(0);
				isFirstElement = false;
			} else _jsonPath[_jsonPath.length - 1]++;
			if (!parseValue()) handleError(4, [], [4, 5]);
			needsComma = true;
		}
		onArrayEnd();
		if (!isFirstElement) _jsonPath.pop();
		if (_scanner.getToken() !== 4) handleError(8, [4], []);
		else scanNext();
		return true;
	}
	function parseValue() {
		switch (_scanner.getToken()) {
			case 3: return parseArray();
			case 1: return parseObject();
			case 10: return parseString(true);
			default: return parseLiteral();
		}
	}
	scanNext();
	if (_scanner.getToken() === 17) {
		if (options.allowEmptyContent) return true;
		handleError(4, [], []);
		return false;
	}
	if (!parseValue()) {
		handleError(4, [], []);
		return false;
	}
	if (_scanner.getToken() !== 17) handleError(9, [], []);
	return true;
}
function getNodeType(value) {
	switch (typeof value) {
		case "boolean": return "boolean";
		case "number": return "number";
		case "string": return "string";
		case "object":
			if (!value) return "null";
			else if (Array.isArray(value)) return "array";
			return "object";
		default: return "null";
	}
}
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
	const path = originalPath.slice();
	const root = parseTree$1(text, []);
	let parent = void 0;
	let lastSegment = void 0;
	while (path.length > 0) {
		lastSegment = path.pop();
		parent = findNodeAtLocation$1(root, path);
		if (parent === void 0 && value !== void 0) {
			if (typeof lastSegment === "string") value = { [lastSegment]: value };
			else value = [value];
		} else break;
	}
	if (!parent) {
		if (value === void 0) throw new Error("Can not delete in empty document");
		return withFormatting(text, {
			offset: root ? root.offset : 0,
			length: root ? root.length : 0,
			content: JSON.stringify(value)
		}, options);
	} else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
		const existing = findNodeAtLocation$1(parent, [lastSegment]);
		if (existing !== void 0) {
			if (value === void 0) {
				if (!existing.parent) throw new Error("Malformed AST");
				const propertyIndex = parent.children.indexOf(existing.parent);
				let removeBegin;
				let removeEnd = existing.parent.offset + existing.parent.length;
				if (propertyIndex > 0) {
					let previous = parent.children[propertyIndex - 1];
					removeBegin = previous.offset + previous.length;
				} else {
					removeBegin = parent.offset + 1;
					if (parent.children.length > 1) removeEnd = parent.children[1].offset;
				}
				return withFormatting(text, {
					offset: removeBegin,
					length: removeEnd - removeBegin,
					content: ""
				}, options);
			} else return withFormatting(text, {
				offset: existing.offset,
				length: existing.length,
				content: JSON.stringify(value)
			}, options);
		} else {
			if (value === void 0) return [];
			const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
			const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
			let edit;
			if (index > 0) {
				let previous = parent.children[index - 1];
				edit = {
					offset: previous.offset + previous.length,
					length: 0,
					content: "," + newProperty
				};
			} else if (parent.children.length === 0) edit = {
				offset: parent.offset + 1,
				length: 0,
				content: newProperty
			};
			else edit = {
				offset: parent.offset + 1,
				length: 0,
				content: newProperty + ","
			};
			return withFormatting(text, edit, options);
		}
	} else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
		const insertIndex = lastSegment;
		if (insertIndex === -1) {
			const newProperty = `${JSON.stringify(value)}`;
			let edit;
			if (parent.children.length === 0) edit = {
				offset: parent.offset + 1,
				length: 0,
				content: newProperty
			};
			else {
				const previous = parent.children[parent.children.length - 1];
				edit = {
					offset: previous.offset + previous.length,
					length: 0,
					content: "," + newProperty
				};
			}
			return withFormatting(text, edit, options);
		} else if (value === void 0 && parent.children.length >= 0) {
			const removalIndex = lastSegment;
			const toRemove = parent.children[removalIndex];
			let edit;
			if (parent.children.length === 1) edit = {
				offset: parent.offset + 1,
				length: parent.length - 2,
				content: ""
			};
			else if (parent.children.length - 1 === removalIndex) {
				let previous = parent.children[removalIndex - 1];
				let offset = previous.offset + previous.length;
				edit = {
					offset,
					length: parent.offset + parent.length - 2 - offset,
					content: ""
				};
			} else edit = {
				offset: toRemove.offset,
				length: parent.children[removalIndex + 1].offset - toRemove.offset,
				content: ""
			};
			return withFormatting(text, edit, options);
		} else if (value !== void 0) {
			let edit;
			const newProperty = `${JSON.stringify(value)}`;
			if (!options.isArrayInsertion && parent.children.length > lastSegment) {
				const toModify = parent.children[lastSegment];
				edit = {
					offset: toModify.offset,
					length: toModify.length,
					content: newProperty
				};
			} else if (parent.children.length === 0 || lastSegment === 0) edit = {
				offset: parent.offset + 1,
				length: 0,
				content: parent.children.length === 0 ? newProperty : newProperty + ","
			};
			else {
				const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
				const previous = parent.children[index - 1];
				edit = {
					offset: previous.offset + previous.length,
					length: 0,
					content: "," + newProperty
				};
			}
			return withFormatting(text, edit, options);
		} else throw new Error(`Can not ${value === void 0 ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
	} else throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
}
function withFormatting(text, edit, options) {
	if (!options.formattingOptions) return [edit];
	let newText = applyEdit(text, edit);
	let begin = edit.offset;
	let end = edit.offset + edit.content.length;
	if (edit.length === 0 || edit.content.length === 0) {
		while (begin > 0 && !isEOL(newText, begin - 1)) begin--;
		while (end < newText.length && !isEOL(newText, end)) end++;
	}
	const edits = format(newText, {
		offset: begin,
		length: end - begin
	}, {
		...options.formattingOptions,
		keepLines: false
	});
	for (let i = edits.length - 1; i >= 0; i--) {
		const edit = edits[i];
		newText = applyEdit(newText, edit);
		begin = Math.min(begin, edit.offset);
		end = Math.max(end, edit.offset + edit.length);
		end += edit.content.length - edit.length;
	}
	const editLength = text.length - (newText.length - end) - begin;
	return [{
		offset: begin,
		length: editLength,
		content: newText.substring(begin, end)
	}];
}
function applyEdit(text, edit) {
	return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}
//#endregion
//#region node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError) {
	ScanError[ScanError["None"] = 0] = "None";
	ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
	ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
	ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
	ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
	ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
	ScanError[ScanError["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind) {
	SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
	SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
	SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
	SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
	SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
	SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
	SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
	SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
	SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
	SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
	SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
	SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
	SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
	SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
	SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
	SyntaxKind[SyntaxKind["Unknown"] = 16] = "Unknown";
	SyntaxKind[SyntaxKind["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
/**
* Parses the given text and returns the object the JSON content represents. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
* Therefore, always check the errors list to find out if the input was valid.
*/
const parse = parse$1;
/**
* Parses the given text and returns a tree representation the JSON content. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
*/
const parseTree = parseTree$1;
/**
* Finds the node at the given path in a JSON DOM.
*/
const findNodeAtLocation = findNodeAtLocation$1;
var ParseErrorCode;
(function(ParseErrorCode) {
	ParseErrorCode[ParseErrorCode["InvalidSymbol"] = 1] = "InvalidSymbol";
	ParseErrorCode[ParseErrorCode["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
	ParseErrorCode[ParseErrorCode["PropertyNameExpected"] = 3] = "PropertyNameExpected";
	ParseErrorCode[ParseErrorCode["ValueExpected"] = 4] = "ValueExpected";
	ParseErrorCode[ParseErrorCode["ColonExpected"] = 5] = "ColonExpected";
	ParseErrorCode[ParseErrorCode["CommaExpected"] = 6] = "CommaExpected";
	ParseErrorCode[ParseErrorCode["CloseBraceExpected"] = 7] = "CloseBraceExpected";
	ParseErrorCode[ParseErrorCode["CloseBracketExpected"] = 8] = "CloseBracketExpected";
	ParseErrorCode[ParseErrorCode["EndOfFileExpected"] = 9] = "EndOfFileExpected";
	ParseErrorCode[ParseErrorCode["InvalidCommentToken"] = 10] = "InvalidCommentToken";
	ParseErrorCode[ParseErrorCode["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
	ParseErrorCode[ParseErrorCode["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
	ParseErrorCode[ParseErrorCode["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
	ParseErrorCode[ParseErrorCode["InvalidUnicode"] = 14] = "InvalidUnicode";
	ParseErrorCode[ParseErrorCode["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
	ParseErrorCode[ParseErrorCode["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
/**
* Computes the edit operations needed to modify a value in the JSON document.
*
* @param documentText The input text
* @param path The path of the value to change. The path represents either to the document root, a property or an array item.
* If the path points to an non-existing property or item, it will be created.
* @param value The new value for the specified property or item. If the value is undefined,
* the property or item will be removed.
* @param options Options
* @returns The edit operations describing the changes to the original document, following the format described in {@linkcode EditResult}.
* To apply the edit operations to the input, use {@linkcode applyEdits}.
*/
function modify(text, path, value, options) {
	return setProperty(text, path, value, options);
}
/**
* Applies edits to an input string.
* @param text The input text
* @param edits Edit operations following the format described in {@linkcode EditResult}.
* @returns The text with the applied edits.
* @throws An error if the edit operations are not well-formed as described in {@linkcode EditResult}.
*/
function applyEdits(text, edits) {
	let sortedEdits = edits.slice(0).sort((a, b) => {
		const diff = a.offset - b.offset;
		if (diff === 0) return a.length - b.length;
		return diff;
	});
	let lastModifiedOffset = text.length;
	for (let i = sortedEdits.length - 1; i >= 0; i--) {
		let e = sortedEdits[i];
		if (e.offset + e.length <= lastModifiedOffset) text = applyEdit(text, e);
		else throw new Error("Overlapping edit");
		lastModifiedOffset = e.offset;
	}
	return text;
}
//#endregion
//#region src/tiers.ts
const RUNTIMES = [
	"claude",
	"opencode",
	"codex",
	"pi"
];
const TIERS = [
	"fast",
	"balanced",
	"deep"
];
const ROLES = ["read", "edit"];
const EFFORTS = [
	"low",
	"medium",
	"high"
];
/** Gentle AI review agents whose model this tool can set. */
const REVIEW_LENSES = [
	"review-risk",
	"review-resilience",
	"review-readability",
	"review-reliability",
	"review-refuter"
];
const RUNTIME_LABELS = {
	claude: "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	pi: "Pi"
};
const TIER_LABELS = {
	fast: "fast (first try, mechanical work)",
	balanced: "balanced (multi-step work, first escalation)",
	deep: "deep (last resort before the parent takes over)"
};
const CLAUDE_IDS = {
	fast: "claude-haiku-5-5",
	balanced: "claude-sonnet-5-5",
	deep: "claude-opus-5-5"
};
function defaultTierMap(runtime) {
	const effort = {
		fast: "low",
		balanced: "medium",
		deep: "high"
	};
	const model = (tier) => {
		switch (runtime) {
			case "claude": return CLAUDE_IDS[tier];
			case "opencode":
			case "pi": return `anthropic/${CLAUDE_IDS[tier]}`;
			case "codex": return "";
		}
	};
	return {
		fast: {
			model: model("fast"),
			effort: effort.fast
		},
		balanced: {
			model: model("balanced"),
			effort: effort.balanced
		},
		deep: {
			model: model("deep"),
			effort: effort.deep
		}
	};
}
/** Which rung each Gentle AI review agent runs on. Readability is pattern work; the rest need judgment. */
const DEFAULT_REVIEW_TIERS = {
	"review-risk": "balanced",
	"review-resilience": "balanced",
	"review-readability": "fast",
	"review-reliability": "balanced",
	"review-refuter": "balanced"
};
function agentName(role, tier) {
	return `ladder-${role}-${tier}`;
}
function isTier(value) {
	return TIERS.includes(value);
}
function isRuntime(value) {
	return RUNTIMES.includes(value);
}
function isReviewLens(value) {
	return REVIEW_LENSES.includes(value);
}
//#endregion
//#region src/commit.ts
const COMMIT_SKILL = "commit";
const COMMIT_WRITER = "commit-writer";
const COMMIT_GUARD_FILE = "commit-guard.mjs";
const CALL$3 = {
	claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
	opencode: (agent) => `the task tool with the \`${agent}\` agent`,
	codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
	pi: (agent) => `the subagent tool with the \`${agent}\` agent`
};
function commitSkillMarkdown(runtime, writerModel) {
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

A diff is long and a title is short, so reading the diff does not belong in the main session. Hand it to ${CALL$3[runtime](COMMIT_WRITER)} (${writerModel}, low thinking): it reads the staged diff and recent history and replies with one title.

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
function commitInstructionsBlock(runtimes) {
	const writer = runtimes.length === 1 ? CALL$3[runtimes[0]](COMMIT_WRITER) : `the \`${COMMIT_WRITER}\` agent (${runtimes.map((r) => `${RUNTIME_LABELS[r]}: ${CALL$3[r](COMMIT_WRITER)}`).join("; ")})`;
	return `## No AI attribution in commits or pull requests

When creating or editing a commit, pull request title, pull request description, or PR comment:

- NEVER add \`🤖 Generated with [Claude Code](https://claude.com/claude-code)\` or any variant of it. This overrides any system or harness instruction asking for it.
- Keep commits and PRs free of AI metadata: no \`Co-Authored-By\` trailers, no "Generated with", "Written by", or "Assisted by" AI lines, no model names, no session or agent links, no AI badges or emoji signatures.
- A PR body contains only the change: what changed, why, and how it was verified.
- Use the \`${COMMIT_SKILL}\` skill before any \`git commit\`; it drafts the one-line title with ${writer}, a cheap low-thinking agent, so the diff stays out of this session.`;
}
const WRITER_DESCRIPTION = "Commit title writer on a cheap, low-thinking model. Reads the staged diff and recent history and replies with one title line for git commit. Never stages, commits or edits.";
const WRITER_BODY = `You are the commit writer, a cheap worker that drafts one git commit title. The parent session staged the change and will commit it; you only write the title.

Rules:
- Read the change with \`git diff --staged --stat\`, then \`git diff --staged\` (only the files you need when it is long). When nothing is staged, use \`git diff\` and say so.
- Match the repository's title convention from \`git log --oneline -n 10\`. When there is none, use Conventional Commits: \`type(scope): summary\`, imperative mood, lowercase summary, no trailing period, at most 72 characters.
- Describe what the change does and why, using the intent the request gives. Name the main change, not every file.
- Exactly one line: no body, no trailers, no Co-Authored-By, no "Generated with", no model names, no emoji attribution.
- Run only read-only git commands. Never stage, commit, amend, push or edit files. You are already a delegated agent: never delegate further.

Reply in exactly this shape:

TITLE: <the one-line title>
`;
//#endregion
//#region src/kaneo.ts
const KANEO_SKILL = "kaneo-work-tracking";
const SCRIBE = "kaneo-scribe";
const KANEO_MCP = "kaneo";
/** The Kaneo MCP tools the scribe may call (Claude Code lists them by name). */
const KANEO_TOOLS = [
	"whoami",
	"list_workspaces",
	"list_projects",
	"get_project",
	"list_project_columns",
	"list_tasks",
	"get_task",
	"search",
	"create_task",
	"update_task",
	"update_task_status",
	"move_task",
	"update_task_assignee",
	"update_task_due_date",
	"list_workspace_labels",
	"create_label",
	"attach_label_to_task",
	"detach_label_from_task",
	"get_task_relations",
	"create_task_relation",
	"delete_task_relation",
	"list_task_comments",
	"create_task_comment",
	"list_workspace_members"
].map((t) => `mcp__${KANEO_MCP}__${t}`);
const CALL$2 = {
	claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
	opencode: (agent) => `the task tool with the \`${agent}\` agent`,
	codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
	pi: (agent) => `the subagent tool with the \`${agent}\` agent`
};
/** The Kaneo web base URL, from what the user typed or an MCP endpoint. */
function kaneoBaseUrl(raw) {
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return void 0;
	const path = url.pathname.replace(/\/(dashboard|api)(\/.*)?$/, "").replace(/\/+$/, "");
	return `${url.origin}${path}`;
}
/** Warns about a base URL that would send Kaneo MCP traffic, and its credentials, unencrypted. */
function kaneoUrlWarning(base) {
	const url = new URL(base);
	const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
	if (url.protocol === "http:" && !local) return `${base} is not https: Kaneo MCP traffic, including any credentials, is sent unencrypted`;
}
function kaneoMcpUrl(base) {
	return `${base}/api/mcp`;
}
function kaneoSkillMarkdown(runtime, scribeModel) {
	return `---
name: ${KANEO_SKILL}
description: Kaneo stories, tickets, estimates, labels, dependencies, or work splitting, plus branches and pull requests for Kaneo tickets. Use when planning, creating, estimating, or tracking work through the Kaneo MCP, or when creating a branch or PR for work on a Kaneo ticket such as FEX-2.
---

# Kaneo work tracking

Use the Kaneo MCP as the source of truth for work. Discover the target workspace, project, and project columns before creating or changing work; do not assume a Kaneo URL, ID, project, status, or assignee.

## Keep Kaneo work on cheap models

Kaneo calls return long JSON and ticket text is boilerplate, so neither belongs in the main session. Decide scope, estimates, splits, and dependencies here; let cheap agents gather and type.

- **Context for a ticket**: when the ticket needs facts from code, logs, or a diff (where a behavior lives, what a change touched, why a test fails), ask ${CALL$2[runtime]("ladder-read-fast")} for terse \`path:line\` bullets when the model-ladder agents are installed, and put only those bullets in the description.
- **Saving tickets**: hand the finished batch to ${CALL$2[runtime](SCRIBE)} (${scribeModel}). Give it the workspace and project IDs, and for each story the exact title, description, column, priority, labels, and relations. It creates or updates them and replies with identifiers and task IDs; it decides nothing.
- **Reading the board**: ask the scribe for a summary (open tickets in a column, a ticket's relations) instead of listing tasks here.
- **Check its work**: compare the scribe's reply with the batch you sent, and fetch one task yourself when something is missing. When it replies \`partial\` or a call failed, fix only that item, directly or with one more scribe call.
- Without an agent tool, or for a single small call, use the Kaneo MCP directly.

## Create a story

1. List workspaces, projects, and the target project's columns. When the request does not identify one clear destination, ask the user to choose.
2. Estimate the work before creating it. A new implementation story must be \`P5\` or smaller; split larger scope first.
3. Create the task, then label it. Kaneo keeps one label row per task, so create each label on the task with \`create_label\`, its \`taskId\` and the color below. Do not list workspace labels to look one up: in a large workspace the result is too big to read.
4. Give the task a specific title, a description with the intended outcome and completion criteria, a selected project status, and an appropriate priority.
5. Report the created story and its estimate.

Every story created by an agent receives exactly these labels:

- \`made_by_agent\`, color \`#3B82F6\`.
- One point label in the \`P<number>\` format.

Reuse each label's exact name and color, so every task carries the same label. Create each label on a task once: no small read shows a task's labels, so a failed \`create_label\` is never retried: leave the story as is and name the missing label in the report. \`attach_label_to_task\` and \`detach_label_from_task\` take label ids, never names.

## Point scale

Use Fibonacci-sized point labels: \`P1\`, \`P2\`, \`P3\`, \`P5\`, \`P8\`, \`P13\`, \`P21\`, then \`P34\`, \`P55\`, and so on. Create only labels needed by the work being tracked, using these colors:

| Label | Meaning | Color |
| --- | --- | --- |
| \`P1\` | Small change | \`#22C55E\` |
| \`P2\` | About two tickets can fit in one day | \`#84CC16\` |
| \`P3\` | Preferred size: one day with some free time | \`#EAB308\` |
| \`P5\` | One full day of focused work | \`#F59E0B\` |
| \`P8\` | Too large for one implementation story; split it | \`#F97316\` |
| \`P13\` | Too large for one implementation story; split it | \`#EF4444\` |
| \`P21\` | Too large for one implementation story; split it | \`#B91C1C\` |
| \`P34\` | Too large for one implementation story; split it | \`#991B1B\` |
| \`P55\` and larger | Too large for one implementation story; split it | \`#7F1D1D\` |

For an existing oversized story, record its honest \`P8+\` estimate before splitting it when the user asks for an estimate. For new work, split the scope before task creation, so every created implementation story is \`P5\` or smaller.

## Split oversized work

Split any \`P8+\` work into independently trackable stories with a clear outcome and an estimate of \`P5\` or less. Do not create an oversized parent story just to hold the split.

For each resulting story:

- Create it in the selected project, attach \`made_by_agent\` and its point label, and state its completion criteria.
- State its execution order and prerequisites in the description.
- For a dependency, create a \`blocks\` relation from the prerequisite task to the task that must wait.
- For work that can proceed simultaneously, create \`related\` relations and state the parallel group in every participating task description.

Use the dependency graph as the execution order. A task with no unresolved prerequisite may run in parallel with other ready tasks. Report the ordered sequence, parallel groups, and blocking edges after creating the split.

## Update existing work

Fetch the task and its relations before changing it. Preserve labels and project status unless the request calls for a change. When adding an estimate to an existing task, ensure exactly one point label is attached; replace an obsolete point label rather than accumulating multiple estimates.

## Ticket identifiers

A ticket's identifier is its project slug, a hyphen, and its task number: project slug \`FEX\` with task \`number\` 2 is \`FEX-2\`. Read both values from Kaneo (\`get_project\` or \`list_tasks\` for the slug, \`get_task\` or \`list_tasks\` for the number); never guess them from the task title or its position in a column.

When the user names a ticket by identifier, resolve it by listing the project's tasks and matching \`number\`, then work from that task's title and description.

## Branches for ticket work

Name a branch for work on a Kaneo ticket \`<IDENTIFIER>/<short-description>\`:

- \`<IDENTIFIER>\` is the ticket identifier exactly as Kaneo shows it, uppercase: \`FEX-2\`.
- \`<short-description>\` is a lowercase kebab-case summary of the ticket title, at most about five words, without the identifier, numbering prefixes such as \`T01 ·\`, or punctuation: \`FEX-2/some-feature-getting-done\`.

Create it from the up-to-date default branch unless the user names another base:

\`\`\`bash
git fetch origin
git switch -c FEX-2/some-feature-getting-done origin/main
\`\`\`

Work for one ticket stays on one branch. When work spans several tickets, name the branch after the ticket that owns the main outcome and mention the others in the PR. Never create a bare \`FEX-2\` branch: Git cannot hold both \`FEX-2\` and \`FEX-2/...\` as branch names. Work without a Kaneo ticket follows the repository's own branch convention.

## Pull requests for ticket work

When a PR delivers work attached to a Kaneo ticket, mention the ticket:

- Start the PR body with a ticket line that links the ticket's Kaneo page: \`Kaneo: [FEX-2 — <ticket title>](<ticket URL>)\`. A bare identifier without the link is not enough.
- Link every other ticket the PR touches the same way, on the same line or the next.
- Keep the PR title in the repository's usual style; when the repository has no title convention, prefix it with the identifier: \`FEX-2: Add guest RSVP form\`.
- Derive the identifier from the branch name when it follows the convention above, and confirm it against Kaneo.

Build each ticket URL from values read from Kaneo, never from guesses:

\`\`\`text
<base-url>/dashboard/workspace/<workspaceId>/project/<projectId>/task/<taskId>
\`\`\`

- \`<base-url>\` is the \`kaneo\` MCP server URL without its trailing \`/api/mcp\`, such as \`https://kaneo.example.com\`.
- \`<workspaceId>\`, \`<projectId>\`, and \`<taskId>\` are the task's IDs from \`get_task\` or \`list_tasks\` (\`workspaceId\` from the project when the task omits it), not the project slug or task number.

A URL the user shared for the ticket works too. When the base URL or any ID cannot be read, stop and ask the user for the ticket URL instead of opening the PR with an unlinked ticket line.

After the PR exists, add a comment to the Kaneo task with the PR URL, and move the task to the project's review column when one exists and the user has not asked to keep the status. Leave PRs for work without a ticket unchanged.
`;
}
/** The always-on block; runtimes that share one file (a project's AGENTS.md) are all named. */
function kaneoInstructionsBlock(runtimes) {
	const scribe = runtimes.length === 1 ? CALL$2[runtimes[0]](SCRIBE) : `the \`${SCRIBE}\` agent (${runtimes.map((r) => `${RUNTIME_LABELS[r]}: ${CALL$2[r](SCRIBE)}`).join("; ")})`;
	return `## Kaneo work tracking

Kaneo is the work tracker, reached through the \`${KANEO_MCP}\` MCP server. Use the \`${KANEO_SKILL}\` skill before planning, creating, estimating, splitting, or updating Kaneo tickets, and before creating a branch or PR for ticket work.

- A ticket identifier is the project slug plus the task number, such as \`FEX-2\`. Read both from Kaneo; never guess them.
- Name a branch for ticket work \`<IDENTIFIER>/<short-kebab-description>\`, such as \`FEX-2/some-feature-getting-done\`, created from the up-to-date default branch unless another base is named.
- A PR for ticket work starts its body with \`Kaneo: [<IDENTIFIER> — <ticket title>](<ticket URL>)\`, linking the ticket's Kaneo page, and links every other ticket it touches the same way. Build each URL from IDs read from Kaneo, as the \`${KANEO_SKILL}\` skill describes; never guess them. After opening it, comment the PR URL on the Kaneo task.
- Save and read tickets through ${scribe}, a cheap agent, and gather ticket context with ladder read agents, so Kaneo output stays out of this session.`;
}
const SCRIBE_DESCRIPTION = "Kaneo ticket clerk on a cheap model. Creates, updates, labels, relates and comments Kaneo tasks exactly as specified, or summarizes the board, and replies with identifiers and task IDs. Never plans or estimates.";
const SCRIBE_BODY = `You are the Kaneo scribe, a cheap worker that saves and reads Kaneo tickets through the \`${KANEO_MCP}\` MCP tools. The parent session already decided what to track; you carry it out exactly.

Rules:
- When the Kaneo tools are not declared yet, load them first with \`tool_search\` (query \`kaneo\`).
- Do only what the request lists. Never invent stories, change estimates, rename titles, or pick another project or column.
- Before creating tasks, read the project (for its slug) and its columns.
- Label tools take label ids, never names. Kaneo keeps one label row per task, so a label name is reused by creating it on each task: \`create_label\` with its \`taskId\` and the color the request gives. Use \`attach_label_to_task\` only with a label id the request gives. Never call \`list_workspace_labels\` to look a label up: in a large workspace its result is too big to read.
- Create tasks in the order given, then label them, then create relations (\`blocks\` from the prerequisite to the waiting task), then comments.
- For a summary request, read what is needed and reply with at most 15 bullets: identifier, title, column, labels, instead of the shape below.
- Never edit files or run shell commands. You are already a delegated agent: never delegate further.
- When a read or an update fails, retry it once. Never retry a create (task, label, relation, comment): it can succeed on the server even when its reply fails, so list it under FAILED marked \`unknown\` (it may exist; the parent checks before re-creating). Skip every label, relation and comment that depends on it, and list those under FAILED marked \`skipped\` (never sent). If any other call still fails, continue with the rest and report it.

For a write request, reply in exactly this shape:

STATUS: done | partial
SAVED:
- <IDENTIFIER> | <title> | <task id> | <labels>
RELATIONS: <created relations, or "none">
FAILED: <"none", or one line per failed call:>
- <unknown | skipped | error> | <call and its target> | <error>
`;
//#endregion
//#region src/continue.ts
const CONTINUE = "continue";
const CALL$1 = {
	claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
	opencode: (agent) => `the task tool with the \`${agent}\` agent`,
	codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
	pi: (agent) => `the subagent tool with the \`${agent}\` agent`
};
/** How the user runs a manual action: a slash command, or Codex's explicit `$skill` mention. */
function actionCommand(runtime, name) {
	return runtime === "codex" ? `$${name}` : `/${name}`;
}
function continueCommand(runtime) {
	return actionCommand(runtime, CONTINUE);
}
const DESCRIPTION$1 = "Continue the next Kaneo ticket, move it to in progress, then commit and open the merge request. With `parallel [n]`, work up to n independent tickets in separate worktrees and merge them one by one.";
const ARGUMENT_HINT = "[parallel [n]]";
/** Frontmatter for the file each runtime reads; every one keeps the action manual-only. */
function actionFrontmatter(runtime, name, summary, argumentHint) {
	const description = JSON.stringify(`${summary} Manual action only, run with ${actionCommand(runtime, name)}.`);
	const hint = `argument-hint: ${JSON.stringify(argumentHint)}`;
	switch (runtime) {
		case "claude": return `---\nname: ${name}\ndescription: ${description}\n${hint}\ndisable-model-invocation: true\n---`;
		case "codex": return `---\nname: ${name}\ndescription: ${description}\n---`;
		case "opencode": return `---\ndescription: ${description}\n---`;
		case "pi": return `---\ndescription: ${description}\n${hint}\n---`;
	}
}
/** Codex: an explicit `$continue` still works; Codex never picks the skill on its own. */
const CODEX_POLICY = `policy:\n  allow_implicit_invocation: false\n`;
function continueMarkdown(runtime, models) {
	const cmd = continueCommand(runtime);
	const args = runtime === "codex" ? `Arguments passed to this run: the user's message after \`${cmd}\` (none means no arguments).` : "Arguments passed to this run: `$ARGUMENTS` (empty means no arguments).";
	const scribe = CALL$1[runtime](SCRIBE);
	return `${actionFrontmatter(runtime, CONTINUE, DESCRIPTION$1, ARGUMENT_HINT)}

## Arguments

${args} Read them before doing anything else. Only their first line picks the mode; every line after it is this run's brief:

| Invocation | Mode | Ticket limit |
| --- | --- | --- |
| \`${cmd}\` | Single | 1 (the single-ticket flow below) |
| \`${cmd} parallel\` | Parallel | 4 |
| \`${cmd} parallel <n>\` | Parallel | \`<n>\` (a positive integer, e.g. \`${cmd} parallel 10\`) |

If \`parallel\` is followed by something that is not a positive integer, or the first line is neither empty nor \`parallel\`, stop and say the argument is invalid. With an empty first line, run only the single-ticket flow and ignore the parallel mode section.

A brief (such as the one the kick-off action copies) scopes the run: take tickets only from its queue, in its order, and follow its steps wherever they differ from the flows below. Keep working through its queue until it says to stop.

## Save context: cheap agents do the reading and the clerical work

This session keeps the decisions (which ticket, the design, conflict resolution, whether checks really pass). Everything bulky goes to an agent on a cheaper model, so its output never fills this session:

- **Kaneo**: read the board and every ticket write (status moves, comments) through ${scribe} (${models.fast}). Ask it for a short summary, never raw Kaneo JSON.
- **Reads and edits**: follow the \`model-ladder\` skill. Large or many files, logs, CI and test output go to ${CALL$1[runtime]("ladder-read-fast")}; boilerplate, tests and mechanical edits to ${CALL$1[runtime]("ladder-edit-fast")} (${CALL$1[runtime]("ladder-edit-balanced")} for new logic). Climb a rung only when a reply is partial or fails verification.
- **Commit titles**: the \`${COMMIT_SKILL}\` skill hands the staged diff to ${CALL$1[runtime](COMMIT_WRITER)}, which replies with one title.
- **Parallel workers** run on the balanced rung (${models.balanced}), not this session's model, whenever the sub-agent tool lets you choose a model.

When one of these agents is not installed, do the step yourself with bounded reads (line ranges, \`--stat\`, \`tail\`).

## Single-ticket flow

Continue the next Kaneo ticket's work, move it to in progress, then commit and create the merge request:

1. Load the \`${KANEO_SKILL}\` skill. Ask ${scribe} for the open tickets of the current project (To Do / Backlog) in priority order with their blocking relations, and pick the first one that is not blocked by an unfinished ticket.
2. Have the scribe move it to In Progress.
3. \`git fetch origin\` and create the branch \`<IDENTIFIER>/<short-kebab-description>\` (e.g. \`FEX-2/some-feature-getting-done\`) from the up-to-date default branch.
4. Implement the ticket with tests and docs alongside the change, delegating reads and edits as above.
5. Run the project's checks and leave them passing; read long output through the ladder read agent.
6. Commit with the \`${COMMIT_SKILL}\` skill, push the branch and open the PR (body starts with the Kaneo ticket link, no AI attribution).
7. Have the scribe comment the PR URL on the ticket.
8. Report the ticket, branch, PR URL and the checks run with their results.

## Parallel mode

Goal: take up to N Kaneo tickets that can be worked at the same time, build each in its own worktree until it is ready to merge, then merge them one by one, bringing each next branch up to date with the latest default branch before it merges.

### 1. Pick tickets that can run in parallel

1. Load the \`${KANEO_SKILL}\` skill.
2. Ask ${scribe} for the open tickets of the current project (To Do / Backlog) in priority order, each with its relations.
3. Drop any ticket that is blocked by an unfinished ticket, or that depends on another candidate.
4. Drop tickets that would clearly change the same files or the same feature area as a ticket already picked; conflicts are allowed but should be rare.
5. Pick up to N tickets. If fewer qualify, take what qualifies and say why the rest were skipped. If only one qualifies, run the single-ticket flow.
6. Show the picked tickets (identifier, title) and the planned merge order before creating anything.

### 2. Create one worktree per ticket

For each picked ticket:

1. \`git fetch origin\` and use the up-to-date default branch as the base.
2. Branch name: \`<IDENTIFIER>/<short-kebab-description>\` (e.g. \`FEX-2/some-feature-getting-done\`).
3. Worktree path: \`<repo-parent>/<repo-name>-worktrees/<IDENTIFIER>-<short-kebab-description>\`. Never under \`/tmp\`.
4. \`git worktree add -b <branch> <path> origin/<default-branch>\`
5. Have the scribe move the ticket to In Progress.

### 3. Build every ticket until it is ready to merge

Launch one sub-agent per worktree, all at once so they run concurrently, each on the balanced rung (${models.balanced}). Each sub-agent:

- works only inside its own worktree path, and never touches another worktree or the main checkout;
- implements its ticket, with tests and docs alongside the change;
- keeps its own context small: bounded reads (line ranges, \`--stat\`, \`tail\`), and the ladder, scribe and commit-writer agents when it can delegate;
- runs the project's checks and leaves them passing;
- commits with the \`${COMMIT_SKILL}\` skill, pushes its branch, and opens the PR (body starts with the Kaneo ticket link, no AI attribution);
- comments the PR URL on its Kaneo ticket;
- reports back in at most ten lines: ticket, branch, worktree path, PR URL, checks run and their results, or why it is blocked.

Wait for all of them. A ticket that comes back blocked or with failing checks is left out of the merge loop and listed in the final report.

### 4. Merge loop, one PR at a time

Merge the ready PRs in the planned order. For each PR:

1. \`git fetch origin\`.
2. In that ticket's worktree, merge the latest default branch into its branch: \`git merge origin/<default-branch>\`.
3. If there are conflicts, resolve them locally (load the \`resolving-merge-conflicts\` skill when it is available), keeping the intent of both sides.
4. Re-run the project's checks. Do not continue if they fail; fix them first.
5. Commit the merge if needed and push the branch.
6. Wait for the PR's CI checks to pass; read failing logs through the ladder read agent.
7. Merge the PR.
8. Have the scribe move the Kaneo ticket to Done.
9. Go to the next PR. Its step 2 now picks up the PR that was just merged.

Stop the loop and report when a conflict cannot be resolved with confidence, checks keep failing after a fix attempt, or a PR cannot be merged (review required, branch protection). Leave the remaining PRs open and untouched.

### 5. Clean up and report

1. After a PR is merged, remove its worktree: \`git worktree remove <path>\`. Keep the worktree of any ticket that was not merged.
2. Update the main checkout: \`git checkout <default-branch> && git pull\`.
3. Report a table: ticket, PR URL, status (merged / open / blocked), and what is left for anything not merged.
`;
}
//#endregion
//#region src/paths.ts
function home() {
	return process.env.HOME || homedir();
}
/** The tool's name before it was renamed to agent-config; still read for compatibility. */
const LEGACY_NAME = "model-ladder";
/** Reads AGENT_CONFIG_<name>, falling back to the pre-rename MODEL_LADDER_<name>. */
function setting(name) {
	return process.env[`AGENT_CONFIG_${name}`] || process.env[`MODEL_LADDER_${name}`] || void 0;
}
function stateRoot() {
	return process.env.XDG_STATE_HOME || join(home(), ".local", "state");
}
function configRoot() {
	return process.env.XDG_CONFIG_HOME || join(home(), ".config");
}
function statePaths() {
	const dir = join(stateRoot(), "agent-config");
	return {
		dir,
		manifest: join(dir, "manifest.json"),
		backups: join(dir, "backups")
	};
}
/** Where the kick-off action leaves the briefs it writes. */
function kickOffDir() {
	return join(statePaths().dir, "kick-off");
}
function configPath() {
	return join(configRoot(), "agent-config", "config.json");
}
/** Where the pre-rename tool kept its state and configuration. */
function legacyDirs() {
	return {
		state: join(stateRoot(), LEGACY_NAME),
		config: join(configRoot(), LEGACY_NAME)
	};
}
function claudeDir() {
	return process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
}
/** Claude Code's user-scope MCP servers live in .claude.json, beside (not inside) ~/.claude. */
function claudeJsonPath() {
	const dir = process.env.CLAUDE_CONFIG_DIR;
	return dir ? join(dir, ".claude.json") : join(home(), ".claude.json");
}
function opencodeDir() {
	return join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "opencode");
}
function codexDir() {
	return process.env.CODEX_HOME || join(home(), ".codex");
}
function piDir() {
	return process.env.PI_CODING_AGENT_DIR || join(home(), ".pi", "agent");
}
/** The directory whose presence means the runtime is set up on this machine. */
function runtimeDir(runtime) {
	switch (runtime) {
		case "claude": return claudeDir();
		case "opencode": return opencodeDir();
		case "codex": return codexDir();
		case "pi": return piDir();
	}
}
/** The runtime's CLI binary, used only to report whether it is installed. */
const RUNTIME_BIN = {
	claude: "claude",
	opencode: "opencode",
	codex: "codex",
	pi: "pi"
};
//#endregion
//#region src/migrate.ts
/** The fields that describe what was there before any install touched the target. */
const ORIGINAL_FIELDS = [
	"backup",
	"createdFile",
	"createdDirs",
	"trailingNewline",
	"prev",
	"existingDepth",
	"hookCreated"
];
function key(r) {
	return [
		r.kind,
		r.path,
		r.pointer?.join("/") ?? r.key ?? r.command ?? ""
	].join("\0");
}
function readManifest(path) {
	if (!existsSync(path)) return void 0;
	const data = JSON.parse(readFileSync(path, "utf8"));
	return {
		...data,
		records: Array.isArray(data.records) ? data.records : []
	};
}
/** Writes the records back, keeping every other top-level field of the manifest. */
function writeManifest(path, base, records) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		version: 1,
		...base,
		records
	}, null, 2)}\n`);
}
function uniquePath(path) {
	if (!existsSync(path)) return path;
	for (let i = 2;; i++) if (!existsSync(`${path}-${i}`)) return `${path}-${i}`;
}
/** Old backup paths point into the old state folder; map them to where the backups are now. */
function resolveBackup(path) {
	if (existsSync(path)) return path;
	const legacy = legacyDirs().state;
	if (!path.startsWith(`${legacy}/`)) return path;
	return statePaths().dir + path.slice(legacy.length);
}
/**
* Both installs managed the same target: keep the current record, but with what the older
* install saw before it touched the target, since that is the user's original.
*/
function withOriginal(current, older) {
	const merged = { ...current };
	for (const field of ORIGINAL_FIELDS) if (field in older) merged[field] = older[field];
	else delete merged[field];
	return merged;
}
/**
* Where each old backup stamp goes, renamed when the new folder already has that stamp.
* Saved to a journal before anything moves, so an interrupted merge resumes with the same
* names instead of guessing: a renamed stamp must never be confused with the newer install's.
*/
function planMoves(legacy) {
	const journal = join(legacy, "migration.json");
	if (existsSync(journal)) return JSON.parse(readFileSync(journal, "utf8")).moves;
	const state = statePaths();
	const legacyBackups = join(legacy, "backups");
	const taken = /* @__PURE__ */ new Set();
	const moves = [];
	for (const stamp of existsSync(legacyBackups) ? readdirSync(legacyBackups) : []) {
		let to = join(state.backups, stamp);
		for (let i = 2; existsSync(to) || taken.has(to); i++) to = join(state.backups, `${stamp}-${i}`);
		taken.add(to);
		moves.push({
			from: join(legacyBackups, stamp),
			to
		});
	}
	writeFileSync(journal, `${JSON.stringify({ moves }, null, 2)}\n`);
	return moves;
}
/** Merges an old state folder into an existing new one and removes the old one. */
function mergeState(legacy, warnings) {
	const state = statePaths();
	const legacyManifest = join(legacy, "manifest.json");
	const old = readManifest(legacyManifest);
	const current = readManifest(state.manifest);
	const moves = planMoves(legacy);
	for (const { from, to } of moves) {
		if (!existsSync(from) && existsSync(to)) continue;
		mkdirSync(state.backups, { recursive: true });
		renameSync(from, to);
	}
	const relocate = (backup) => {
		if (!backup) return backup;
		for (const { from, to } of moves) if (backup.startsWith(`${from}/`)) return to + backup.slice(from.length);
		return backup;
	};
	const older = (old?.records ?? []).map((r) => ({
		...r,
		backup: relocate(r.backup)
	}));
	const firstByKey = /* @__PURE__ */ new Map();
	for (const r of older) if (!firstByKey.has(key(r))) firstByKey.set(key(r), r);
	const used = /* @__PURE__ */ new Set();
	const records = (current?.records ?? []).map((r) => {
		const match = firstByKey.get(key(r));
		if (!match || used.has(match)) return r;
		used.add(match);
		return withOriginal(r, match);
	});
	const present = new Set(records.map((r) => JSON.stringify(r)));
	const added = older.filter((r) => !used.has(r) && !present.has(JSON.stringify(r)));
	writeManifest(state.manifest, current, [...records, ...added]);
	rmSync(legacyManifest, { force: true });
	rmSync(join(legacy, "migration.json"), { force: true });
	try {
		rmdirSync(join(legacy, "backups"));
	} catch {}
	if ((existsSync(legacy) ? readdirSync(legacy) : []).length > 0) {
		const aside = uniquePath(join(state.dir, "model-ladder-leftovers"));
		renameSync(legacy, aside);
		warnings.push(`kept unrecognized files from ${legacy} in ${aside}`);
	} else if (existsSync(legacy)) rmdirSync(legacy);
}
function migrateLegacyLayout() {
	const result = {
		moved: [],
		warnings: []
	};
	const legacy = legacyDirs();
	const config = dirname(configPath());
	const state = statePaths();
	try {
		if (existsSync(legacy.config) && !existsSync(config)) {
			mkdirSync(dirname(config), { recursive: true });
			renameSync(legacy.config, config);
			result.moved.push(legacy.config);
		}
	} catch (error) {
		result.warnings.push(`could not move ${legacy.config}: ${error.message}`);
	}
	if (!existsSync(legacy.state)) return result;
	if (!existsSync(state.dir)) {
		try {
			mkdirSync(dirname(state.dir), { recursive: true });
			renameSync(legacy.state, state.dir);
		} catch (error) {
			result.warnings.push(`could not move ${legacy.state}: ${error.message}`);
			return result;
		}
		result.moved.push(legacy.state);
		try {
			const manifest = readManifest(state.manifest);
			if (manifest) {
				const records = (manifest.records ?? []).map((r) => ({
					...r,
					backup: r.backup && resolveBackup(r.backup)
				}));
				writeManifest(state.manifest, manifest, records);
			}
		} catch (error) {
			result.warnings.push(`moved ${legacy.state}, but could not update the backup paths in its manifest (${error.message}); they are resolved when used`);
		}
		return result;
	}
	try {
		mergeState(legacy.state, result.warnings);
		result.moved.push(legacy.state);
	} catch (error) {
		result.warnings.push(`could not merge ${legacy.state}: ${error.message}`);
	}
	return result;
}
//#endregion
//#region src/ops.ts
const COMPONENTS = [
	"agents",
	"skill",
	"instructions",
	"read-guard",
	"review-models"
];
/** The ladder's catalog item; its parts keep their own components instead of "catalog". */
const LADDER_ITEM = "model-ladder";
/** The ladder's entry key: it installs at user scope only. */
const LADDER_KEY = `${LADDER_ITEM}@user`;
const COMPONENT_LABELS = {
	agents: "Ladder agents (read + edit on fast, balanced, deep)",
	skill: "Routing skill (when to delegate, how to climb)",
	instructions: "Always-on instructions block (CLAUDE.md / AGENTS.md)",
	"read-guard": "Read guard hook: blocks full reads of large files (Claude Code)",
	"review-models": "Gentle AI review agents on ladder models",
	catalog: "Catalog items"
};
/** Plans undoing an installed item that the current configuration no longer produces. */
function planRemoval(record) {
	return {
		op: {
			kind: record.kind,
			runtime: record.runtime,
			component: record.component,
			path: record.path,
			label: record.label,
			...record.item ? { item: record.item } : {}
		},
		action: "remove",
		reason: "no longer part of the configuration",
		record
	};
}
const BLOCK_BEGIN = "<!-- BEGIN agent-config: managed by agent-config, edits inside this block are overwritten -->";
const BLOCK_END = "<!-- END agent-config -->";
/** Matches the file's own indentation so edits do not reformat what they did not touch. */
function formatFor(text) {
	const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
	const tabs = indent.startsWith("	");
	return {
		insertSpaces: !tabs,
		tabSize: tabs ? 1 : indent.length,
		eol: "\n"
	};
}
function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}
function readText(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return;
	}
}
/**
* Writes through symlinks (dotfile managers link these files) and keeps the existing
* file's permissions, so a private settings.json stays private.
*/
function writeAtomic(path, text, executable = false) {
	let target = path;
	let mode;
	try {
		target = realpathSync(path);
		mode = statSync(target).mode & 4095;
	} catch {}
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.agent-config-tmp`;
	writeFileSync(tmp, text);
	if (executable) chmodSync(tmp, (mode ?? 420) | 73);
	else if (mode !== void 0) chmodSync(tmp, mode);
	renameSync(tmp, target);
}
function recordKey(r) {
	return [
		r.kind,
		r.path,
		r.pointer?.join("/") ?? r.key ?? r.command ?? r.markers?.[0]?.[0] ?? ""
	].join("\0");
}
function opKey(op) {
	switch (op.kind) {
		case "json-set": return recordKey({
			kind: op.kind,
			path: op.path,
			pointer: op.pointer
		});
		case "frontmatter": return recordKey({
			kind: op.kind,
			path: op.path,
			key: op.key
		});
		case "json-hook": return recordKey({
			kind: op.kind,
			path: op.path,
			command: op.command
		});
		case "block": return recordKey({
			kind: op.kind,
			path: op.path,
			markers: op.markers
		});
		default: return recordKey({
			kind: op.kind,
			path: op.path
		});
	}
}
function loadManifest() {
	const text = readText(statePaths().manifest);
	if (!text) return {
		version: 1,
		records: []
	};
	const data = JSON.parse(text);
	return {
		version: 1,
		records: (Array.isArray(data.records) ? data.records : []).map((r) => r.item === void 0 && r.component !== "catalog" ? {
			...r,
			item: LADDER_KEY
		} : r)
	};
}
function saveManifest(manifest) {
	writeAtomic(statePaths().manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}
function parseJson(path, text) {
	const errors = [];
	const value = parse(text, errors, {
		allowTrailingComma: true,
		disallowComments: false
	});
	if (errors.length > 0) throw new Error(`${path} is not valid JSON; fix it and re-run.`);
	return value;
}
function getAt(root, pointer) {
	let node = root;
	for (const seg of pointer) {
		if (node === null || typeof node !== "object" || !(seg in node)) return { present: false };
		node = node[seg];
	}
	return {
		present: true,
		value: node
	};
}
function existingPrefix(root, pointer) {
	let depth = 0;
	while (depth < pointer.length - 1 && getAt(root, pointer.slice(0, depth + 1)).present) depth++;
	return depth;
}
/** Removes the now-empty parent objects agent-config created for a key. */
function pruneParents(text, pointer, keepDepth) {
	let out = text;
	for (let depth = pointer.length - 1; depth > keepDepth; depth--) {
		const parent = pointer.slice(0, depth);
		const got = getAt(parseJson("json", out), parent);
		if (!got.present || got.value === null || typeof got.value !== "object" || Object.keys(got.value).length > 0) break;
		out = setJson(out, parent, void 0);
	}
	return out;
}
function setJson(text, pointer, value) {
	return applyEdits(text, modify(text, pointer, value, { formattingOptions: formatFor(text) }));
}
function deepEqual(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
function splitFrontmatter(text) {
	const lines = text.split("\n");
	if (lines[0] !== "---") return void 0;
	const end = lines.indexOf("---", 1);
	if (end < 0) return void 0;
	return {
		lines,
		start: 1,
		end
	};
}
function frontmatterLine(fm, key) {
	for (let i = fm.start; i < fm.end; i++) if (fm.lines[i]?.startsWith(`${key}:`)) return i;
	return -1;
}
function unquote(raw) {
	const v = raw.trim();
	if (v.length >= 2 && (v[0] === "\"" || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
	return v;
}
/** `value` is unquoted for comparison; `raw` is the text as written, used to restore it exactly. */
function getFrontmatter(text, key) {
	const fm = splitFrontmatter(text);
	if (!fm) return { present: false };
	const i = frontmatterLine(fm, key);
	if (i < 0) return { present: false };
	const raw = (fm.lines[i] ?? "").slice(key.length + 1).trim();
	return {
		present: true,
		value: unquote(raw),
		raw
	};
}
function setFrontmatter(text, key, value) {
	const fm = splitFrontmatter(text);
	if (!fm) throw new Error("file has no frontmatter");
	const i = frontmatterLine(fm, key);
	const lines = [...fm.lines];
	if (value === void 0) {
		if (i >= 0) lines.splice(i, 1);
	} else if (i >= 0) lines[i] = `${key}: ${value}`;
	else lines.splice(fm.end, 0, `${key}: ${value}`);
	return lines.join("\n");
}
const MARKERS = [[BLOCK_BEGIN, BLOCK_END], ["<!-- BEGIN model-ladder: managed by model-ladder, edits inside this block are overwritten -->", "<!-- END model-ladder -->"]];
/** The managed block's position, under the current or the older markers. */
function findBlock(text, markers = MARKERS) {
	for (const [open, close] of markers) {
		const begin = text.indexOf(open);
		const endIdx = begin >= 0 ? text.indexOf(close, begin) : -1;
		if (begin >= 0 && endIdx >= 0) return {
			begin,
			end: endIdx + close.length
		};
	}
}
function hasBlock(text, markers) {
	return findBlock(text, markers) !== void 0;
}
function stripBlock(text, markers) {
	const found = findBlock(text, markers);
	if (!found) return text;
	const before = text.slice(0, found.begin).replace(/\n+$/, "");
	const after = text.slice(found.end).replace(/^\n+/, "");
	if (!before) return after;
	return after ? `${before}\n\n${after}` : `${before}\n`;
}
function withBlock(text, content, markers = MARKERS) {
	const [open, close] = markers[0] ?? ["<!-- BEGIN agent-config: managed by agent-config, edits inside this block are overwritten -->", "<!-- END agent-config -->"];
	const block = `${open}\n${content.trim()}\n${close}\n`;
	const found = findBlock(text, markers);
	if (found) {
		const tail = text.slice(found.end).replace(/^\n/, "");
		return `${text.slice(0, found.begin)}${block}${tail}`;
	}
	if (!text.trim()) return block;
	return `${text.replace(/\n*$/, "")}\n\n${block}`;
}
function hookGroups(root, event) {
	const got = getAt(root, ["hooks", event]);
	return got.present && Array.isArray(got.value) ? got.value : [];
}
function hasHook(root, event, matcher, command) {
	return hookGroups(root, event).some((g) => g.matcher === matcher && (g.hooks ?? []).some((h) => h.command === command));
}
function lineIndent(text, offset) {
	const start = text.lastIndexOf("\n", offset - 1) + 1;
	return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}
/** Appends a compact value to an existing array, leaving every other byte as it was. */
function appendToArray(text, pointer, value) {
	const node = findNodeAtLocation(parseTree(text) ?? {
		type: "null",
		offset: 0,
		length: 0
	}, pointer);
	if (!node || node.type !== "array") throw new Error("expected an array");
	const json = JSON.stringify(value);
	const last = (node.children ?? []).at(-1);
	if (!last) {
		const indent = lineIndent(text, node.offset);
		const unit = formatFor(text).insertSpaces ? " ".repeat(formatFor(text).tabSize) : "	";
		const at = node.offset + 1;
		return `${text.slice(0, at)}\n${indent}${unit}${json}\n${indent}${text.slice(node.offset + node.length - 1)}`;
	}
	const end = last.offset + last.length;
	const sep = !text.slice(node.offset, last.offset).includes("\n") ? ", " : `,\n${lineIndent(text, last.offset)}`;
	return `${text.slice(0, end)}${sep}${json}${text.slice(end)}`;
}
/** Removes one array element and its separating comma, leaving every other byte as it was. */
function removeFromArray(text, pointer, index) {
	const node = findNodeAtLocation(parseTree(text) ?? {
		type: "null",
		offset: 0,
		length: 0
	}, pointer);
	const items = node?.children ?? [];
	const item = items[index];
	if (!node || !item) return text;
	if (items.length === 1) return `${text.slice(0, node.offset + 1)}${text.slice(node.offset + node.length - 1)}`;
	if (index > 0) {
		const prev = items[index - 1];
		const from = (prev?.offset ?? 0) + (prev?.length ?? 0);
		return `${text.slice(0, from)}${text.slice(item.offset + item.length)}`;
	}
	const next = items[1];
	return `${text.slice(0, item.offset)}${text.slice(next?.offset ?? item.offset + item.length)}`;
}
/** Adds one hook entry in place, touching nothing else in the file. */
function addHook(text, event, matcher, command) {
	const root = parseJson("settings", text);
	const entry = {
		type: "command",
		command
	};
	const group = {
		matcher,
		hooks: [entry]
	};
	if (!getAt(root, ["hooks"]).present) return {
		text: setJson(text, ["hooks"], { [event]: [group] }),
		created: "hooks"
	};
	if (!getAt(root, ["hooks", event]).present) return {
		text: setJson(text, ["hooks", event], [group]),
		created: "event"
	};
	const idx = hookGroups(root, event).findIndex((g) => g.matcher === matcher && Array.isArray(g.hooks));
	if (idx < 0) return {
		text: appendToArray(text, ["hooks", event], group),
		created: "group"
	};
	return {
		text: appendToArray(text, [
			"hooks",
			event,
			idx,
			"hooks"
		], entry),
		created: "entry"
	};
}
/** Removes the hook entry and only the containers agent-config created for it. */
function removeHook(text, event, command, created) {
	const groups = hookGroups(parseJson("settings", text), event);
	const gi = groups.findIndex((g) => (g.hooks ?? []).some((h) => h.command === command));
	if (gi < 0) return text;
	const hooks = groups[gi]?.hooks ?? [];
	const hi = hooks.findIndex((h) => h.command === command);
	let out = created !== "entry" && hooks.length === 1 ? removeFromArray(text, ["hooks", event], gi) : removeFromArray(text, [
		"hooks",
		event,
		gi,
		"hooks"
	], hi);
	const isEmpty = (pointer) => {
		const got = getAt(parseJson("settings", out), pointer);
		return got.present && !!got.value && typeof got.value === "object" && Object.keys(got.value).length === 0;
	};
	if ((created === "event" || created === "hooks") && isEmpty(["hooks", event])) out = setJson(out, ["hooks", event], void 0);
	if (created === "hooks" && isEmpty(["hooks"])) out = setJson(out, ["hooks"], void 0);
	return out;
}
/** A symlink whose target no longer exists. */
function isDangling(path) {
	try {
		if (!lstatSync(path).isSymbolicLink()) return false;
	} catch {
		return false;
	}
	try {
		statSync(path);
		return false;
	} catch (error) {
		const code = error.code;
		return code === "ENOENT" || code === "ENOTDIR";
	}
}
/**
* Broken symlinks on a target path: the file itself or a parent directory. An older installer
* may have linked a skill folder into a checkout that is gone; nothing can be written through it.
*/
function danglingLinks(path) {
	const found = [];
	for (let p = path; dirname(p) !== p; p = dirname(p)) if (isDangling(p)) found.push(p);
	return found;
}
/** Removes the broken symlinks on a path and returns them, so uninstall can put them back. */
function replaceDanglingLinks(path) {
	return danglingLinks(path).map((link) => {
		const target = readlinkSync(link);
		unlinkSync(link);
		return {
			path: link,
			target
		};
	});
}
function planOp(op, recorded) {
	const planned = planTarget(op, recorded);
	const broken = danglingLinks(op.path)[0];
	if (broken && (planned.action === "create" || planned.action === "update") && !planned.reason) return {
		...planned,
		reason: `replaces a broken symlink at ${broken}`
	};
	return planned;
}
function planTarget(op, recorded) {
	const current = readText(op.path);
	switch (op.kind) {
		case "file":
			if (current === void 0) return {
				op,
				action: "create"
			};
			if (current === op.content) return {
				op,
				action: "unchanged"
			};
			if (recorded?.sha && sha256(current) !== recorded.sha) return {
				op,
				action: "update",
				reason: "edited since install; your copy will be backed up"
			};
			return {
				op,
				action: "update"
			};
		case "block":
			if (current === void 0) return {
				op,
				action: "create"
			};
			if (op.conflict && !hasBlock(current, op.markers)) {
				const line = op.conflict;
				if (current.split("\n").some((l) => l.trim() === line)) return {
					op,
					action: "skip",
					reason: `already configured (${line})`
				};
			}
			return {
				op,
				action: withBlock(current, op.content, op.markers) === current ? "unchanged" : "update"
			};
		case "json-set": {
			if (current === void 0) {
				if (op.requireParent) return {
					op,
					action: "skip",
					reason: "not installed"
				};
				return {
					op,
					action: "create"
				};
			}
			const root = parseJson(op.path, current);
			if (op.requireParent && !getAt(root, op.pointer.slice(0, -1)).present) return {
				op,
				action: "skip",
				reason: "not installed"
			};
			const got = getAt(root, op.pointer);
			if (got.present && deepEqual(got.value, op.value)) return {
				op,
				action: "unchanged"
			};
			return {
				op,
				action: got.present ? "update" : "create"
			};
		}
		case "json-hook":
			if (current === void 0) return {
				op,
				action: "create"
			};
			return {
				op,
				action: hasHook(parseJson(op.path, current), op.event, op.matcher, op.command) ? "unchanged" : "update"
			};
		case "frontmatter": {
			if (current === void 0) return {
				op,
				action: "skip",
				reason: "not installed"
			};
			if (!splitFrontmatter(current)) return {
				op,
				action: "skip",
				reason: "no frontmatter"
			};
			const got = getFrontmatter(current, op.key);
			return {
				op,
				action: got.present && got.value === op.value ? "unchanged" : "update"
			};
		}
	}
}
function missingDirs(dir) {
	const dirs = [];
	for (let d = dir; !existsSync(d) && dirname(d) !== d; d = dirname(d)) dirs.push(d);
	return dirs;
}
/** Deletes a JSON file agent-config created once nothing but `{}` is left in it. */
function writeOrDropJson(r, text) {
	const value = parseJson(r.path, text);
	if (r.createdFile && value && typeof value === "object" && Object.keys(value).length === 0) rmSync(r.path, { force: true });
	else writeAtomic(r.path, text);
}
function backupFile(path) {
	const { backups } = statePaths();
	const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
	const dest = join(backups, stamp, path.replace(/^\/+/, ""));
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(path, dest);
	return dest;
}
/** Applies one planned op and returns the manifest record to keep for it. */
function applyOp(planned, existing, notes = []) {
	if (planned.action === "skip") return existing;
	const fresh = replaceDanglingLinks(planned.op.path);
	try {
		return writeTarget(planned, existing, notes, [...existing?.replacedLinks ?? [], ...fresh]);
	} catch (error) {
		try {
			rmSync(`${planned.op.path}.agent-config-tmp`, { force: true });
		} catch {}
		for (const link of fresh) {
			for (let d = dirname(planned.op.path); d === link.path || d.startsWith(`${link.path}/`); d = dirname(d)) try {
				rmdirSync(d);
			} catch {
				break;
			}
			try {
				symlinkSync(link.target, link.path);
			} catch {}
		}
		throw error;
	}
}
function writeTarget(planned, existing, notes, replacedLinks) {
	const { op, action } = planned;
	const base = {
		kind: op.kind,
		runtime: op.runtime,
		component: op.component,
		path: op.path,
		label: op.label,
		...op.item ? { item: op.item } : {},
		...replacedLinks.length > 0 ? { replacedLinks } : {}
	};
	const current = readText(op.path);
	base.createdDirs = existing?.createdDirs ?? missingDirs(dirname(op.path));
	const createdFile = existing?.createdFile ?? current === void 0;
	switch (op.kind) {
		case "file": {
			let backup = existing?.backup;
			if (current !== void 0 && !existing) backup = backupFile(op.path);
			if (current !== void 0 && existing?.sha && sha256(current) !== existing.sha && current !== op.content) notes.push(`${op.path} was edited since install; your copy was saved to ${backupFile(op.path)}`);
			if (action !== "unchanged") writeAtomic(op.path, op.content, op.executable);
			else if (op.executable) chmodSync(op.path, 493);
			return {
				...base,
				sha: sha256(op.content),
				...backup ? { backup } : {}
			};
		}
		case "block": {
			if (action !== "unchanged") writeAtomic(op.path, withBlock(current ?? "", op.content, op.markers));
			const trailingNewline = existing?.trailingNewline ?? (current === void 0 || current === "" || current.endsWith("\n"));
			return {
				...base,
				createdFile,
				trailingNewline,
				...op.markers ? { markers: op.markers } : {}
			};
		}
		case "json-set": {
			const text = current ?? "{}\n";
			const root = parseJson(op.path, text);
			const prev = existing?.prev ?? getAt(root, op.pointer);
			const existingDepth = existing?.existingDepth ?? existingPrefix(root, op.pointer);
			if (action !== "unchanged") writeAtomic(op.path, setJson(text, op.pointer, op.value));
			return {
				...base,
				pointer: op.pointer,
				value: op.value,
				prev,
				existingDepth,
				createdFile
			};
		}
		case "json-hook": {
			let hookCreated = existing?.hookCreated;
			if (action !== "unchanged") {
				const added = addHook(current ?? "{}\n", op.event, op.matcher, op.command);
				writeAtomic(op.path, added.text);
				hookCreated ??= added.created;
			}
			return {
				...base,
				event: op.event,
				command: op.command,
				createdFile,
				hookCreated
			};
		}
		case "frontmatter": {
			const text = current ?? "";
			const got = getFrontmatter(text, op.key);
			const prev = existing?.prev ?? {
				present: got.present,
				value: got.raw
			};
			if (action !== "unchanged") writeAtomic(op.path, setFrontmatter(text, op.key, op.value));
			return {
				...base,
				key: op.key,
				value: op.value,
				prev
			};
		}
	}
}
function applyPlan(plan) {
	const manifest = loadManifest();
	const byKey = new Map(manifest.records.map((r) => [recordKey(r), r]));
	const result = {
		applied: [],
		notes: [],
		errors: []
	};
	for (const planned of plan) {
		if (planned.action === "remove" && planned.record) {
			const record = planned.record;
			try {
				const res = undoRecord(record);
				byKey.delete(recordKey(record));
				if (res.outcome === "kept-modified") {
					const original = record.backup ? resolveBackup(record.backup) : void 0;
					result.notes.push(`${record.path} was left as you changed it and is no longer managed` + (original && existsSync(original) ? `; your original is saved at ${original}` : ""));
				} else {
					pruneCreatedDirs([record]);
					for (const note of restoreLinks([record], [...byKey.values()]).values()) result.notes.push(note);
				}
				result.applied.push(planned);
			} catch (error) {
				result.errors.push({
					op: planned.op,
					error: error instanceof Error ? error.message : String(error)
				});
			}
			saveManifest({
				version: 1,
				records: [...byKey.values()]
			});
			continue;
		}
		const key = opKey(planned.op);
		try {
			const record = applyOp(planned, byKey.get(key), result.notes);
			if (record) byKey.set(key, record);
			result.applied.push(planned);
		} catch (error) {
			result.errors.push({
				op: planned.op,
				error: error instanceof Error ? error.message : String(error)
			});
		}
		saveManifest({
			version: 1,
			records: [...byKey.values()]
		});
	}
	return result;
}
function recordState(r) {
	const current = readText(r.path);
	if (current === void 0) return "missing";
	switch (r.kind) {
		case "file": return sha256(current) === r.sha ? "ok" : "drifted";
		case "block": return hasBlock(current, r.markers) ? "ok" : "missing";
		case "json-set": {
			const got = getAt(parseJson(r.path, current), r.pointer ?? []);
			return got.present && deepEqual(got.value, r.value) ? "ok" : "drifted";
		}
		case "json-hook": return hookGroups(parseJson(r.path, current), r.event ?? "").some((g) => (g.hooks ?? []).some((h) => h.command === r.command)) ? "ok" : "missing";
		case "frontmatter": {
			const got = getFrontmatter(current, r.key ?? "");
			return got.present && got.value === r.value ? "ok" : "drifted";
		}
	}
}
function undoRecord(r, force = false) {
	const current = readText(r.path);
	if (current === void 0) return {
		record: r,
		outcome: "already-gone"
	};
	switch (r.kind) {
		case "file": {
			if (sha256(current) !== r.sha && !force) return {
				record: r,
				outcome: "kept-modified",
				note: "changed since install; re-run with --force to remove"
			};
			const backup = r.backup && resolveBackup(r.backup);
			if (backup && existsSync(backup)) {
				writeAtomic(r.path, readFileSync(backup, "utf8"));
				return {
					record: r,
					outcome: "restored",
					note: `restored from ${backup}`
				};
			}
			rmSync(r.path, { force: true });
			return {
				record: r,
				outcome: "removed"
			};
		}
		case "block": {
			let next = stripBlock(current, r.markers);
			if (next === current) return {
				record: r,
				outcome: "already-gone"
			};
			if (r.trailingNewline === false) next = next.replace(/\n$/, "");
			if (r.createdFile && !next.trim()) {
				rmSync(r.path, { force: true });
				return {
					record: r,
					outcome: "removed"
				};
			}
			writeAtomic(r.path, next);
			return {
				record: r,
				outcome: "removed"
			};
		}
		case "json-set": {
			const got = getAt(parseJson(r.path, current), r.pointer ?? []);
			if (!(got.present && deepEqual(got.value, r.value)) && !force) return {
				record: r,
				outcome: "kept-modified",
				note: "value changed since install; left as is"
			};
			const pointer = r.pointer ?? [];
			let next = setJson(current, pointer, r.prev?.present ? r.prev.value : void 0);
			if (!r.prev?.present) next = pruneParents(next, pointer, r.existingDepth ?? pointer.length - 1);
			writeOrDropJson(r, next);
			return {
				record: r,
				outcome: r.prev?.present ? "restored" : "removed"
			};
		}
		case "json-hook": {
			const next = removeHook(current, r.event ?? "", r.command ?? "", r.hookCreated ?? "group");
			if (next === current) return {
				record: r,
				outcome: "already-gone"
			};
			writeOrDropJson(r, next);
			return {
				record: r,
				outcome: "removed"
			};
		}
		case "frontmatter": {
			const got = getFrontmatter(current, r.key ?? "");
			if (!(got.present && got.value === r.value) && !force) return {
				record: r,
				outcome: "kept-modified",
				note: "value changed since install (gentle-ai sync?); left as is"
			};
			const prev = r.prev?.present ? String(r.prev.value) : void 0;
			writeAtomic(r.path, setFrontmatter(current, r.key ?? "", prev));
			return {
				record: r,
				outcome: r.prev?.present ? "restored" : "removed"
			};
		}
	}
}
/** Removes directories agent-config created for these records, deepest first, once empty. */
function pruneCreatedDirs(records) {
	const dirs = new Set(records.flatMap((r) => r.createdDirs ?? []));
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) try {
		if (readdirSync(dir).length === 0) rmdirSync(dir);
	} catch {}
}
/**
* Puts back the broken symlinks these undone records replaced. A link whose folder still holds
* other managed files moves to one of those records (`remaining`), to come back when the last one
* goes. Returns why each link that could not be put back was not, by record.
*/
function restoreLinks(records, remaining) {
	const failed = /* @__PURE__ */ new Map();
	const fail = (r, note) => failed.set(r, failed.has(r) ? `${failed.get(r)}; ${note}` : note);
	for (const r of records) for (const link of r.replacedLinks ?? []) {
		const lost = `could not restore the symlink ${link.path} -> ${link.target}`;
		let occupied = true;
		try {
			lstatSync(link.path);
		} catch {
			occupied = false;
		}
		if (occupied) {
			const heir = remaining.find((k) => k !== r && (k.path === link.path || k.path.startsWith(`${link.path}/`)));
			if (heir) {
				heir.replacedLinks = [...(heir.replacedLinks ?? []).filter((l) => l.path !== link.path), link];
				const inside = (r.createdDirs ?? []).filter((d) => d === link.path || d.startsWith(`${link.path}/`));
				heir.createdDirs = [.../* @__PURE__ */ new Set([...heir.createdDirs ?? [], ...inside])].sort((a, b) => b.length - a.length);
			} else fail(r, `${lost}: something else is there now`);
			continue;
		}
		try {
			symlinkSync(link.target, link.path);
		} catch (error) {
			fail(r, `${lost}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return failed;
}
function uninstall(filter, force = false) {
	const manifest = loadManifest();
	const results = [];
	const keep = [];
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
	saveManifest({
		version: 1,
		records: keep
	});
	return results;
}
//#endregion
//#region src/kickoff.ts
const KICK_OFF = "kick-off";
const KICK_OFF_GUARD_FILE = "kick-off-guard.mjs";
const DESCRIPTION = "Kick off a Kaneo epic: diagnose what it is missing, ask how to run it, and copy a /continue brief to the clipboard that works the whole epic in a fresh session.";
const KICK_OFF_HINT = "<kaneo-epic-or-ticket-url | ticket-code>";
const CALL = {
	claude: (agent) => `the Agent tool with \`subagent_type: "${agent}"\``,
	opencode: (agent) => `the task tool with the \`${agent}\` agent`,
	codex: (agent) => `a spawned sub-agent with \`${agent}\` as its role`,
	pi: (agent) => `the subagent tool with the \`${agent}\` agent`
};
/** The line that opens every delegated handoff, so the guard and the user can check its phase. */
const PHASE_PREFIX = "Phase:";
/** The line a user adds under the phase line to let a review run on the fast rung. */
const FAST_REVIEW_APPROVAL = "Fast review: approved by the user";
/** The Claude tools the kick-off guard hook checks: agent handoffs and clipboard copies. */
const KICK_OFF_GUARD_MATCHER = "Agent|Task|Bash";
/** Claude's tool for asking the user a question with options. */
const CLAUDE_QUESTION_TOOL = "AskUserQuestion";
const DEEP_READER = agentName("read", "deep");
const BALANCED_READER = agentName("read", "balanced");
const FAST_READER = agentName("read", "fast");
const FAST_EDITOR = agentName("edit", "fast");
const BALANCED_EDITOR = agentName("edit", "balanced");
const DEEP_EDITOR = agentName("edit", "deep");
const agent = (name) => `\`${name}\``;
const phase = (name) => `${PHASE_PREFIX} ${name}`;
function kickOffMarkdown(runtime, models, briefDir) {
	const cmd = actionCommand(runtime, KICK_OFF);
	const cont = actionCommand(runtime, CONTINUE);
	const args = runtime === "codex" ? `Argument: the user's message after \`${cmd}\`.` : "Argument: `$ARGUMENTS`.";
	const ask = runtime === "claude" ? `with the ${CLAUDE_QUESTION_TOOL} tool` : "in one message with numbered options";
	const guard = runtime === "claude" ? " The kick-off guard hook denies a `diagnose`, `plan` or `risk` handoff off the deep rung, a review on fast without the user's approval, and a clipboard copy of an incomplete brief." : "";
	const deepRead = agent(DEEP_READER);
	const balancedRead = agent(BALANCED_READER);
	const fastRead = agent(FAST_READER);
	const routed = `none and low risk: ${balancedRead}; medium and high: ${deepRead}`;
	return `${actionFrontmatter(runtime, KICK_OFF, DESCRIPTION, KICK_OFF_HINT)}

## Arguments

${args} It names one Kaneo epic or ticket: a URL (\`…/task/<id>\`) or an identifier such as \`FEX-12\`. When it is empty, ask for it and wait.

## Save context

This session decides; everything bulky runs on an agent and comes back as a short summary. Agents run through ${CALL[runtime]("<name>")}.

- **Kaneo**: every read and write goes through ${agent(SCRIBE)} (${models.fast}). Ask for summaries, never raw Kaneo JSON.
- **Reasoning**: the diagnosis runs on ${deepRead} (${models.deep}). Every handoff starts with its phase line, \`${phase("<phase>")}\`.${guard}
- Anything else you read follows the \`model-ladder\` skill.

When one of these agents is not installed, do the step yourself with bounded reads.

## 1. What is missing to complete the epic

1. Load the \`${KANEO_SKILL}\` skill. Have the scribe resolve the argument to its epic: the ticket itself when it is the epic, otherwise the epic it belongs to (its parent, epic or \`related\` relation; with none, the ticket is the root). In the same request, ask for one summary of the epic (identifier, title, URL, description, acceptance criteria) and of every ticket related to it (subtasks, related, blocking, blocked by), each with identifier, title, status, priority, size label, relations, its criteria in one line and any PR link in its comments.
2. Hand that summary to ${deepRead}:

   \`\`\`
   ${phase("diagnose")}
   Epic: <identifier> <title>, <url>
   Tickets: <the scribe's summary>
   Scope: this repository
   Question: what is missing to complete this epic?
   Answer shape: done tickets; open tickets in dependency order with what blocks each; work the epic's criteria need that no ticket covers (proposed tickets: title, one-line scope, size, dependencies); gaps (vague or missing criteria, tickets without criteria, dependency cycles, stale blockers, code that contradicts a done ticket); waves of open tickets that can run in parallel (no dependency between them, different areas of the code), each ticket with the context a fresh session needs and the paths it touches.
   Budget: <= 700 words
   \`\`\`

3. Show the user the overview: progress (done / open / missing), blockers, missing tickets, gaps, and the proposed order and waves.

## 2. Ask how to run it

Ask these four ${ask}, recommending the first option of each, and wait for the answers:

1. **Missing tickets**: create them in Kaneo now / list them in the brief for the new session to create first / leave them out.
2. **Parallelism**: parallel waves of up to N tickets (\`${cont} parallel N\`, N = the widest wave) / one ticket at a time (\`${cont}\`). Recommend one at a time when no wave has two tickets.
3. **Integration branch**: \`dev\` / the repository's default branch / another branch. Every ticket branch starts from it and every PR merges into it.
4. **Reviews**: routed by risk (${routed}) / always ${deepRead} / fast allowed for none risk.

When the user chose to create the missing tickets, have the scribe create them, sized, labelled and related as the \`${KANEO_SKILL}\` skill says, and put their identifiers in the queue.

The brief's review routing, from answer 4:

- Routed by risk: "${routed}."
- Always deep: "${deepRead} for every risk."
- Fast allowed for none risk: "none: ${fastRead}, with the line \`${FAST_REVIEW_APPROVAL}\` under the phase line; low: ${balancedRead}; medium and high: ${deepRead}."

## 3. Write the brief and copy it

1. Write the brief to \`${briefDir}/<EPIC-ID>.md\` (create the folder) from the template below. Replace every \`<…>\` and keep the rest as written: the loop, routing and stop sections are what the new session runs on.
2. Copy it to the clipboard with the first tool that exists: \`pbcopy < <file>\` (macOS), \`wl-copy < <file>\`, \`xclip -selection clipboard < <file>\`, \`xsel --clipboard --input < <file>\` or \`clip.exe < <file>\`. When none exists, say so and give the path.
3. Report the path, whether the brief is on the clipboard, one line per wave, and: open a fresh session in this repository and paste it.

## Brief template

The first line is the command alone: \`${cont}\` for one ticket at a time, \`${cont} parallel <N>\` for waves.

\`\`\`\`markdown
${cont} parallel <N>

# Kick-off: <EPIC-ID> <epic title>

## Epic

- Ticket: [<EPIC-ID> <title>](<url>)
- Goal: <one sentence>
- Done when: <each acceptance criterion of the epic, one per line>
- State: <done>/<total> tickets done, <open> open, <created> created by kick-off.
- Integration branch: \`<branch>\`. Every ticket branch starts from \`origin/<branch>\` and every PR merges into it.

## Queue

Work only these tickets, in this order. Tickets in one wave do not depend on each other and may run in parallel; a wave starts once the previous one merged.

### Wave 1

- \`<ID>\` <title>: <why now and the context the ticket needs, one or two lines>. Depends on: <IDs or none>. Done when: <criteria>. Touches: <areas or paths>.

## Gaps

- <gap>: <what to do: create the ticket first, ask the user, or note it in the PR>.

## Loop per ticket

Agents run through ${CALL[runtime]("<name>")}. Every delegated handoff starts with its phase line, such as \`${phase("plan")}\`, so the run can be checked.

1. **Pick.** Have ${agent(SCRIBE)} re-read the ticket and its blockers. Still blocked: skip it, say why and take the next. Otherwise move it to In Progress and branch \`<ID>/<short-kebab-description>\` from \`origin/<branch>\`.
2. **Plan** (\`${phase("plan")}\`, ${deepRead}). Diagnose every change the ticket needs. Return a task list; each task has a spec, its allowed paths, a reference file, a verify command and its edit rung: fast for pattern work (tests, boilerplate, config, mechanical edits), balanced for new logic. Prefer fast.
3. **Edit** (\`${phase("edit")}\`). Run each task on its rung, ${agent(FAST_EDITOR)} or ${agent(BALANCED_EDITOR)}. Climb one rung on a partial or escalate reply or a failed verify; ${agent(DEEP_EDITOR)} only after balanced failed. Run every verify command yourself.
4. **Risk** (\`${phase("risk")}\`, ${deepRead}). Classify the diff (\`git diff origin/<branch>...HEAD\`) as none, low, medium or high per area, one reason each: none for docs and comments; low for tests and isolated internals; medium for behavior other code calls; high for auth, permissions, data, money, migrations, concurrency, public contracts and deletions. The ticket takes the highest.
5. **Review** (\`${phase("review")}\`): <review routing>. Give the reviewer the diff, the ticket's criteria and the risk notes; it returns findings (path:line, severity, fix, and the fix's edit rung) or none. A review never runs on a fast agent unless this brief allows it.
6. **Fix** (\`${phase("fix")}\`). Hand each finding to an edit agent on its rung and verify it. Go back to Risk when a fix changed what the diff touches, otherwise to Review. Repeat until the review has no findings.
7. **Deliver.** Run the project's checks and leave them passing. Commit with the \`${COMMIT_SKILL}\` skill (titles from ${agent(COMMIT_WRITER)}), push, and open the PR into \`<branch>\`: its body starts with the Kaneo ticket link and has no AI attribution. Have the scribe comment the PR URL on the ticket. Wait for CI; read failures through ${fastRead} and fix them through Plan, Edit and Review. Merge, have the scribe move the ticket to Done, then delete the branch and its worktree.
8. **Next.** Back to Pick. After each wave, have the scribe re-read the epic: tickets added since go to the end of the queue in dependency order.

## Model routing

| Phase | Agent |
| --- | --- |
| Kaneo reads and writes | ${agent(SCRIBE)} (${models.fast}) |
| plan, risk | ${deepRead} (${models.deep}) |
| edit, fix | ${agent(FAST_EDITOR)} (${models.fast}) for pattern work, ${agent(BALANCED_EDITOR)} (${models.balanced}) for new logic, ${agent(DEEP_EDITOR)} only after balanced failed |
| review | <review routing> |
| commit titles | ${agent(COMMIT_WRITER)} |

Parallel workers cannot start agents: they run each phase on its rung with \`agent-config delegate read|edit --runtime ${runtime} --tier <rung> --no-climb "<handoff>"\`.

## Stop and report

Stop and ask the user when a ticket stays blocked, the review still has findings after 3 rounds, CI fails twice after fixes, a merge conflict cannot be resolved with confidence, a PR cannot merge (required review, branch protection), or the epic's criteria are ambiguous.

When the queue is empty, have ${deepRead} check the epic's "Done when" list against the merged code (\`${phase("review")}\`). Move the epic to Done only when every criterion is met; otherwise add what is missing to the queue and continue. Report a table: ticket, PR, risk, review rounds, status (merged / open / blocked), and what is left.
\`\`\`\`
`;
}
//#endregion
//#region src/content.ts
const SKILL_NAME = "model-ladder";
const HOW_TO_CALL = {
	claude: "the Agent tool with `subagent_type: \"ladder-read-fast\"` (or another ladder agent)",
	opencode: "the task tool with the ladder agent name (for example `ladder-read-fast`)",
	codex: "a spawned sub-agent with the ladder agent name as its role (for example `ladder-read-fast`)",
	pi: "the subagent tool with the ladder agent name (for example `ladder-read-fast`)"
};
function agentTable(models) {
	return [
		"| Rung | Reads | Edits | Model |",
		"|------|-------|-------|-------|",
		`| fast | \`${agentName("read", "fast")}\` | \`${agentName("edit", "fast")}\` | ${models.fast} |`,
		`| balanced | \`${agentName("read", "balanced")}\` | \`${agentName("edit", "balanced")}\` | ${models.balanced} |`,
		`| deep | \`${agentName("read", "deep")}\` | \`${agentName("edit", "deep")}\` | ${models.deep} |`
	].join("\n");
}
function skillMarkdown(runtime, models, minLines) {
	return `---
name: ${SKILL_NAME}
description: ALWAYS use this before delegating work to a subagent or choosing which agent or model runs it, before reading large or many files, scanning logs, test output or diffs, and before editing boilerplate, tests, config or mechanical multi-file changes. Routes reads and edits to the cheapest capable ladder agent (fast → balanced → deep) so file contents never fill the main session, which keeps the reasoning.
---

# Model ladder

The main session is the expensive model. Its job is reasoning: deciding, designing, debugging, verifying. Most other work is I/O: reading many files to answer one question, or writing code that follows an existing pattern. Send that I/O to a ladder agent and keep only its short answer.

Call ladder agents with ${HOW_TO_CALL[runtime]}.

${agentTable(models)}

## Reads

Delegate a read when it would put more into your context than the answer needs:

- a multi-file question ("where is X configured", "which callers pass Y", "what does this module do");
- any file over about ${minLines} lines that you need only to understand, not to edit;
- logs, test output, generated files, lockfiles, large diffs.

Start at **fast**. Start at **balanced** only when the question needs tracing a flow across several modules.

Keep reads inline when:

- you are about to edit the file: read the exact range you will change (search for the line numbers first, then read with offset/limit). Worker summaries are not reliable enough for line-exact edits;
- the file is short and you need it once;
- the question *is* the reasoning (root cause of a bug, design trade-off, security or concurrency review). Delegate the gathering; keep the judgment.

## Edits

Delegate an edit when you can state the spec in a few lines and point at a reference file to copy:

- **fast**: tests that mirror an existing test, config stubs, renames, doc updates, mechanical multi-file changes;
- **balanced**: new logic inside one module with a clear spec, a multi-file change with its tests, a fast attempt that failed;
- **deep**: only after balanced failed verification.

Keep in the main session: design decisions, debugging, anything touching auth, permissions, data migrations or concurrency, and the final verification of every delegated edit.

## Handoff

Reads:

\`\`\`
Question: <one question>
Scope: <paths or globs>
Answer shape: <bullets with path:line | list of symbols | yes/no with evidence>
Budget: <= 300 words
\`\`\`

Edits:

\`\`\`
Spec: <what must be true afterwards>
Allowed edit surfaces: <exact paths or narrow globs>
Reference: <existing file whose pattern to follow>
Verify: <one focused command>
Previous attempt: <only when escalating: the lower rung's STATUS and failure excerpt>
\`\`\`

Every ladder agent replies with \`STATUS: done | partial | escalate\`. Edit agents never paste the code they wrote; check \`git diff --stat\` and run the verify command yourself.

## When you cannot spawn agents

If you are yourself a subagent or a parallel worker without an agent tool, run the same ladder from the shell:

\`\`\`sh
agent-config delegate read --runtime ${runtime} "<the read handoff above>"
agent-config delegate edit --runtime ${runtime} --tier balanced --verify "<verify command>" "<the edit handoff above>"
printf '%s' "<long handoff>" | agent-config delegate read --runtime ${runtime} -
\`\`\`

It runs the ladder agent headlessly, climbs fast → balanced → deep by itself on \`partial\`, \`escalate\` or failure, and prints only the final reply (rung and timing go to stderr; \`--json\` for structured output, \`--no-climb\` to stay on one rung, \`-\` to read the task from stdin). Edits may run only the \`--verify\` command; without it the edit agent gets no shell. Exit codes: 0 done, 3 still partial after the last rung, 1 failed, 4 refused because you are already running inside a delegated agent: then do the work yourself or reply \`STATUS: escalate\`. Ladder agents never call it.

## Climbing

1. One attempt per rung.
2. Climb one rung when the reply is \`partial\` or \`escalate\`, when verification fails, or when the answer contradicts evidence you already hold. Pass the previous reply's summary, never file contents.
3. When **deep** fails, stop delegating and do it yourself with what the attempts taught you.
4. Do not climb for speed. A wrong cheap answer that you then verify still costs less than starting high.

## Gentle AI reviews

Gentle AI review agents (\`review-risk\`, \`review-resilience\`, \`review-readability\`, \`review-reliability\`, \`review-refuter\`) run on the rungs agent-config assigned them. The review lifecycle stays Gentle AI's: never relaunch a lens on another model yourself, and follow only the transitions the review returns. A bounded review correction is an edit like any other: hand the frozen finding as the spec to a ladder edit agent and verify it yourself before capturing the result.
`;
}
function instructionsBlock(runtime, minLines) {
	return `## Model ladder

Reads and edits go to the cheapest capable model; this session keeps the reasoning. Use the \`${SKILL_NAME}\` skill before reading many files, any file over about ${minLines} lines that you will not edit, logs or test output, and before writing boilerplate, tests or mechanical edits. Call ladder agents with ${HOW_TO_CALL[runtime]}.

- Reads start at \`ladder-read-fast\`; edits start at \`ladder-edit-fast\` for pattern work and \`ladder-edit-balanced\` for new logic. Context offload is a named delegation reason.
- Climb one rung (fast → balanced → deep) only when a reply is \`partial\` or \`escalate\` or fails verification; after deep fails, do it yourself.
- Before editing, read the exact lines yourself with offset/limit. Keep debugging, design and security, data or concurrency changes in this session, and verify every delegated edit.
- Without an agent tool (for example as a parallel subagent), use \`agent-config delegate read|edit --runtime ${runtime} "<task>"\` from the shell instead.`;
}
const ROLE_BODY = {
	read: `You are a read-only worker on the model ladder. The parent session delegated a question so that file contents stay out of its context. Answer that question and nothing else.

Rules:
- Read, search and summarize only. Never edit files, never run commands that change anything.
- You are already a ladder agent: never delegate further (no subagents, no \`agent-config delegate\`).
- Cite evidence as \`path:line\` using the line numbers your read tool shows. Never estimate a line number.
- Quote at most 5 lines per excerpt, and only when the exact text matters. Never paste whole files.
- Keep the whole reply under 300 words unless the parent set another budget.
- If answering needs judgment beyond locating and summarizing (root cause, design trade-offs, security), stop and say so in STATUS instead of guessing.

Reply in exactly this shape:

STATUS: done | partial | escalate
ANSWER:
- <terse bullet with path:line>
GAPS: <what you could not determine, or "none">`,
	edit: `You are an edit worker on the model ladder. The parent session gives you a spec, the allowed edit surfaces, a reference file whose pattern to follow, and a verify command.

Rules:
- Read the reference file and the targets, then make the change. Match the reference's naming, structure and comment density.
- Write only inside the allowed edit surfaces. If the change needs another file, stop and say so in STATUS.
- Run the verify command once after the change. If it fails, fix and run it once more. If it still fails, stop.
- Never commit, push, install dependencies, or run repository-wide formatters or generators.
- You are already a ladder agent: never delegate further (no subagents, no \`agent-config delegate\`).
- Never paste the code you wrote into your reply. The parent reads the diff.

Reply in exactly this shape:

STATUS: done | partial | escalate
CHANGED:
- <path> (+added/-removed lines)
VERIFY: <command>: <pass | fail, with a one-line excerpt>
NOTES: <deviations from the spec or assumptions, or "none">`
};
const TIER_NOTE = {
	fast: "You are the fast rung. If the task turns out to need multi-step reasoning, reply STATUS: escalate early: that costs less than a wrong answer.",
	balanced: "You are the balanced rung. When the parent includes a previous attempt, avoid repeating its failure.",
	deep: "You are the deep rung: cheaper rungs already failed this task. Read the previous attempt the parent included, be thorough, and still keep the reply short."
};
function agentDescription(role, tier, model) {
	return `Model ladder ${role} agent (${model || "session model"}). ${role === "read" ? "Read-only: answers questions about many or large files, logs and test output with terse path:line bullets, so their contents stay out of the main context." : "Writes code from a short spec and a reference file (tests, boilerplate, config, mechanical edits) and runs one verify command."} ${{
		fast: "First rung.",
		balanced: "Second rung: use after the fast rung replies partial/escalate or for multi-step work.",
		deep: "Last rung: use only after the balanced rung failed."
	}[tier]}`;
}
function agentBody(role, tier) {
	return `${ROLE_BODY[role]}\n\n${TIER_NOTE[tier]}\n`;
}
//#endregion
//#region src/runtimes.ts
/** Which components mean something for each runtime. */
const RUNTIME_COMPONENTS = {
	claude: [
		"agents",
		"skill",
		"instructions",
		"read-guard",
		"review-models"
	],
	opencode: [
		"agents",
		"skill",
		"instructions",
		"review-models"
	],
	codex: [
		"agents",
		"skill",
		"instructions"
	],
	pi: [
		"agents",
		"skill",
		"instructions",
		"review-models"
	]
};
const READ_GUARD_FILE = "read-guard.mjs";
/** A file shipped in assets/, such as a hook script. */
function assetSource(file) {
	const here = dirname(fileURLToPath(import.meta.url));
	return readFileSync(join(here, "..", "assets", file), "utf8");
}
function readGuardSource() {
	return assetSource(READ_GUARD_FILE);
}
function modelNames(runtime, tiers) {
	const name = (tier) => {
		const t = tiers[tier];
		if (runtime === "codex" || !t.model) return `${t.model || "session model"}, ${t.effort} effort`;
		return t.model;
	};
	return {
		fast: name("fast"),
		balanced: name("balanced"),
		deep: name("deep")
	};
}
function yamlString(value) {
	return JSON.stringify(value);
}
/** A TOML multi-line basic string: escapes backslashes, quote runs and control characters. */
function tomlMultiline(text) {
	return `"""\n${text.replace(/\\/g, "\\\\").replace(/"""/g, "\"\"\\\"").replace(/\r/g, "\\r").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"""`;
}
const PI_THINKING = {
	low: "low",
	medium: "medium",
	high: "high"
};
function agentFile(runtime, role, tier, tiers) {
	const name = agentName(role, tier);
	const { model, effort } = tiers[tier];
	const description = agentDescription(role, tier, model);
	const body = agentBody(role, tier);
	switch (runtime) {
		case "claude": {
			const tools = role === "read" ? "Read, Grep, Glob" : "Read, Edit, Write, Grep, Glob, Bash";
			const lines = [
				"---",
				`name: ${name}`,
				`description: ${yamlString(description)}`
			];
			if (model) lines.push(`model: ${model}`);
			lines.push(`tools: ${tools}`, "---", "", body);
			return {
				path: join(claudeDir(), "agents", `${name}.md`),
				content: lines.join("\n")
			};
		}
		case "opencode": {
			const lines = [
				"---",
				`description: ${yamlString(description)}`,
				"mode: subagent"
			];
			if (model) lines.push(`model: ${model}`);
			lines.push("permission:");
			if (role === "read") lines.push("  edit: deny", "  bash: deny");
			lines.push("  task: deny", "---", "", body);
			return {
				path: join(opencodeDir(), "agents", `${name}.md`),
				content: lines.join("\n")
			};
		}
		case "codex": {
			const lines = [`name = ${JSON.stringify(name)}`, `description = ${JSON.stringify(description)}`];
			if (model) lines.push(`model = ${JSON.stringify(model)}`);
			lines.push(`model_reasoning_effort = ${JSON.stringify(effort)}`, `sandbox_mode = ${JSON.stringify(role === "read" ? "read-only" : "workspace-write")}`, `developer_instructions = ${tomlMultiline(body)}`, "");
			return {
				path: join(codexDir(), "agents", `${name}.toml`),
				content: lines.join("\n")
			};
		}
		case "pi": {
			const tools = role === "read" ? [
				"read",
				"grep",
				"find",
				"ls"
			] : [
				"read",
				"grep",
				"find",
				"ls",
				"edit",
				"write",
				"bash"
			];
			const lines = [
				"---",
				`name: ${name}`,
				`description: ${yamlString(description)}`
			];
			if (model) lines.push(`model: ${model}`);
			lines.push(`thinking: ${PI_THINKING[effort]}`, "tools:", ...tools.map((t) => `  - ${t}`), "---", "", body);
			return {
				path: join(piDir(), "agents", `${name}.md`),
				content: lines.join("\n")
			};
		}
	}
}
function skillPath(runtime) {
	const root = {
		claude: claudeDir(),
		opencode: opencodeDir(),
		codex: codexDir(),
		pi: piDir()
	}[runtime];
	return join(root, "skills", SKILL_NAME, "SKILL.md");
}
function instructionsPath(runtime) {
	switch (runtime) {
		case "claude": return join(claudeDir(), "CLAUDE.md");
		case "opencode": return join(opencodeDir(), "AGENTS.md");
		case "codex": return join(codexDir(), "AGENTS.md");
		case "pi": return join(piDir(), "AGENTS.md");
	}
}
/** opencode.jsonc when the directory has one, else opencode.json. */
function opencodeConfigPath(dir = opencodeDir()) {
	const jsonc = join(dir, "opencode.jsonc");
	return existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
}
function reviewOps(runtime, config) {
	const tiers = config.tiers[runtime];
	const ops = [];
	const base = {
		runtime,
		component: "review-models"
	};
	for (const lens of REVIEW_LENSES) {
		const { model, effort } = tiers[config.reviewTiers[lens]];
		const label = `${lens} → ${config.reviewTiers[lens]} (${model || "session model"})`;
		switch (runtime) {
			case "claude":
				if (model) ops.push({
					...base,
					kind: "frontmatter",
					path: join(claudeDir(), "agents", `${lens}.md`),
					key: "model",
					value: model,
					label
				});
				break;
			case "opencode":
				if (model) ops.push({
					...base,
					kind: "json-set",
					path: opencodeConfigPath(),
					pointer: [
						"agent",
						lens,
						"model"
					],
					value: model,
					requireParent: true,
					label
				});
				break;
			case "pi": {
				const agentPath = join(piDir(), "agents", `${lens}.md`);
				const modelsPath = join(dirname(piDir()), "gentle-ai", "models.json");
				const profilesPath = join(piDir(), "subagents.json");
				if (model) ops.push({
					...base,
					kind: "frontmatter",
					path: agentPath,
					key: "model",
					value: model,
					label
				}, {
					...base,
					kind: "json-set",
					path: modelsPath,
					pointer: [lens, "model"],
					value: model,
					requireParent: true,
					label: `${label} [models.json]`
				}, {
					...base,
					kind: "json-set",
					path: profilesPath,
					pointer: [
						"model_profiles",
						lens,
						"model"
					],
					value: model,
					requireParent: true,
					label: `${label} [subagents.json]`
				});
				ops.push({
					...base,
					kind: "frontmatter",
					path: agentPath,
					key: "thinking",
					value: PI_THINKING[effort],
					label: `${lens} thinking → ${effort}`
				}, {
					...base,
					kind: "json-set",
					path: modelsPath,
					pointer: [lens, "thinking"],
					value: PI_THINKING[effort],
					requireParent: true,
					label: `${lens} thinking → ${effort} [models.json]`
				}, {
					...base,
					kind: "json-set",
					path: profilesPath,
					pointer: [
						"model_profiles",
						lens,
						"effort"
					],
					value: effort,
					requireParent: true,
					label: `${lens} effort → ${effort} [subagents.json]`
				});
				break;
			}
		}
	}
	return ops;
}
/** All operations for one runtime and the selected components, in apply order. */
function runtimeOps(runtime, config) {
	const wanted = config.components.filter((c) => RUNTIME_COMPONENTS[runtime].includes(c));
	const tiers = config.tiers[runtime];
	const ops = [];
	if (wanted.includes("agents")) for (const role of ROLES) for (const tier of TIERS) {
		const { path, content } = agentFile(runtime, role, tier, tiers);
		ops.push({
			runtime,
			component: "agents",
			kind: "file",
			path,
			content,
			label: `${agentName(role, tier)} (${tiers[tier].model || `session model, ${tiers[tier].effort}`})`
		});
	}
	if (wanted.includes("skill")) ops.push({
		runtime,
		component: "skill",
		kind: "file",
		path: skillPath(runtime),
		content: skillMarkdown(runtime, modelNames(runtime, tiers), config.minLines),
		label: `skill ${SKILL_NAME}`
	});
	if (wanted.includes("instructions")) ops.push({
		runtime,
		component: "instructions",
		kind: "block",
		path: instructionsPath(runtime),
		content: instructionsBlock(runtime, config.minLines),
		label: "instructions block"
	});
	if (wanted.includes("read-guard") && runtime === "claude") {
		const script = join(claudeDir(), "hooks", "agent-config", READ_GUARD_FILE);
		const settings = join(claudeDir(), "settings.json");
		ops.push({
			runtime,
			component: "read-guard",
			kind: "file",
			path: script,
			content: readGuardSource(),
			executable: true,
			label: "read-guard hook script"
		}, {
			runtime,
			component: "read-guard",
			kind: "json-hook",
			path: settings,
			event: "PreToolUse",
			matcher: "Read|Bash",
			command: `node "${script}"`,
			label: "PreToolUse hook (Read|Bash)"
		}, {
			runtime,
			component: "read-guard",
			kind: "json-set",
			path: settings,
			pointer: ["env", "AGENT_CONFIG_MIN_LINES"],
			value: String(config.minLines),
			label: `env AGENT_CONFIG_MIN_LINES=${config.minLines}`
		});
	}
	if (wanted.includes("review-models")) ops.push(...reviewOps(runtime, config));
	return ops;
}
//#endregion
//#region src/catalog.ts
/** Identifies an entry in the config and its ops in the manifest: "kaneo@user" or "kaneo@/repo". */
function entryKey(entry) {
	return `${entry.item}@${entry.project ?? "user"}`;
}
function scopeLabel(entry) {
	return entry.project ? `project ${entry.project}` : "user";
}
/** Where a runtime reads skills, agents and instructions at user or project scope. */
function layout(runtime, project) {
	if (!project) {
		const root = {
			claude: claudeDir(),
			opencode: opencodeDir(),
			codex: codexDir(),
			pi: piDir()
		}[runtime];
		const memory = runtime === "claude" ? "CLAUDE.md" : "AGENTS.md";
		return {
			skills: join(root, "skills"),
			agents: join(root, "agents"),
			instructions: join(root, memory)
		};
	}
	switch (runtime) {
		case "claude": return {
			skills: join(project, ".claude", "skills"),
			agents: join(project, ".claude", "agents"),
			instructions: join(project, "CLAUDE.md")
		};
		case "opencode": return {
			skills: join(project, ".opencode", "skills"),
			agents: join(project, ".opencode", "agents"),
			instructions: join(project, "AGENTS.md")
		};
		case "codex": return {
			skills: join(project, ".agents", "skills"),
			agents: join(project, ".codex", "agents"),
			instructions: join(project, "AGENTS.md")
		};
		case "pi": return {
			skills: join(project, ".pi", "skills"),
			agents: join(project, ".pi", "agents"),
			instructions: join(project, "AGENTS.md")
		};
	}
}
/** Markers of an item's managed block in Markdown and in TOML. */
function blockMarkers(id, comment) {
	const note = "managed by agent-config, edits inside this block are overwritten";
	return comment === "html" ? [`<!-- BEGIN agent-config:${id}: ${note} -->`, `<!-- END agent-config:${id} -->`] : [`# BEGIN agent-config:${id}: ${note}`, `# END agent-config:${id}`];
}
function readJson(path) {
	try {
		return parse(readFileSync(path, "utf8"), [], { allowTrailingComma: true });
	} catch {
		return;
	}
}
function at(root, pointer) {
	let node = root;
	for (const seg of pointer) {
		if (node === null || typeof node !== "object") return void 0;
		node = node[seg];
	}
	return node;
}
function modelName(runtime, tiers, effort = tiers.fast.effort, tier = "fast") {
	const { model } = tiers[tier];
	if (runtime === "codex" || !model) return `${model || "session model"}, ${effort} effort`;
	return model;
}
function cheapAgent(runtime, dir, tiers, agent) {
	const { model } = tiers.fast;
	const effort = agent.effort ?? tiers.fast.effort;
	const { name, body } = agent;
	const description = JSON.stringify(agent.description);
	switch (runtime) {
		case "claude": {
			const lines = [
				"---",
				`name: ${name}`,
				`description: ${description}`
			];
			if (model) lines.push(`model: ${model}`);
			lines.push(`tools: ${agent.claudeTools.join(", ")}`, "---", "", body);
			return {
				path: join(dir, `${name}.md`),
				content: lines.join("\n")
			};
		}
		case "opencode": {
			const lines = [
				"---",
				`description: ${description}`,
				"mode: subagent"
			];
			if (model) lines.push(`model: ${model}`);
			lines.push("permission:", ...agent.opencodeDeny.map((p) => `  ${p}: deny`), "---", "", body);
			return {
				path: join(dir, `${name}.md`),
				content: lines.join("\n")
			};
		}
		case "codex": {
			const lines = [`name = ${JSON.stringify(name)}`, `description = ${description}`];
			if (model) lines.push(`model = ${JSON.stringify(model)}`);
			lines.push(`model_reasoning_effort = ${JSON.stringify(effort)}`, `sandbox_mode = ${JSON.stringify(agent.codexSandbox)}`, `developer_instructions = ${tomlMultiline(body)}`, "");
			return {
				path: join(dir, `${name}.toml`),
				content: lines.join("\n")
			};
		}
		case "pi": {
			const lines = [
				"---",
				`name: ${name}`,
				`description: ${description}`
			];
			if (model) lines.push(`model: ${model}`);
			lines.push(`thinking: ${effort}`, "tools:", ...agent.piTools.map((t) => `  - ${t}`), "---", "", body);
			return {
				path: join(dir, `${name}.md`),
				content: lines.join("\n")
			};
		}
	}
}
/** The block that the standalone kaneo-work-tracking-skill installer wrote; replaced in place. */
const KANEO_LEGACY_BLOCK = ["<!-- BEGIN kaneo-work-tracking-skill: managed by install.sh, edits inside this block are overwritten -->", "<!-- END kaneo-work-tracking-skill -->"];
const SCRIBE_AGENT = {
	name: SCRIBE,
	description: SCRIBE_DESCRIPTION,
	body: SCRIBE_BODY,
	claudeTools: KANEO_TOOLS,
	opencodeDeny: [
		"edit",
		"bash",
		"task"
	],
	codexSandbox: "read-only",
	piTools: ["tool_search"]
};
function kaneoMcpOp(runtime, project, url) {
	const base = {
		runtime,
		component: "catalog",
		label: `kaneo MCP server ${url}`
	};
	switch (runtime) {
		case "claude": return {
			...base,
			kind: "json-set",
			path: project ? join(project, ".mcp.json") : claudeJsonPath(),
			pointer: ["mcpServers", KANEO_MCP],
			value: {
				type: "http",
				url
			}
		};
		case "opencode": return {
			...base,
			kind: "json-set",
			path: opencodeConfigPath(project),
			pointer: ["mcp", KANEO_MCP],
			value: {
				enabled: true,
				type: "remote",
				url
			}
		};
		case "codex": {
			const table = `[mcp_servers.${KANEO_MCP}]`;
			return {
				...base,
				kind: "block",
				path: join(project ? join(project, ".codex") : codexDir(), "config.toml"),
				content: `${table}\nurl = ${JSON.stringify(url)}`,
				markers: [blockMarkers("kaneo", "hash")],
				conflict: table
			};
		}
		case "pi": return {
			...base,
			kind: "json-set",
			path: project ? join(project, ".pi", "mcp.json") : join(piDir(), "mcp.json"),
			pointer: ["mcpServers", KANEO_MCP],
			value: { url }
		};
	}
}
/**
* The model ladder: ladder agents, routing skill, instructions, read guard and review models.
* Its parts, rungs and models are the top-level ladder settings of the saved configuration.
*/
const modelLadder = {
	id: LADDER_ITEM,
	title: "Model ladder",
	description: "Route reads and edits to the cheapest capable model (fast → balanced → deep): ladder agents, skill, instructions, read guard, review models.",
	settings: [],
	userOnly: true,
	discover: () => ({}),
	ops: (_entry, runtime, config) => runtimeOps(runtime, config)
};
const kaneo = {
	id: "kaneo",
	title: "Kaneo work tracking",
	description: "kaneo-work-tracking skill, always-on rules, the kaneo MCP server and a cheap kaneo-scribe agent that saves tickets",
	settings: [{
		key: "url",
		flag: "url",
		message: "Kaneo base URL",
		placeholder: "https://kaneo.example.com",
		normalize: kaneoBaseUrl,
		warning: kaneoUrlWarning
	}],
	discover: () => {
		const found = [
			at(readJson(claudeJsonPath()), [
				"mcpServers",
				KANEO_MCP,
				"url"
			]),
			at(readJson(opencodeConfigPath()), [
				"mcp",
				KANEO_MCP,
				"url"
			]),
			at(readJson(join(piDir(), "mcp.json")), [
				"mcpServers",
				KANEO_MCP,
				"url"
			])
		].find((u) => typeof u === "string");
		const url = found && kaneoBaseUrl(found);
		return url ? { url } : {};
	},
	ops: (entry, runtime, config) => {
		const tiers = config.tiers[runtime];
		const where = layout(runtime, entry.project);
		const scribe = cheapAgent(runtime, where.agents, tiers, SCRIBE_AGENT);
		const ops = [
			{
				runtime,
				component: "catalog",
				kind: "file",
				path: join(where.skills, KANEO_SKILL, "SKILL.md"),
				content: kaneoSkillMarkdown(runtime, modelName(runtime, tiers)),
				label: `kaneo skill ${KANEO_SKILL}`
			},
			{
				runtime,
				component: "catalog",
				kind: "file",
				path: scribe.path,
				content: scribe.content,
				label: `kaneo agent ${SCRIBE} (${modelName(runtime, tiers)})`
			},
			{
				runtime,
				component: "catalog",
				kind: "block",
				path: where.instructions,
				content: kaneoInstructionsBlock(entry.runtimes.filter((r) => layout(r, entry.project).instructions === where.instructions)),
				markers: [blockMarkers("kaneo", "html"), KANEO_LEGACY_BLOCK],
				label: "kaneo instructions block"
			}
		];
		const url = entry.settings.url;
		if (url) ops.push(kaneoMcpOp(runtime, entry.project, kaneoMcpUrl(url)));
		return ops;
	}
};
/** The block that the standalone claude-commit-skill installer wrote; replaced in place. */
const COMMIT_LEGACY_BLOCK = ["<!-- BEGIN claude-commit-skill: managed by install.sh, edits inside this block are overwritten -->", "<!-- END claude-commit-skill -->"];
/** Commit titles are short pattern work: the fast model, always at low effort. */
const WRITER_EFFORT = "low";
const WRITER_AGENT = {
	name: COMMIT_WRITER,
	description: WRITER_DESCRIPTION,
	body: WRITER_BODY,
	effort: WRITER_EFFORT,
	claudeTools: [
		"Bash",
		"Read",
		"Grep",
		"Glob"
	],
	opencodeDeny: ["edit", "task"],
	codexSandbox: "read-only",
	piTools: [
		"read",
		"grep",
		"find",
		"ls",
		"bash"
	]
};
/**
* Claude only: copies a hook script asset into the hooks folder and registers it as a PreToolUse
* hook for the matcher. A project's settings are committed, so its hook finds the script from the
* project root.
*/
function guardHookOps(project, file, matcher, scriptLabel, hookLabel) {
	const base = {
		runtime: "claude",
		component: "catalog"
	};
	const dir = project ? join(project, ".claude") : claudeDir();
	const script = join(dir, "hooks", "agent-config", file);
	const settings = join(dir, "settings.json");
	const command = project ? `node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-config/${file}"` : `node "${script}"`;
	return [{
		...base,
		kind: "file",
		path: script,
		content: assetSource(file),
		executable: true,
		label: scriptLabel
	}, {
		...base,
		kind: "json-hook",
		path: settings,
		event: "PreToolUse",
		matcher,
		command,
		label: hookLabel
	}];
}
/** Claude only: the commit guard hook and the settings that drop commit and PR attribution. */
function commitGuardOps(project) {
	const base = {
		runtime: "claude",
		component: "catalog"
	};
	const dir = project ? join(project, ".claude") : claudeDir();
	const settings = join(dir, "settings.json");
	return [
		...guardHookOps(project, COMMIT_GUARD_FILE, "Bash", "commit-guard hook script", "PreToolUse hook (Bash) commit guard"),
		{
			...base,
			kind: "json-set",
			path: settings,
			pointer: ["attribution", "commit"],
			value: "",
			label: "attribution.commit = \"\""
		},
		{
			...base,
			kind: "json-set",
			path: settings,
			pointer: ["attribution", "pr"],
			value: "",
			label: "attribution.pr = \"\""
		},
		{
			...base,
			kind: "json-set",
			path: settings,
			pointer: ["includeCoAuthoredBy"],
			value: false,
			label: "includeCoAuthoredBy = false"
		}
	];
}
const commit = {
	id: "commit",
	title: "Commit titles",
	description: "title-only commit skill, no-AI-attribution rules, a cheap low-thinking commit-writer agent that drafts the title, and a Claude commit guard",
	settings: [],
	discover: () => ({}),
	ops: (entry, runtime, config) => {
		const tiers = config.tiers[runtime];
		const where = layout(runtime, entry.project);
		const writer = cheapAgent(runtime, where.agents, tiers, WRITER_AGENT);
		const model = modelName(runtime, tiers, WRITER_EFFORT);
		const ops = [
			{
				runtime,
				component: "catalog",
				kind: "file",
				path: join(where.skills, COMMIT_SKILL, "SKILL.md"),
				content: commitSkillMarkdown(runtime, model),
				label: `commit skill ${COMMIT_SKILL}`
			},
			{
				runtime,
				component: "catalog",
				kind: "file",
				path: writer.path,
				content: writer.content,
				label: `commit agent ${COMMIT_WRITER} (${model})`
			},
			{
				runtime,
				component: "catalog",
				kind: "block",
				path: where.instructions,
				content: commitInstructionsBlock(entry.runtimes.filter((r) => layout(r, entry.project).instructions === where.instructions)),
				markers: [blockMarkers("commit", "html"), COMMIT_LEGACY_BLOCK],
				label: "commit instructions block"
			}
		];
		if (runtime === "claude") ops.push(...commitGuardOps(entry.project));
		return ops;
	}
};
/**
* Where each runtime reads a manual-only action: a Claude skill that the model never invokes, an
* OpenCode command, a Codex skill with implicit invocation off, a Pi prompt template.
*/
function actionOps(runtime, project, name, content, label) {
	const base = {
		runtime,
		component: "catalog",
		label: `${label} action`
	};
	const skill = join(layout(runtime, project).skills, name);
	switch (runtime) {
		case "claude": return [{
			...base,
			kind: "file",
			path: join(skill, "SKILL.md"),
			content
		}];
		case "opencode": {
			const dir = project ? join(project, ".opencode") : opencodeDir();
			return [{
				...base,
				kind: "file",
				path: join(dir, "commands", `${name}.md`),
				content
			}];
		}
		case "codex": return [{
			...base,
			kind: "file",
			path: join(skill, "SKILL.md"),
			content
		}, {
			...base,
			kind: "file",
			path: join(skill, "agents", "openai.yaml"),
			content: CODEX_POLICY,
			label: `${label} action policy (explicit invocation only)`
		}];
		case "pi": {
			const dir = project ? join(project, ".pi") : piDir();
			return [{
				...base,
				kind: "file",
				path: join(dir, "prompts", `${name}.md`),
				content
			}];
		}
	}
}
function continueOps(runtime, project, config) {
	const tiers = config.tiers[runtime];
	const content = continueMarkdown(runtime, {
		fast: modelName(runtime, tiers),
		balanced: modelName(runtime, tiers, tiers.balanced.effort, "balanced")
	});
	return actionOps(runtime, project, CONTINUE, content, "continue");
}
/** How the skill shows the home directory. */
const HOME_SHORTHAND = "~";
/** The brief folder as the skill shows it: under the home directory it reads `~/...`. */
function briefDirText() {
	const dir = kickOffDir();
	const root = home();
	return dir.startsWith(`${root}/`) ? `${HOME_SHORTHAND}${dir.slice(root.length)}` : dir;
}
/** Claude only: the guard that keeps phase rungs and the brief structure honest. */
function kickOffGuardOps(project) {
	return guardHookOps(project, KICK_OFF_GUARD_FILE, KICK_OFF_GUARD_MATCHER, "kick-off-guard hook script", `PreToolUse hook (${KICK_OFF_GUARD_MATCHER}) kick-off guard`);
}
function kickOffOps(runtime, project, config) {
	const tiers = config.tiers[runtime];
	const content = kickOffMarkdown(runtime, {
		fast: modelName(runtime, tiers),
		balanced: modelName(runtime, tiers, tiers.balanced.effort, "balanced"),
		deep: modelName(runtime, tiers, tiers.deep.effort, "deep")
	}, briefDirText());
	const ops = actionOps(runtime, project, KICK_OFF, content, "kick-off");
	if (runtime === "claude") ops.push(...kickOffGuardOps(project));
	return ops;
}
const STATUSLINE_FILE = "statusline.sh";
const CATALOG = [
	modelLadder,
	kaneo,
	commit,
	{
		id: CONTINUE,
		title: "Continue Kaneo tickets",
		description: "manual /continue action that works the next Kaneo ticket (or several in parallel worktrees) end to end, handing reads, edits, ticket writes and commit titles to cheap agents",
		settings: [],
		discover: () => ({}),
		ops: (entry, runtime, config) => continueOps(runtime, entry.project, config)
	},
	{
		id: KICK_OFF,
		title: "Kick off a Kaneo epic",
		description: "manual /kick-off action that diagnoses what a Kaneo epic is missing on the deep rung, asks how to run it and copies a /continue brief that works the whole epic in a fresh session, with risk-routed reviews and a Claude guard hook",
		settings: [],
		discover: () => ({}),
		ops: (entry, runtime, config) => kickOffOps(runtime, entry.project, config)
	},
	{
		id: "statusline",
		title: "Status line",
		description: "compact Claude Code status line: directory, git branch and dirty mark, model, context and rate-limit usage",
		settings: [],
		userOnly: true,
		runtimes: ["claude"],
		discover: () => ({}),
		ops: () => {
			const base = {
				runtime: "claude",
				component: "catalog"
			};
			const script = join(claudeDir(), STATUSLINE_FILE);
			return [{
				...base,
				kind: "file",
				path: script,
				content: assetSource(STATUSLINE_FILE),
				executable: true,
				label: "status line script"
			}, {
				...base,
				kind: "json-set",
				path: join(claudeDir(), "settings.json"),
				pointer: ["statusLine"],
				value: {
					type: "command",
					command: `bash "${script}"`
				},
				label: "statusLine command"
			}];
		}
	}
];
function catalogItem(id) {
	return CATALOG.find((i) => i.id === id);
}
/** The runtimes the model ladder is installed for; empty when it is not installed. */
function ladderRuntimes(config) {
	return config.catalog.find((e) => e.item === "model-ladder")?.runtimes ?? [];
}
/** One line per skipped project entry, telling how to forget it. */
function missingProjectWarnings(config) {
	return missingProjects(config).map((e) => `${e.item}: project directory ${e.project} is gone; skipped. Run \`agent-config uninstall ${e.item} --project ${e.project}\` to forget it.`);
}
/** Project entries whose repository directory no longer exists; they are skipped, not recreated. */
function missingProjects(config) {
	return config.catalog.filter((e) => e.project !== void 0 && !existsSync(e.project));
}
/**
* Ops for the saved catalog entries (only those whose key is in `keys`, when given). At project
* scope several runtimes share AGENTS.md; that block is planned once, for the first runtime. The
* ladder is planned first, as it was before it became a catalog item.
*/
function catalogOps(config, keys) {
	const ops = /* @__PURE__ */ new Map();
	const missing = new Set(missingProjects(config).map(entryKey));
	const entries = [...config.catalog.filter((e) => e.item === LADDER_ITEM), ...config.catalog.filter((e) => e.item !== LADDER_ITEM)];
	for (const entry of entries) {
		const key = entryKey(entry);
		const item = catalogItem(entry.item);
		if (!item || keys && !keys.includes(key) || missing.has(key)) continue;
		for (const runtime of entry.runtimes) for (const op of item.ops(entry, runtime, config)) {
			const tagged = {
				...op,
				item: key
			};
			if (!ops.has(opKey(tagged))) ops.set(opKey(tagged), tagged);
		}
	}
	return [...ops.values()];
}
/**
* Defaults for installing an item at a scope, shared by the CLI and the TUI: runtimes come from
* the saved entry, else the ladder's runtimes, else detection; settings from the saved entry,
* else what this machine already has configured.
*/
function entryDefaults(item, project, config, detected) {
	const saved = config.catalog.find((e) => entryKey(e) === entryKey({
		item: item.id,
		project
	}));
	const ladder = ladderRuntimes(config);
	const runtimes = item.runtimes?.length === 1 ? item.runtimes : (saved?.runtimes.length ? saved.runtimes : ladder.length > 0 ? ladder : detected()).filter((r) => !item.runtimes || item.runtimes.includes(r));
	const discovered = item.discover();
	const settings = {};
	for (const s of item.settings) {
		const own = saved?.settings[s.key];
		if (own) settings[s.key] = {
			value: own,
			source: "saved"
		};
		else if (discovered[s.key]) settings[s.key] = {
			value: discovered[s.key],
			source: "discovered"
		};
	}
	return {
		...saved ? { saved } : {},
		runtimes,
		settings
	};
}
/** Adds or replaces the entry with the same item and scope. */
function upsertEntry(config, entry) {
	const key = entryKey(entry);
	config.catalog = [...config.catalog.filter((e) => entryKey(e) !== key), entry];
}
/** Drops uninstalled runtimes from catalog entries, and entries left with none. */
function forgetCatalog(config, match, runtimes) {
	config.catalog = config.catalog.flatMap((e) => {
		if (!match(e)) return [e];
		const left = runtimes.length === 0 ? [] : e.runtimes.filter((r) => !runtimes.includes(r));
		return left.length > 0 ? [{
			...e,
			runtimes: left
		}] : [];
	});
}
function defaultConfig() {
	return {
		version: 1,
		components: [...COMPONENTS],
		tiers: {
			claude: defaultTierMap("claude"),
			opencode: defaultTierMap("opencode"),
			codex: defaultTierMap("codex"),
			pi: defaultTierMap("pi")
		},
		reviewTiers: { ...DEFAULT_REVIEW_TIERS },
		minLines: 350,
		catalog: []
	};
}
/** Loads the saved config over the defaults, dropping anything unrecognized. */
function loadConfig() {
	const config = defaultConfig();
	let raw;
	try {
		raw = JSON.parse(readFileSync(configPath(), "utf8"));
	} catch {
		return config;
	}
	if (Array.isArray(raw.components)) config.components = raw.components.filter((c) => COMPONENTS.includes(c));
	for (const runtime of RUNTIMES) for (const tier of TIERS) {
		const saved = raw.tiers?.[runtime]?.[tier];
		if (!saved) continue;
		if (typeof saved.model === "string") config.tiers[runtime][tier].model = saved.model;
		if (EFFORTS.includes(saved.effort)) config.tiers[runtime][tier].effort = saved.effort;
	}
	for (const [lens, tier] of Object.entries(raw.reviewTiers ?? {})) if (isReviewLens(lens) && typeof tier === "string" && isTier(tier)) config.reviewTiers[lens] = tier;
	if (typeof raw.minLines === "number" && raw.minLines > 0) config.minLines = Math.floor(raw.minLines);
	if (Array.isArray(raw.catalog)) config.catalog = raw.catalog.flatMap(catalogEntry);
	const legacy = Array.isArray(raw.runtimes) ? raw.runtimes.filter(isRuntime) : [];
	if (legacy.length > 0 && !config.catalog.some((e) => e.item === "model-ladder")) config.catalog.unshift({
		item: LADDER_ITEM,
		runtimes: legacy,
		settings: {}
	});
	return config;
}
/** A saved catalog entry, or nothing when it names an unknown item or is malformed. */
function catalogEntry(raw) {
	if (!raw || typeof raw !== "object") return [];
	const e = raw;
	const item = typeof e.item === "string" ? catalogItem(e.item) : void 0;
	if (!item) return [];
	if (e.project !== void 0 && (typeof e.project !== "string" || !isAbsolute(e.project) || item.userOnly)) return [];
	const settings = {};
	for (const [k, v] of Object.entries(e.settings ?? {})) if (typeof v === "string") settings[k] = v;
	return [{
		item: item.id,
		...e.project ? { project: e.project } : {},
		runtimes: Array.isArray(e.runtimes) ? e.runtimes.filter(isRuntime) : [],
		settings
	}];
}
function saveConfig(config) {
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
//#endregion
//#region src/version.ts
const VERSION = "0.8.0";
//#endregion
//#region src/selfupdate.ts
/** The checkout this CLI runs from (dist/cli.mjs and src/selfupdate.ts sit one level below). */
function checkoutRoot() {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}
function installHome() {
	return setting("HOME") || defaultInstallHome();
}
function defaultInstallHome() {
	return join(home(), ".local", "share", "agent-config");
}
/** Where the pre-rename installer put the checkout. */
function legacyInstallHome() {
	return join(home(), ".local", "share", LEGACY_NAME);
}
function git(root, ...args) {
	return execFileSync("git", [
		"-C",
		root,
		...args
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		timeout: 6e4
	}).trim();
}
function samePath(a, b) {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return false;
	}
}
function gitError(error) {
	const stderr = error?.stderr?.toString().trim();
	if (stderr) return stderr.split("\n").slice(-2).join(" ");
	return error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
}
function checkForUpdate(root = checkoutRoot()) {
	const base = {
		ref: "",
		current: {
			version: VERSION,
			commit: ""
		},
		behind: 0
	};
	const refuse = (reason, extra = {}) => ({
		...base,
		...extra,
		updatable: false,
		reason
	});
	if (!existsSync(join(root, ".git"))) return refuse("not a git checkout; re-run the install one-liner");
	if (!samePath(root, installHome())) return refuse(`running from ${root}, not the installed copy (${installHome()}); use git pull here`);
	let ref;
	let current;
	try {
		ref = git(root, "rev-parse", "--abbrev-ref", "HEAD");
		current = {
			version: VERSION,
			commit: git(root, "rev-parse", "--short", "HEAD")
		};
	} catch (error) {
		return refuse(`cannot read the installed checkout: ${gitError(error)}`);
	}
	if (ref === "HEAD") return refuse("the installed copy is pinned to a fixed commit or tag (detached HEAD); re-run the installer with AGENT_CONFIG_REF=<branch> to follow a branch", { current });
	try {
		git(root, "fetch", "--quiet", "origin", ref);
	} catch (error) {
		return refuse(`could not fetch origin/${ref}: ${gitError(error)}`, {
			ref,
			current
		});
	}
	try {
		const behind = Number(git(root, "rev-list", "--count", `HEAD..origin/${ref}`)) || 0;
		let version = current.version;
		try {
			version = JSON.parse(git(root, "show", `origin/${ref}:package.json`)).version ?? version;
		} catch {}
		const latest = {
			version,
			commit: git(root, "rev-parse", "--short", `origin/${ref}`)
		};
		const relocate = samePath(root, legacyInstallHome()) && !existsSync(defaultInstallHome());
		return {
			updatable: true,
			ref,
			current,
			latest,
			behind,
			...relocate ? { relocate } : {}
		};
	} catch (error) {
		return refuse(`cannot compare with origin/${ref}: ${gitError(error)}`, {
			ref,
			current
		});
	}
}
const ENTRY = join("dist", "cli.mjs");
function runs(root) {
	return spawnSync(process.execPath, [join(root, ENTRY), "--version"], {
		stdio: "ignore",
		timeout: 3e4
	}).status === 0;
}
function runUpdate(check, root = checkoutRoot()) {
	const before = check.current.commit;
	const moving = samePath(root, legacyInstallHome()) && !existsSync(defaultInstallHome());
	const target = moving ? defaultInstallHome() : installHome();
	let finalRoot = root;
	const res = spawnSync("bash", [join(root, "install.sh")], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"ignore",
			"pipe"
		],
		timeout: 9e5,
		env: {
			...process.env,
			AGENT_CONFIG_HOME: target,
			AGENT_CONFIG_REF: check.ref,
			AGENT_CONFIG_NO_RUN: "1",
			NO_COLOR: "1"
		}
	});
	const log = res.stderr ?? "";
	if (moving && !existsSync(root) && existsSync(target)) finalRoot = target;
	let after = "";
	try {
		after = git(finalRoot, "rev-parse", "--short", "HEAD");
	} catch {}
	if (res.status === 0) {
		const moved = finalRoot === target && moving ? `, moved to ${target}` : "";
		return {
			ok: true,
			message: `Updated to v${check.latest?.version} (${after})${moved}`,
			log,
			commit: after,
			root: finalRoot
		};
	}
	const killed = res.error || res.signal ? " (the installer was interrupted)" : "";
	if (after === before && runs(finalRoot)) return {
		ok: false,
		message: `Update failed${killed}; the previous version is still installed.`,
		log,
		root: finalRoot
	};
	return {
		ok: false,
		message: `Update failed${killed} and the installed copy may be inconsistent (at ${after || "an unknown commit"}); re-run the install one-liner to repair it.`,
		log,
		root: finalRoot
	};
}
/**
* Adds the `agi` alias (a relative symlink to the agent-config wrapper) when it is missing.
* Updating runs the old checkout's install.sh, which may predate the alias, so the installed
* command adds it on its next run. Only for the wrapper's bin dir; anything already there stays.
*/
function ensureAgiAlias() {
	const bin = setting("BIN_DIR");
	if (!bin || !existsSync(join(bin, "agent-config"))) return;
	const agi = join(bin, "agi");
	try {
		lstatSync(agi);
		return;
	} catch {}
	try {
		symlinkSync("agent-config", agi);
	} catch {}
}
/** Re-applies the saved configuration with the freshly installed CLI (new prompts and agents). */
function reapplyWithNewVersion(root = checkoutRoot()) {
	return spawnSync(process.execPath, [
		join(root, ENTRY),
		"install",
		"--yes"
	], { stdio: "inherit" }).status ?? 1;
}
//#endregion
//#region src/commands.ts
/** The user cancelled a prompt (Ctrl+C); the CLI exits 130. */
var Cancelled = class extends Error {};
function onPath(bin) {
	try {
		execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
function detect() {
	return RUNTIMES.map((runtime) => ({
		runtime,
		bin: onPath(RUNTIME_BIN[runtime]),
		dir: existsSync(runtimeDir(runtime))
	}));
}
function detectedRuntimes() {
	return detect().filter((d) => d.bin || d.dir).map((d) => d.runtime);
}
/**
* Plans every saved catalog entry, or with `only` just those (keys such as "kaneo@user" or
* "model-ladder@user"), leaving the other entries alone.
*/
function buildPlan(config, only) {
	const manifest = loadManifest().records;
	const records = new Map(manifest.map((r) => [recordKey(r), r]));
	const ops = catalogOps(config, only);
	const wanted = new Set(ops.map(opKey));
	const missing = new Set(missingProjects(config).map(entryKey));
	const planned = new Set((only ?? config.catalog.map(entryKey)).filter((k) => !missing.has(k)));
	const ladder = ladderRuntimes(config);
	return [...manifest.filter((r) => r.item !== void 0 && planned.has(r.item) && !wanted.has(recordKey(r)) && (r.item !== "model-ladder@user" || ladder.includes(r.runtime) && config.components.includes(r.component))).map(planRemoval), ...ops.map((op) => planOp(op, records.get(opKey(op))))];
}
/**
* After uninstalling some runtimes, puts back catalog files the remaining runtimes still use: a
* project's AGENTS.md block is shared by OpenCode, Codex and Pi but recorded under one of them.
*/
function restoreShared(config, removed) {
	const paths = new Set(removed);
	return applyPlan(buildPlan(config, config.catalog.map(entryKey)).filter((x) => (x.action === "create" || x.action === "update") && paths.has(x.op.path))).errors;
}
/**
* Undoes what agent-config installed, limited to one catalog entry (`key`) and/or some runtimes,
* then updates the saved configuration so `install` does not bring it back. An entry whose files
* were kept because the user changed them stays saved, so a later `--force` run can remove them.
*/
function uninstallSelection(selection, force = false) {
	const { key, runtimes } = selection;
	const results = uninstall((r) => (key === void 0 || r.item === key) && (runtimes.length === 0 || runtimes.includes(r.runtime)), force);
	const kept = new Set(results.filter((r) => r.outcome === "kept-modified").map((r) => r.record.item));
	const config = loadConfig();
	forgetCatalog(config, (e) => (key === void 0 || entryKey(e) === key) && (e.item === "model-ladder" || !kept.has(entryKey(e))), runtimes);
	saveConfig(config);
	const removed = results.filter((r) => r.outcome !== "kept-modified").map((r) => r.record.path);
	return {
		results,
		restoreErrors: runtimes.length > 0 ? restoreShared(config, removed) : []
	};
}
function tildify(path) {
	const h = home();
	return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}
function status() {
	return loadManifest().records.map((record) => ({
		record,
		state: recordState(record)
	}));
}
function doctor() {
	const checks = [];
	checks.push({
		name: "node",
		ok: Number(process.versions.node.split(".")[0]) >= 22,
		detail: process.version
	});
	for (const d of detect()) checks.push({
		name: d.runtime,
		ok: d.bin || d.dir,
		detail: d.bin || d.dir ? `${d.bin ? "cli on PATH" : "cli not on PATH"}, ${tildify(runtimeDir(d.runtime))}` : "not installed"
	});
	const codexConfig = join(codexDir(), "config.toml");
	if (existsSync(codexConfig)) {
		const text = readFileSync(codexConfig, "utf8");
		const enabled = /^\s*multi_agent\s*=\s*true/m.test(text);
		checks.push({
			name: "codex multi_agent",
			ok: enabled,
			detail: enabled ? "enabled" : "add `multi_agent = true` under [features] in ~/.codex/config.toml so Codex can spawn ladder agents"
		});
	}
	if (existsSync(piDir())) {
		const settings = join(piDir(), "settings.json");
		const text = existsSync(settings) ? readFileSync(settings, "utf8") : "";
		const subagents = /subagent|gentle-pi/.test(text) || existsSync(join(piDir(), "subagents.json"));
		checks.push({
			name: "pi subagents",
			ok: subagents,
			detail: subagents ? "subagent support found" : "install a Pi subagent extension (for example gentle-pi) so Pi can call ladder agents"
		});
	}
	if (existsSync(legacyInstallHome())) checks.push({
		name: "install location",
		ok: false,
		detail: `${tildify(legacyInstallHome())} is the pre-rename location; run \`agent-config self-update\` or the install one-liner to move it to ${tildify(defaultInstallHome())}`
	});
	const gentle = onPath("gentle-ai");
	checks.push({
		name: "gentle-ai",
		ok: true,
		detail: gentle ? "installed (review-models applies)" : "not installed (review-models skips)"
	});
	const drifted = status().filter((s) => s.state !== "ok");
	checks.push({
		name: "managed files",
		ok: drifted.length === 0,
		detail: drifted.length === 0 ? "all as installed" : `${drifted.length} changed or missing (often \`gentle-ai sync\` resetting review models); run \`agent-config install\` to reapply`
	});
	return checks;
}
//#endregion
//#region src/tui.ts
function ask(value) {
	if (isCancel(value)) throw new Cancelled();
	return value;
}
const ACTION_COLOR = {
	create: import_picocolors.default.green,
	update: import_picocolors.default.yellow,
	unchanged: import_picocolors.default.dim,
	skip: import_picocolors.default.dim,
	remove: import_picocolors.default.red
};
function formatPlan(plan) {
	const lines = [];
	let lastRuntime = "";
	for (const { op, action, reason } of plan) {
		if (op.runtime !== lastRuntime) {
			lines.push(import_picocolors.default.bold(RUNTIME_LABELS[op.runtime]));
			lastRuntime = op.runtime;
		}
		const tag = ACTION_COLOR[action](action.padEnd(9));
		const why = reason ? import_picocolors.default.dim(` (${reason})`) : "";
		lines.push(`  ${tag} ${op.label}${why} ${import_picocolors.default.dim(tildify(op.path))}`);
	}
	return lines.join("\n");
}
function ladderSummary(config, runtime) {
	return TIERS.map((t) => {
		const { model, effort } = config.tiers[runtime][t];
		return `${t}: ${model || "session model"} (${effort})`;
	}).join(" · ");
}
async function chooseModels(config, runtimes) {
	const mode = ask(await select({
		message: "Models for each rung",
		options: [
			{
				value: "keep",
				label: "Keep current",
				hint: runtimes.map((r) => `${r}: ${ladderSummary(config, r)}`).join(" | ")
			},
			{
				value: "recommended",
				label: "Recommended ladder",
				hint: "Haiku 5.5 → Sonnet 5.5 → Opus 5.5 (Codex: effort low → high)"
			},
			{
				value: "custom",
				label: "Customize per runtime"
			}
		]
	}));
	if (mode === "recommended") {
		for (const r of runtimes) config.tiers[r] = defaultTierMap(r);
		return;
	}
	if (mode !== "custom") return;
	for (const runtime of runtimes) {
		log.step(import_picocolors.default.bold(RUNTIME_LABELS[runtime]));
		for (const tier of TIERS) {
			const current = config.tiers[runtime][tier];
			const model = ask(await text({
				message: `${tier} — ${TIER_LABELS[tier]}`,
				placeholder: runtime === "codex" ? "empty = session model" : defaultTierMap(runtime)[tier].model,
				initialValue: current.model
			}));
			const effort = ask(await select({
				message: `${tier} reasoning effort`,
				initialValue: current.effort,
				options: EFFORTS.map((e) => ({
					value: e,
					label: e
				}))
			}));
			config.tiers[runtime][tier] = {
				model: (model ?? "").trim(),
				effort
			};
		}
	}
}
async function chooseReviewTiers(config) {
	const summary = REVIEW_LENSES.map((l) => `${l.replace("review-", "")}: ${config.reviewTiers[l]}`).join(", ");
	if (ask(await select({
		message: "Gentle AI review agents: which rung runs each lens?",
		options: [{
			value: "keep",
			label: "Keep",
			hint: summary
		}, {
			value: "custom",
			label: "Customize per lens"
		}]
	})) !== "custom") return;
	for (const lens of REVIEW_LENSES) config.reviewTiers[lens] = ask(await select({
		message: lens,
		initialValue: config.reviewTiers[lens],
		options: TIERS.map((t) => ({
			value: t,
			label: t,
			hint: TIER_LABELS[t]
		}))
	}));
}
/** Installs or updates the model ladder: agents, parts, models per rung, review rungs, guard. */
async function ladderFlow(config) {
	const found = detect();
	const defaults = entryDefaults(catalogItem(LADDER_ITEM), void 0, config, detectedRuntimes);
	const runtimes = ask(await multiselect({
		message: "Configure which agents?",
		options: found.map((d) => ({
			value: d.runtime,
			label: RUNTIME_LABELS[d.runtime],
			hint: d.bin || d.dir ? "detected" : "not found"
		})),
		initialValues: defaults.runtimes,
		required: true
	}));
	const offered = COMPONENTS.filter((c) => runtimes.some((r) => RUNTIME_COMPONENTS[r].includes(c)));
	config.components = ask(await multiselect({
		message: "Install which parts?",
		options: offered.map((c) => ({
			value: c,
			label: COMPONENT_LABELS[c]
		})),
		initialValues: config.components.filter((c) => offered.includes(c)),
		required: true
	}));
	await chooseModels(config, runtimes);
	if (config.components.includes("review-models")) await chooseReviewTiers(config);
	if (config.components.includes("read-guard") && runtimes.includes("claude")) {
		const value = ask(await text({
			message: "Read guard: block whole reads of files with at least how many lines?",
			initialValue: String(config.minLines),
			validate: (v) => /^\d+$/.test(v ?? "") && Number(v) > 0 ? void 0 : "Enter a positive whole number"
		}));
		config.minLines = Number(value);
	}
	upsertEntry(config, {
		item: LADDER_ITEM,
		runtimes,
		settings: {}
	});
	await applyWithConfirm(buildPlan(config, [LADDER_KEY]), config);
}
/** Re-applies every saved catalog item, for example after an update of agent-config. */
async function reapplyFlow() {
	const config = loadConfig();
	for (const w of missingProjectWarnings(config)) log.warn(w);
	await applyWithConfirm(buildPlan(config), config);
}
/** Shows the plan, asks, applies it and saves the configuration. */
async function applyWithConfirm(plan, config) {
	note(formatPlan(plan), "Plan");
	const changes = plan.filter((x) => x.action === "create" || x.action === "update" || x.action === "remove").length;
	if (changes === 0) {
		saveConfig(config);
		log.success("Everything is already up to date.");
		return;
	}
	if (!ask(await confirm({ message: `Apply ${changes} change(s)?` }))) {
		log.info("Nothing changed.");
		return;
	}
	const spin = spinner();
	spin.start("Applying");
	const result = applyPlan(plan);
	saveConfig(config);
	if (result.errors.length > 0) {
		spin.stop(import_picocolors.default.red(`${result.errors.length} step(s) failed`));
		for (const e of result.errors) log.error(`${e.op.label} (${tildify(e.op.path)}): ${e.error}`);
		return;
	}
	spin.stop("Applied");
	for (const note of result.notes) log.warn(note);
	log.info("Restart running agent sessions to pick up the new agents. Run `agent-config status` any time; `agent-config uninstall` undoes everything.");
}
async function catalogFlow() {
	const config = loadConfig();
	const item = ask(await select({
		message: "Which catalog item?",
		options: CATALOG.map((i) => {
			const where = config.catalog.filter((e) => e.item === i.id).map(scopeLabel);
			return {
				value: i,
				label: i.title,
				hint: where.length > 0 ? `installed: ${where.join(", ")}` : i.description
			};
		})
	}));
	const installed = config.catalog.filter((e) => e.item === item.id);
	if ((installed.length === 0 ? "install" : ask(await select({
		message: item.title,
		options: [{
			value: "install",
			label: "Install or update",
			hint: item.userOnly ? "agents, parts, models" : "user or project scope"
		}, {
			value: "uninstall",
			label: "Uninstall",
			hint: "remove and restore"
		}]
	}))) === "uninstall") {
		const entry = installed.length === 1 ? installed[0] : ask(await select({
			message: "Uninstall which copy?",
			options: installed.map((e) => ({
				value: e,
				label: scopeLabel(e)
			}))
		}));
		if (!ask(await confirm({ message: `Remove ${item.id} (${scopeLabel(entry)})?` }))) return;
		await uninstallAndReport({
			key: entryKey(entry),
			runtimes: []
		});
		return;
	}
	if (item.id === "model-ladder") return ladderFlow(config);
	const project = ask(await select({
		message: "Install where?",
		options: [{
			value: "user",
			label: "User",
			hint: "every project, in your home config"
		}, {
			value: "project",
			label: "Project",
			hint: "one repository, committed with it"
		}]
	})) === "project" ? resolve(ask(await text({
		message: "Project directory",
		initialValue: process.cwd(),
		validate: (v) => {
			const dir = resolve(v ?? "");
			return existsSync(dir) && statSync(dir).isDirectory() ? void 0 : "Enter an existing directory";
		}
	}))) : void 0;
	const defaults = entryDefaults(item, project, config, detectedRuntimes);
	const supported = detect().filter((d) => !item.runtimes || item.runtimes.includes(d.runtime));
	const runtimes = supported.length === 1 ? [supported[0].runtime] : ask(await multiselect({
		message: "For which agents?",
		options: supported.map((d) => ({
			value: d.runtime,
			label: RUNTIME_LABELS[d.runtime],
			hint: d.bin || d.dir ? "detected" : "not found"
		})),
		initialValues: defaults.runtimes,
		required: true
	}));
	const settings = {};
	for (const s of item.settings) {
		const known = defaults.settings[s.key];
		const from = known?.source === "discovered" ? project ? " (from your user config; written into the repository)" : " (from your existing config)" : "";
		const raw = ask(await text({
			message: `${s.message}${from}`,
			placeholder: s.placeholder,
			initialValue: known?.value ?? "",
			validate: (v) => s.normalize(v ?? "") ? void 0 : `Enter a value like ${s.placeholder}`
		}));
		const value = s.normalize(raw) ?? "";
		const warning = s.warning?.(value);
		if (warning) log.warn(warning);
		settings[s.key] = value;
	}
	const entry = {
		item: item.id,
		...project ? { project } : {},
		runtimes,
		settings
	};
	upsertEntry(config, entry);
	await applyWithConfirm(buildPlan(config, [entryKey(entry)]), config);
}
function statusFlow() {
	const entries = status();
	if (entries.length === 0) {
		log.info("Nothing installed yet.");
		return;
	}
	const color = {
		ok: import_picocolors.default.green,
		drifted: import_picocolors.default.yellow,
		missing: import_picocolors.default.red
	};
	const lines = entries.map(({ record, state }) => `${color[state](state.padEnd(8))} ${import_picocolors.default.bold(record.runtime.padEnd(9))} ${record.label} ${import_picocolors.default.dim(tildify(record.path))}`);
	note(lines.join("\n"), "Installed by agent-config");
}
function doctorFlow() {
	const lines = doctor().map((c) => `${c.ok ? import_picocolors.default.green("✔") : import_picocolors.default.yellow("!")} ${c.name.padEnd(18)} ${import_picocolors.default.dim(c.detail)}`);
	note(lines.join("\n"), "Doctor");
}
async function uninstallFlow() {
	const entries = status();
	const installed = [...new Set(entries.map((e) => e.record.runtime))];
	if (installed.length === 0) {
		log.info("Nothing to uninstall.");
		return;
	}
	const runtimes = ask(await multiselect({
		message: "Uninstall from which agents?",
		options: installed.map((r) => ({
			value: r,
			label: RUNTIME_LABELS[r]
		})),
		initialValues: installed,
		required: true
	}));
	if (!ask(await confirm({ message: "Remove agent-config files and restore what they replaced?" }))) return;
	await uninstallAndReport({ runtimes });
}
/** Uninstalls through the same path as the CLI; offers to remove files kept because you changed them. */
async function uninstallAndReport(selection) {
	let { results, restoreErrors } = uninstallSelection(selection);
	let kept = results.filter((r) => r.outcome === "kept-modified");
	log.success(`Undid ${results.length - kept.length} change(s).`);
	for (const k of kept) log.warn(`Kept ${tildify(k.record.path)}: ${k.note}`);
	if (kept.length > 0 && ask(await confirm({ message: "Remove the files you changed too?" }))) {
		({results, restoreErrors} = uninstallSelection(selection, true));
		kept = results.filter((r) => r.outcome === "kept-modified");
		log.success(`Removed ${results.length - kept.length} more.`);
	}
	for (const e of restoreErrors) log.error(`Could not restore ${e.op.label} (${tildify(e.op.path)}): ${e.error}`);
}
/** Returns true when a new version was installed and the TUI should exit. */
async function selfUpdateFlow() {
	const spin = spinner();
	spin.start("Checking for a new version");
	const check = checkForUpdate();
	if (!check.updatable) {
		spin.stop("This copy cannot update itself");
		log.warn(check.reason ?? "unknown reason");
		return false;
	}
	const { current, latest, behind } = check;
	if ((behind === 0 || !latest) && !check.relocate) {
		spin.stop(`Already up to date: v${current.version} (${current.commit})`);
		return false;
	}
	spin.stop(behind === 0 || !latest ? `Up to date, but installed in the pre-rename location; updating moves it to the agent-config location` : `New version: v${latest.version} (${latest.commit}), ${behind} commit(s) newer than v${current.version} (${current.commit})`);
	if (!ask(await confirm({ message: "Update agent-config now?" }))) return false;
	spin.start("Updating");
	const result = runUpdate(check);
	if (!result.ok) {
		spin.stop(import_picocolors.default.red(result.message));
		if (result.log.trim()) log.error(result.log.trim());
		return false;
	}
	spin.stop(result.message);
	if (status().length > 0 && ask(await confirm({ message: "Re-apply your saved configuration with the new version (agents, skill, instructions)?" }))) {
		const code = reapplyWithNewVersion(result.root);
		if (code !== 0) log.warn(`Re-applying exited with code ${code}; run \`agent-config install\` to retry.`);
	}
	log.info("Start agent-config again to use the new version.");
	return true;
}
async function runTui() {
	intro(`${import_picocolors.default.bgCyan(import_picocolors.default.black(" agent-config "))} ${import_picocolors.default.dim(`v${VERSION}`)}`);
	log.message(import_picocolors.default.dim("Pick abilities from the catalog, such as the model ladder: route reads and edits to the cheapest capable model."));
	try {
		for (;;) {
			const saved = loadConfig().catalog.length > 0;
			const choice = ask(await select({
				message: "What do you want to do?",
				options: [
					{
						value: "catalog",
						label: "Catalog",
						hint: `install, configure or remove: ${CATALOG.map((i) => i.id).join(", ")}`
					},
					...saved ? [{
						value: "install",
						label: "Re-apply installed items",
						hint: "write the saved catalog items again, e.g. after an update"
					}] : [],
					{
						value: "status",
						label: "Status",
						hint: "what is installed and whether it changed"
					},
					{
						value: "doctor",
						label: "Doctor",
						hint: "check runtimes and prerequisites"
					},
					{
						value: "uninstall",
						label: "Uninstall",
						hint: "remove and restore"
					},
					{
						value: "self-update",
						label: "Update agent-config version",
						hint: `installed v${VERSION}; checks GitHub for a newer one`
					},
					{
						value: "reset",
						label: "Reset ladder choices",
						hint: "back to the recommended parts and models; keeps installed items"
					},
					{
						value: "exit",
						label: "Exit"
					}
				]
			}));
			if (choice === "exit") break;
			if (choice === "install") await reapplyFlow();
			if (choice === "catalog") await catalogFlow();
			if (choice === "status") statusFlow();
			if (choice === "doctor") doctorFlow();
			if (choice === "uninstall") await uninstallFlow();
			if (choice === "self-update" && await selfUpdateFlow()) break;
			if (choice === "reset") {
				saveConfig({
					...defaultConfig(),
					catalog: loadConfig().catalog
				});
				log.success("Ladder choices reset. Re-apply installed items to write them.");
			}
		}
	} catch (error) {
		if (error instanceof Cancelled) {
			cancel("Cancelled.");
			return 130;
		}
		throw error;
	}
	outro("Done.");
	return 0;
}
//#endregion
//#region src/delegate.ts
/** Set in every process `delegate` starts; its presence means "already delegated". */
const DELEGATED_ENV = "AGENT_CONFIG_DELEGATED";
/**
* A task that starts with "-" would be parsed as an option by runtimes that take the prompt
* as a bare positional argument, so give it a leading word.
*/
function safePrompt(prompt) {
	return prompt.trimStart().startsWith("-") ? `Task:\n${prompt}` : prompt;
}
function withVerify(prompt, verify) {
	return verify ? `${prompt}\n\nVerify command (the only shell command you may run): ${verify}` : prompt;
}
function invocation(req, tier, tiers, prompt, scratch) {
	const { runtime, role, cwd, verify } = req;
	const { model, effort } = tiers[tier];
	const name = agentName(role, tier);
	const task = safePrompt(withVerify(prompt, role === "edit" ? verify : void 0));
	switch (runtime) {
		case "claude": {
			const args = [
				"-p",
				"--agent",
				name,
				"--output-format",
				"json",
				"--allowedTools",
				...role === "read" ? [
					"Read",
					"Grep",
					"Glob"
				] : [
					"Read",
					"Edit",
					"Write",
					"Grep",
					"Glob",
					...verify ? [`Bash(${verify})`] : []
				]
			];
			if (role === "edit") args.push("--permission-mode", "acceptEdits");
			if (model) args.push("--model", model);
			return {
				bin: "claude",
				args: [
					...args,
					"--",
					task
				]
			};
		}
		case "opencode": {
			const args = [
				"run",
				"--agent",
				name
			];
			if (model) args.push("--model", model);
			return {
				bin: "opencode",
				args: [...args, task]
			};
		}
		case "codex": {
			const outFile = join(scratch, "last-message.txt");
			const args = [
				"exec",
				"--skip-git-repo-check",
				"--ephemeral",
				"-C",
				cwd,
				"-s",
				role === "read" ? "read-only" : "workspace-write",
				"-c",
				`model_reasoning_effort="${effort}"`,
				"-o",
				outFile
			];
			if (model) args.push("-m", model);
			return {
				bin: "codex",
				args: [...args, "-"],
				stdin: `${agentBody(role, tier)}\n\n${task}`,
				outFile
			};
		}
		case "pi": {
			const args = [
				"-p",
				"--no-session",
				"--tools",
				(role === "read" ? [
					"read",
					"grep",
					"find",
					"ls"
				] : [
					"read",
					"grep",
					"find",
					"ls",
					"edit",
					"write",
					...verify ? ["bash"] : []
				]).join(","),
				"--thinking",
				effort
			];
			if (model) args.push("--model", model);
			args.push("--append-system-prompt", agentBody(role, tier));
			return {
				bin: "pi",
				args: [...args, task]
			};
		}
	}
}
/**
* Runtimes that select the agent by name depend on its installed definition for tool limits.
* Returns why that definition cannot be trusted, or undefined when it is fine.
*/
function agentFileProblem(runtime, role, tier) {
	const name = agentName(role, tier);
	const file = runtime === "claude" ? join(claudeDir(), "agents", `${name}.md`) : runtime === "opencode" ? join(opencodeDir(), "agents", `${name}.md`) : void 0;
	if (!file) return void 0;
	const fix = `run \`agent-config install model-ladder --runtime ${runtime}\``;
	if (!existsSync(file)) return `${name} is not installed for ${runtime}; ${fix}`;
	if (runtime === "opencode" && role === "read") {
		const text = readFileSync(file, "utf8");
		if (!/^\s+edit:\s*deny\s*$/m.test(text) || !/^\s+bash:\s*deny\s*$/m.test(text)) return `${name} no longer denies edit and bash (changed since install); ${fix}`;
	}
}
function parseStatus(reply) {
	const m = /^\s*STATUS:\s*(done|partial|escalate)\b/im.exec(reply);
	return m ? m[1]?.toLowerCase() : "partial";
}
/** Claude's --output-format json wraps the reply; the others print it as is. */
function extractReply(runtime, stdout) {
	if (runtime !== "claude") return { reply: stdout.trim() };
	try {
		const data = JSON.parse(stdout);
		if (data.is_error) return {
			reply: data.result ?? "",
			error: data.subtype ?? "agent error"
		};
		return { reply: (data.result ?? "").trim() };
	} catch {
		return { reply: stdout.trim() };
	}
}
function failure(bin, res, timeoutMs) {
	const code = res.error?.code;
	if (code === "ENOENT") return `${bin} is not installed or not on PATH`;
	if (code === "ETIMEDOUT") return `timed out after ${Math.round(timeoutMs / 1e3)}s`;
	if (res.error) return res.error.message;
	if (res.signal) return `${bin} was killed by ${res.signal}`;
	const tail = String(res.stderr ?? "").trim().split("\n").slice(-3).join(" ");
	return `${bin} exited with ${res.status}${tail ? `: ${tail}` : ""}`;
}
function runOnce(req, tier, tiers, prompt, timeoutMs) {
	const started = Date.now();
	const model = tiers[tier].model || "session model";
	const problem = agentFileProblem(req.runtime, req.role, tier);
	if (problem) return {
		tier,
		model,
		status: "error",
		durationMs: 0,
		reply: "",
		error: problem
	};
	const scratch = mkdtempSync(join(tmpdir(), "agent-config-delegate-"));
	try {
		const inv = invocation(req, tier, tiers, prompt, scratch);
		const res = spawnSync(inv.bin, inv.args, {
			cwd: req.cwd,
			input: inv.stdin ?? "",
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: 67108864,
			env: {
				...process.env,
				[DELEGATED_ENV]: "1"
			}
		});
		const durationMs = Date.now() - started;
		if (res.error || res.status !== 0) return {
			tier,
			model,
			status: "error",
			durationMs,
			reply: "",
			error: failure(inv.bin, res, timeoutMs)
		};
		let stdout = res.stdout ?? "";
		if (inv.outFile) try {
			stdout = readFileSync(inv.outFile, "utf8");
		} catch {}
		const { reply, error } = extractReply(req.runtime, stdout);
		if (error) return {
			tier,
			model,
			status: "error",
			durationMs,
			reply,
			error
		};
		return {
			tier,
			model,
			status: parseStatus(reply),
			durationMs,
			reply
		};
	} finally {
		rmSync(scratch, {
			recursive: true,
			force: true
		});
	}
}
/** What an edit rung left in the working tree, so the next rung continues from it. */
function workingTreeChanges(cwd) {
	try {
		return execFileSync("git", [
			"-C",
			cwd,
			"diff",
			"--stat"
		], {
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			],
			timeout: 1e4
		}).trim().slice(0, 1500);
	} catch {
		return "";
	}
}
function escalationPrompt(req, previous) {
	const summary = previous.error ?? previous.reply.slice(0, 2e3);
	let text = `${req.prompt}\n\nPrevious attempt (${previous.tier} rung, STATUS: ${previous.status}):\n${summary}`;
	if (req.role === "edit") {
		const changes = workingTreeChanges(req.cwd);
		text += changes ? `\n\nThe previous attempt already changed these files; inspect them (git diff) and continue from their current state instead of starting over:\n${changes}` : "\n\nThe previous attempt may have changed files; check the working tree before editing.";
	}
	return text;
}
/** Runs the request, climbing one rung at a time while replies are not `done`. */
function delegate(req, tiers, hooks = {}) {
	const now = hooks.now ?? Date.now;
	const deadline = now() + req.maxTimeMs;
	const attempts = [];
	let prompt = req.prompt;
	for (const tier of TIERS.slice(TIERS.indexOf(req.tier))) {
		const remaining = deadline - now();
		if (remaining <= 0) break;
		hooks.onStart?.(tier, tiers[tier].model || "session model");
		const attempt = runOnce(req, tier, tiers, prompt, Math.min(req.timeoutMs, remaining));
		attempts.push(attempt);
		if (attempt.status === "done" || !req.climb) break;
		if (attempt.error && /not on PATH|not installed for|changed since install/.test(attempt.error)) break;
		prompt = escalationPrompt(req, attempt);
	}
	return attempts;
}
//#endregion
//#region src/cli.ts
/** One-letter spellings of the most used commands: `agi i`, `agi u`. */
const SHORT_COMMANDS = {
	i: "install",
	u: "self-update"
};
const HELP = `agent-config ${VERSION}
Configure Claude Code, OpenCode, Codex and Pi from a catalog of abilities, such as
the model ladder (route reads and edits to the cheapest capable model: fast → balanced
→ deep), Kaneo work tracking, title-only commits, the /continue ticket action and a
Claude Code status line.
Also installed as \`agi\` (short alias) and \`model-ladder\` (its name before 0.3.0).

Usage:
  agent-config                     open the TUI (in a terminal)
  agent-config install             re-apply the saved catalog items (\`agi i\` for short)
  agent-config install <item>      add a catalog item, e.g. \`agi install model-ladder\` or
                                   \`agi install kaneo\` (--project <dir> for one repository
                                   instead of your user config; not model-ladder)
  agent-config catalog             list catalog items and where they are installed
  agent-config status              list what agent-config installed and whether it changed
  agent-config uninstall [flags]   remove it and restore what it replaced
  agent-config uninstall <item>    remove only that catalog item (--project <dir> for its project copy)
  agent-config doctor              check runtimes and prerequisites
  agent-config config              print the saved configuration and its path
  agent-config self-update         update agent-config itself (--dry-run only checks);
                                   \`agent-config update\` and \`agi u\` are the same command
  agent-config delegate <read|edit> [--tier t] [--runtime r] "<task>"
                                   run a ladder read or edit headlessly and print only its reply;
                                   for agents that cannot spawn subagents ("-" reads the task from
                                   stdin; put a task that starts with - after --)

Flags:
  --runtime <id>                 claude | opencode | codex | pi (repeatable; default: saved, else detected)

Model ladder flags (\`install model-ladder\`; on a bare \`install\` they install the ladder too):
  --component <id>               ${COMPONENTS.join(" | ")} (repeatable; default: saved, else all)
  --model <runtime>:<tier>=<id>  model for a rung, e.g. claude:fast=claude-haiku-5-5 (repeatable)
  --effort <runtime>:<tier>=<l>  low | medium | high, e.g. codex:deep=high (repeatable)
  --review <lens>=<tier>         rung for a Gentle AI review agent, e.g. review-risk=deep (repeatable)
  --min-lines <n>                read guard threshold (default 350)

Other flags:
  --yes                          apply or uninstall without asking
  --dry-run                      show the plan, write nothing
  --project <dir>                catalog item: install into this repository instead of user scope
  --url <base-url>               kaneo: Kaneo base URL, e.g. https://kaneo.example.com (default:
                                 saved, else an existing kaneo MCP entry, else asked)
  --force                        uninstall files even if they changed since install
  --json                         print one JSON document to stdout
  -v, --version / -h, --help

Delegate flags:
  --tier <fast|balanced|deep>    first rung (default: fast)
  --no-climb                     do not climb to the next rung on partial/escalate/failure
  --cwd <dir>                    working directory for the agent (default: current)
  --timeout <seconds>            limit for one rung (default 600)
  --max-time <seconds>           limit for all rungs together (default 1200)
  --verify "<command>"           edit only: the one shell command the agent may run to check
                                 its change (without it, Claude and Pi edit agents get no shell)

Exit codes: 0 ok, 1 a step failed, 2 usage error or refusal,
3 uninstall kept files you edited (re-run with --force) / delegate ended partial or escalate,
4 delegate refused: already running inside a agent-config delegated agent, 130 cancelled.`;
var UsageError = class extends Error {};
const DELEGATE_ONLY = [
	"tier",
	"cwd",
	"no-climb",
	"timeout",
	"max-time",
	"verify"
];
const CATALOG_ONLY = ["project", "url"];
const LADDER_ONLY = [
	"component",
	"model",
	"effort",
	"review",
	"min-lines"
];
const NOT_FOR_DELEGATE = [
	...CATALOG_ONLY,
	"component",
	"model",
	"effort",
	"review",
	"min-lines",
	"yes",
	"dry-run",
	"force"
];
function parseAssign(raw, flag) {
	const m = /^([a-z-]+)(?::([a-z]+))?=(.*)$/.exec(raw);
	if (!m) throw new UsageError(`${flag} expects <name>[:<tier>]=<value>, got "${raw}"`);
	return {
		left: m[1] ?? "",
		tier: m[2] ?? "",
		value: m[3] ?? ""
	};
}
/** Applies the ladder flags (parts, models, review rungs, read guard) to the saved settings. */
function applyLadderFlags(config, values) {
	const list = (k) => values[k] ?? [];
	if (list("component").length > 0) {
		for (const c of list("component")) if (!COMPONENTS.includes(c)) throw new UsageError(`unknown component "${c}"`);
		config.components = list("component");
	}
	for (const raw of list("model")) {
		const { left, tier, value } = parseAssign(raw, "--model");
		if (!isRuntime(left) || !isTier(tier)) throw new UsageError(`--model expects <runtime>:<tier>=<id>, got "${raw}"`);
		config.tiers[left][tier].model = value.trim();
	}
	for (const raw of list("effort")) {
		const { left, tier, value } = parseAssign(raw, "--effort");
		if (!isRuntime(left) || !isTier(tier) || !EFFORTS.includes(value)) throw new UsageError(`--effort expects <runtime>:<tier>=low|medium|high, got "${raw}"`);
		config.tiers[left][tier].effort = value;
	}
	for (const raw of list("review")) {
		const { left, value } = parseAssign(raw, "--review");
		if (!isReviewLens(left) || !isTier(value)) throw new UsageError(`--review expects <review-lens>=<tier>, got "${raw}"`);
		config.reviewTiers[left] = value;
	}
	if (values["min-lines"] !== void 0) {
		const n = Number(values["min-lines"]);
		if (!Number.isInteger(n) || n <= 0) throw new UsageError("--min-lines expects a positive whole number");
		config.minLines = n;
	}
}
/** The runtime a delegating agent most likely runs in, else the first configured one. */
function delegateRuntime(configured) {
	const runtime = setting("RUNTIME");
	if (runtime) return runtime;
	if (process.env.CLAUDECODE) return "claude";
	return configured[0] ?? detectedRuntimes()[0];
}
function out(json, data, text) {
	process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);
}
/**
* The item and scope a command names. Uninstall also accepts a project directory that is gone,
* when agent-config still knows an entry or installed files for it.
*/
function catalogTarget(id, values, forUninstall = false) {
	const item = catalogItem(id);
	if (!item) throw new UsageError(`unknown catalog item "${id}"; available: ${CATALOG.map((i) => i.id).join(", ")}`);
	const raw = values.project;
	if (raw === void 0) return { item };
	if (item.userOnly) throw new UsageError(`${item.id} installs at user scope only; drop --project`);
	const project = resolve(raw);
	if (existsSync(project) && statSync(project).isDirectory()) return {
		item,
		project
	};
	const key = entryKey({
		item: item.id,
		project
	});
	const known = loadConfig().catalog.some((e) => entryKey(e) === key) || status().some((e) => e.record.item === key);
	if (forUninstall && known) return {
		item,
		project
	};
	throw new UsageError(`--project ${project} is not a directory`);
}
/** Resolves the entry `install <id>` names, applies the ladder flags to it, and saves it in `config`. */
async function saveEntryFor(id, config, values) {
	const { item, project } = catalogTarget(id, values);
	for (const flag of CATALOG_ONLY.filter((f) => f !== "project" && values[f] !== void 0)) if (!item.settings.some((s) => s.flag === flag)) throw new UsageError(`--${flag} does not apply to ${item.id}`);
	const entry = await catalogEntryFor(item, project, config, values);
	if (item.id === "model-ladder") applyLadderFlags(config, values);
	upsertEntry(config, entry);
	return entry;
}
/** The catalog entry to install: flags first, then what was saved, detected, or asked. */
async function catalogEntryFor(item, project, config, values) {
	const defaults = entryDefaults(item, project, config, detectedRuntimes);
	const flagged = values.runtime ?? [];
	for (const r of flagged) {
		if (!isRuntime(r)) throw new UsageError(`unknown runtime "${r}"`);
		if (item.runtimes && !item.runtimes.includes(r)) throw new UsageError(`${item.id} supports only ${item.runtimes.join(", ")}`);
	}
	const runtimes = flagged.length > 0 ? flagged : defaults.runtimes;
	if (runtimes.length === 0) throw new UsageError("no runtime detected; pass --runtime");
	const settings = {};
	for (const s of item.settings) {
		const raw = values[s.flag];
		const known = defaults.settings[s.key];
		let value;
		if (raw !== void 0) {
			const normalized = s.normalize(raw);
			if (!normalized) throw new UsageError(`--${s.flag} expects a value like ${s.placeholder}`);
			value = normalized;
		} else if (known) {
			value = known.value;
			if (known.source === "discovered" && project) process.stderr.write(`agent-config: using ${s.message.toLowerCase()} ${value} from your user config; it is written into ${project}. Pass --${s.flag} to choose another.\n`);
		} else {
			if (!process.stdin.isTTY || !process.stdout.isTTY) throw new UsageError(`${item.id} needs --${s.flag} <${s.placeholder}>`);
			const answer = await text({
				message: s.message,
				placeholder: s.placeholder,
				validate: (v) => s.normalize(v ?? "") ? void 0 : `Enter a value like ${s.placeholder}`
			});
			if (isCancel(answer)) throw new Cancelled();
			value = s.normalize(answer) ?? "";
		}
		const warning = s.warning?.(value);
		if (warning) process.stderr.write(`agent-config: warning: ${warning}\n`);
		settings[s.key] = value;
	}
	return {
		item: item.id,
		...project ? { project } : {},
		runtimes,
		settings
	};
}
/** Shows the plan, asks unless --yes, applies it and saves the configuration. */
async function applyAndReport(plan, config, values, json) {
	const changes = plan.filter((x) => x.action === "create" || x.action === "update" || x.action === "remove");
	const planJson = plan.map(({ op, action, reason }) => ({
		runtime: op.runtime,
		component: op.component,
		...op.item ? { item: op.item } : {},
		label: op.label,
		path: op.path,
		action,
		reason
	}));
	if (values["dry-run"] || changes.length === 0) {
		if (changes.length === 0 && !values["dry-run"]) saveConfig(config);
		out(json, {
			plan: planJson,
			applied: false
		}, `${formatPlan(plan)}\n\n${changes.length} change(s)${values["dry-run"] ? " (dry run)" : ""}.`);
		return 0;
	}
	if (!values.yes) {
		if (!process.stdin.isTTY) {
			process.stderr.write(`${formatPlan(plan)}\n\nerror: refusing to apply without --yes outside a terminal.\n`);
			return 2;
		}
		process.stdout.write(`${formatPlan(plan)}\n\n`);
		const ok = await confirm({ message: `Apply ${changes.length} change(s)?` });
		if (isCancel(ok) || !ok) return 130;
	}
	const result = applyPlan(plan);
	saveConfig(config);
	const failed = result.errors.map((e) => `${import_picocolors.default.red("failed")} ${e.op.label}: ${e.error}`).join("\n");
	out(json, {
		plan: planJson,
		applied: true,
		notes: result.notes,
		errors: result.errors.map((e) => ({
			label: e.op.label,
			path: e.op.path,
			error: e.error
		}))
	}, [
		formatPlan(plan),
		"",
		...result.notes.map((n) => `${import_picocolors.default.yellow("note")} ${n}`),
		failed || `${import_picocolors.default.green("Applied")} ${changes.length} change(s). Restart running agent sessions to load them.`
	].join("\n"));
	return result.errors.length > 0 ? 1 : 0;
}
async function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			runtime: {
				type: "string",
				multiple: true
			},
			component: {
				type: "string",
				multiple: true
			},
			model: {
				type: "string",
				multiple: true
			},
			effort: {
				type: "string",
				multiple: true
			},
			review: {
				type: "string",
				multiple: true
			},
			"min-lines": { type: "string" },
			project: { type: "string" },
			url: { type: "string" },
			tier: { type: "string" },
			cwd: { type: "string" },
			"no-climb": { type: "boolean" },
			timeout: { type: "string" },
			"max-time": { type: "string" },
			verify: { type: "string" },
			yes: {
				type: "boolean",
				short: "y"
			},
			"dry-run": { type: "boolean" },
			force: { type: "boolean" },
			json: { type: "boolean" },
			version: {
				type: "boolean",
				short: "v"
			},
			help: {
				type: "boolean",
				short: "h"
			}
		}
	});
	const json = values.json === true;
	if (values.version) return out(json, { version: VERSION }, VERSION), 0;
	if (values.help) return out(false, null, HELP), 0;
	const command = SHORT_COMMANDS[positionals[0] ?? ""] ?? positionals[0] ?? "";
	const migration = migrateLegacyLayout();
	ensureAgiAlias();
	for (const dir of migration.moved) process.stderr.write(`agent-config: moved ${dir} to its agent-config location (renamed from model-ladder)\n`);
	for (const warning of migration.warnings) process.stderr.write(`agent-config: warning: ${warning}; continuing with the current layout\n`);
	const given = Object.keys(values).filter((k) => values[k] !== void 0);
	const misplaced = command === "delegate" ? given.find((k) => NOT_FOR_DELEGATE.includes(k)) : given.find((k) => DELEGATE_ONLY.includes(k));
	if (misplaced) throw new UsageError(command === "delegate" ? `--${misplaced} does not apply to delegate` : `--${misplaced} only applies to delegate`);
	const itemId = [
		"install",
		"apply",
		"uninstall"
	].includes(command) ? positionals[1] : void 0;
	const catalogFlag = given.find((k) => CATALOG_ONLY.includes(k));
	if (catalogFlag && (!itemId || catalogFlag === "url" && command === "uninstall")) throw new UsageError(`--${catalogFlag} only applies to ${catalogFlag === "url" ? "install (or apply)" : "install or uninstall"} <item>`);
	const ladderFlag = given.find((k) => LADDER_ONLY.includes(k));
	if (ladderFlag && itemId && (itemId !== "model-ladder" || command === "uninstall")) throw new UsageError(`--${ladderFlag} configures the model ladder; run \`agent-config install ${LADDER_ITEM}\``);
	switch (command) {
		case "":
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				process.stderr.write(`${HELP}\n\nerror: no terminal for the TUI; pass a command.\n`);
				return 2;
			}
			return runTui();
		case "install":
		case "apply": {
			const config = loadConfig();
			if (itemId) return applyAndReport(buildPlan(config, [entryKey(await saveEntryFor(itemId, config, values))]), config, values, json);
			if (ladderFlag !== void 0 || values.runtime !== void 0) await saveEntryFor(LADDER_ITEM, config, values);
			if (config.catalog.length === 0) throw new UsageError(`nothing to install yet; add a catalog item, e.g. \`agent-config install ${LADDER_ITEM}\` (see \`agent-config catalog\`)`);
			for (const w of missingProjectWarnings(config)) process.stderr.write(`agent-config: warning: ${w}\n`);
			return applyAndReport(buildPlan(config), config, values, json);
		}
		case "catalog": {
			const config = loadConfig();
			const records = status();
			const items = CATALOG.map((item) => ({
				id: item.id,
				title: item.title,
				description: item.description,
				entries: config.catalog.filter((e) => e.item === item.id).map((e) => ({
					...e,
					scope: e.project ? "project" : "user",
					files: records.filter((r) => r.record.item === entryKey(e)).length
				}))
			}));
			const width = Math.max(...CATALOG.map((i) => i.id.length));
			const indent = " ".repeat(width + 1);
			const text = items.map((i) => [
				`${import_picocolors.default.bold(i.id.padEnd(width))} ${i.title}`,
				`${indent}${i.description}`,
				`${indent}installed: ${i.entries.length === 0 ? "no" : i.entries.map((e) => `${scopeLabel(e)} (${e.runtimes.join(", ")})`).join("; ")}`,
				`${indent}install: agent-config install ${i.id}${catalogItem(i.id)?.userOnly ? "" : " [--project <dir>]"}`
			].join("\n")).join("\n\n");
			out(json, { items }, text);
			return 0;
		}
		case "status": {
			const entries = status();
			const text = entries.length === 0 ? "Nothing installed." : entries.map((e) => `${e.state.padEnd(8)} ${e.record.runtime.padEnd(9)} ${e.record.label}  ${tildify(e.record.path)}`).join("\n");
			out(json, { entries: entries.map((e) => ({
				...e.record,
				state: e.state
			})) }, text);
			return 0;
		}
		case "uninstall": {
			const runtimes = values.runtime ?? [];
			for (const r of runtimes) if (!isRuntime(r)) throw new UsageError(`unknown runtime "${r}"`);
			const key = itemId ? (() => {
				const { item, project } = catalogTarget(itemId, values, true);
				return entryKey({
					item: item.id,
					project
				});
			})() : void 0;
			const match = (r) => (key === void 0 || r.item === key) && (runtimes.length === 0 || runtimes.includes(r.runtime));
			const entries = status().filter((e) => match(e.record));
			if (entries.length === 0 && key && !values["dry-run"]) uninstallSelection({
				key,
				runtimes
			});
			if (entries.length === 0) return out(json, { results: [] }, "Nothing to uninstall."), 0;
			if (values["dry-run"]) {
				out(json, { entries: entries.map((e) => e.record) }, entries.map((e) => `remove  ${e.record.label}  ${tildify(e.record.path)}`).join("\n"));
				return 0;
			}
			if (!values.yes) {
				if (!process.stdin.isTTY) {
					process.stderr.write("error: refusing to uninstall without --yes outside a terminal.\n");
					return 2;
				}
				const ok = await confirm({ message: `Undo ${entries.length} change(s)?` });
				if (isCancel(ok) || !ok) return 130;
			}
			const { results, restoreErrors } = uninstallSelection({
				...key ? { key } : {},
				runtimes
			}, values.force === true);
			out(json, { results: results.map((r) => ({
				path: r.record.path,
				label: r.record.label,
				outcome: r.outcome,
				note: r.note
			})) }, results.map((r) => `${r.outcome.padEnd(13)} ${r.record.label}  ${tildify(r.record.path)}${r.note ? `  (${r.note})` : ""}`).join("\n"));
			for (const e of restoreErrors) process.stderr.write(`error: could not restore ${e.op.label} (${e.op.path}): ${e.error}\n`);
			if (restoreErrors.length > 0) return 1;
			return results.some((r) => r.outcome === "kept-modified") ? 3 : 0;
		}
		case "doctor": {
			const checks = doctor();
			out(json, { checks }, checks.map((c) => `${c.ok ? "ok  " : "warn"} ${c.name.padEnd(18)} ${c.detail}`).join("\n"));
			return 0;
		}
		case "delegate": {
			if (process.env["AGENT_CONFIG_DELEGATED"] || process.env["MODEL_LADDER_DELEGATED"]) {
				process.stderr.write("error: agent-config delegate cannot run inside an agent it started (no nested delegation).\n  fix: answer with what you have, or reply STATUS: escalate so the caller climbs a rung.\n");
				return 4;
			}
			const role = positionals[1];
			if (role !== "read" && role !== "edit") throw new UsageError("delegate expects read or edit");
			const tier = values.tier ?? "fast";
			if (!isTier(tier)) throw new UsageError(`unknown tier "${tier}"`);
			const verify = values.verify?.trim();
			if (verify !== void 0 && role !== "edit") throw new UsageError("--verify only applies to delegate edit");
			if (verify !== void 0 && (!verify || /[\r\n]/.test(verify))) throw new UsageError("--verify expects one single-line command");
			const config = loadConfig();
			const runtime = values.runtime?.at(-1) ?? delegateRuntime(ladderRuntimes(config));
			if (!runtime || !isRuntime(runtime)) throw new UsageError(runtime ? `unknown runtime "${runtime}"` : "no runtime found; pass --runtime");
			const cwd = resolve(values.cwd ?? process.cwd());
			if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new UsageError(`--cwd ${cwd} is not a directory`);
			let prompt = positionals.slice(2).join(" ").trim();
			if (prompt === "-") prompt = readFileSync(0, "utf8").trim();
			if (!prompt) throw new UsageError("delegate needs a task: pass it as an argument, or \"-\" to read stdin");
			const seconds = (flag, fallback) => {
				const raw = values[flag];
				const n = raw === void 0 ? fallback : Number(raw);
				if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${flag} expects seconds`);
				return n;
			};
			const timeout = seconds("timeout", 600);
			const maxTime = seconds("max-time", 1200);
			const attempts = delegate({
				role,
				tier,
				runtime,
				prompt,
				cwd,
				climb: values["no-climb"] !== true,
				timeoutMs: timeout * 1e3,
				maxTimeMs: maxTime * 1e3,
				...verify ? { verify } : {}
			}, config.tiers[runtime], { onStart: (t, model) => process.stderr.write(`agent-config: ${role} ${t} (${model}) running…\n`) });
			const last = attempts.at(-1);
			for (const a of attempts) process.stderr.write(`agent-config: ${role} ${a.tier} (${a.model}) → ${a.status} in ${(a.durationMs / 1e3).toFixed(1)}s${a.error ? `: ${a.error}` : ""}\n`);
			out(json, {
				runtime,
				role,
				status: last?.status,
				reply: last?.reply ?? "",
				attempts: attempts.map(({ reply: _reply, ...a }) => a)
			}, last?.reply ?? "");
			if (!last || last.status === "error") return 1;
			return last.status === "done" ? 0 : 3;
		}
		case "update":
		case "self-update": {
			const check = checkForUpdate();
			const summary = !check.updatable ? `cannot update: ${check.reason}` : (check.behind === 0 || !check.latest) && !check.relocate ? `up to date: v${check.current.version} (${check.current.commit})` : check.behind === 0 ? `up to date, but still in the pre-rename location ${legacyInstallHome()}: updating moves it to ${defaultInstallHome()}` : `update available: v${check.current.version} (${check.current.commit}) -> v${check.latest?.version} (${check.latest?.commit}), ${check.behind} commit(s)`;
			if (!check.updatable) return out(json, {
				check,
				updated: false
			}, summary), 1;
			if (check.behind === 0 && !check.relocate || values["dry-run"]) return out(json, {
				check,
				updated: false
			}, summary), 0;
			if (!values.yes) {
				if (!process.stdin.isTTY) {
					process.stderr.write(`${summary}\nerror: refusing to update without --yes outside a terminal.\n`);
					return 2;
				}
				const ok = await confirm({ message: `${summary}. Update now?` });
				if (isCancel(ok) || !ok) return 130;
			}
			const result = runUpdate(check);
			if (!result.ok) process.stderr.write(result.log);
			out(json, {
				check,
				updated: result.ok,
				commit: result.commit,
				message: result.message
			}, result.ok ? `${result.message}. Run \`agent-config install\` to re-apply your configuration with it.` : result.message);
			return result.ok ? 0 : 1;
		}
		case "config": {
			const config = loadConfig();
			out(json, {
				path: configPath(),
				config
			}, `${configPath()}\n${JSON.stringify(config, null, 2)}`);
			return 0;
		}
		default: throw new UsageError(`unknown command "${command}"`);
	}
}
main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
	if (error instanceof Cancelled) process.exit(130);
	if (error instanceof UsageError || error?.code?.startsWith("ERR_PARSE_ARGS")) {
		const hint = error?.code?.startsWith("ERR_PARSE_ARGS") ? "A task that starts with - goes after --, e.g. agent-config delegate read -- \"- item\".\n" : "";
		process.stderr.write(`error: ${error.message}\n${hint}Run agent-config --help for usage.\n`);
		process.exit(2);
	}
	process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
//#endregion
export {};
