/**
 * Splits shell command lines the way the shell does; shared by the guard hooks. Node built-ins only:
 * guardHookOps in src/catalog.ts inlines this file into each installed hook, so keep its imports
 * `import { ... } from "node:...";` statements on one line each.
 */

import { basename } from "node:path";

/** `NAME=value` before a command sets its environment; it is not the command's name. */
export const ASSIGNMENT = /^\w+=/;
/** Commands that run the command after them (with their own options first). */
export const WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
export const OPTION_PREFIX = "-";

// Shell syntax the command reader resolves.
export const SINGLE_QUOTE = "'";
export const DOUBLE_QUOTE = '"';
export const ESCAPE = "\\";
export const VARIABLE_SIGIL = "$";
/** `$NAME`, `${NAME}`, or `${NAME:-default}` (the default when NAME is unset or empty). */
export const SHELL_VARIABLE = /^\$(?:\{(\w+)(?::?-([^}]*))?\}|(\w+))/;
export const NEWLINE = "\n";
/** Operators that end a pipeline (`&&` and `||` before `&` and `|`, which they start with). */
export const LIST_OPERATORS = ["&&", "||", ";", "&", NEWLINE];
/** `<<EOF` or `<<-EOF` (not the `<<<` here-string): the next lines up to `EOF` are input, not code. */
export const HEREDOC = /^<<(?!<)-?/;
/** `<<-` lets the closing delimiter line start with tabs. */
export const LEADING_TABS = /^\t+/;
/** Joins the commands of one pipeline. */
export const PIPE = "|";
/** `|&` pipes stdout and stderr; its `&` belongs to the pipe, not a background job. */
export const PIPE_WITH_ERRORS = "|&";
export const OUTPUT_REDIRECT = ">";
export const INPUT_REDIRECT = "<";
/** `&>file`: stdout and stderr to a file; this `&` is a redirect, not a background job. */
export const ALL_OUTPUT_REDIRECT = "&>";
/** Digits written right before a redirect (`2>`) name the descriptor it redirects, not a word. */
export const DESCRIPTOR = /^\d+$/;
/** `>&2`, `2>&1`: after a redirect, `&` plus a descriptor duplicates it; `>&file` still names a file. */
export const DESCRIPTOR_DUPLICATE = /^&([\d-]+)?/;
/** Characters that end a word without other meaning here: whitespace and subshell parentheses. */
export const WORD_BREAK = /[\s()]/;

/**
 * Splits a command line the way the shell does: pipelines of commands of words, with quotes
 * removed, escapes and variables resolved, and each output redirect's target marked.
 */
export function parse(command) {
  const pipelines = [[[]]];
  const heredocs = [];
  let word = "";
  let quote = "";
  let redirect = "";
  let delimiterNext = false;
  const end = () => {
    if (!word) return;
    if (delimiterNext) heredocs.push(word);
    else
      pipelines
        .at(-1)
        .at(-1)
        .push({
          text: word,
          output: redirect === OUTPUT_REDIRECT,
          input: redirect === INPUT_REDIRECT,
        });
    delimiterNext = false;
    redirect = "";
    word = "";
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const expands = quote !== SINGLE_QUOTE;
    const variable = expands && c === VARIABLE_SIGIL ? SHELL_VARIABLE.exec(command.slice(i)) : null;
    const heredoc = !quote && c === INPUT_REDIRECT ? HEREDOC.exec(command.slice(i)) : null;
    const allOutput = !quote && command.startsWith(ALL_OUTPUT_REDIRECT, i);
    const list =
      quote || allOutput ? undefined : LIST_OPERATORS.find((op) => command.startsWith(op, i));
    if (variable) {
      const [, braced, fallback, bare] = variable;
      word += process.env[braced ?? bare] || (fallback ?? "");
      i += variable[0].length - 1;
    } else if (expands && c === ESCAPE && i + 1 < command.length) {
      word += command[++i];
    } else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === SINGLE_QUOTE || c === DOUBLE_QUOTE) {
      quote = c;
    } else if (allOutput) {
      end();
    } else if (heredoc) {
      end();
      delimiterNext = true;
      i += heredoc[0].length - 1;
    } else if (list) {
      end();
      pipelines.push([[]]);
      i += list.length - 1;
      if (list === NEWLINE) i = afterHeredocs(command, i + 1, heredocs.splice(0)) - 1;
    } else if (c === PIPE) {
      end();
      pipelines.at(-1).push([]);
      if (command.startsWith(PIPE_WITH_ERRORS, i)) i += PIPE_WITH_ERRORS.length - 1;
    } else if (c === OUTPUT_REDIRECT || c === INPUT_REDIRECT) {
      if (DESCRIPTOR.test(word)) word = "";
      end();
      const duplicate = DESCRIPTOR_DUPLICATE.exec(command.slice(i + 1));
      i += duplicate?.[0].length ?? 0;
      redirect = duplicate?.[1] ? "" : c;
    } else if (WORD_BREAK.test(c)) {
      end();
    } else {
      word += c;
    }
  }
  end();
  return pipelines;
}

/** Where the heredoc bodies starting at `from` end: each runs through a line holding its delimiter. */
export function afterHeredocs(command, from, delimiters) {
  let at = from;
  for (const delimiter of delimiters) {
    while (at < command.length) {
      const next = command.indexOf(NEWLINE, at);
      const lineEnd = next === -1 ? command.length : next;
      const line = command.slice(at, lineEnd).replace(LEADING_TABS, "");
      at = lineEnd + 1;
      if (line === delimiter) break;
    }
  }
  return Math.min(at, command.length);
}

/**
 * A command's name, without its directory: its first word that is not an environment assignment,
 * a wrapper such as `env` or `sudo`, or a wrapper's option.
 */
export function commandName(words) {
  let wrapped = false;
  for (const { text } of words) {
    const name = basename(text);
    if (ASSIGNMENT.test(text)) continue;
    if (WRAPPERS.has(name)) wrapped = true;
    else if (!(wrapped && text.startsWith(OPTION_PREFIX))) return name;
  }
  return "";
}
