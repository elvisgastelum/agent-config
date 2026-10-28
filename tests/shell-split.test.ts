import { describe, expect, test } from "vite-plus/test";
// @ts-expect-error plain .mjs asset without type declarations
import { commandName, parse } from "../assets/shell-split.mjs";

const HOME_VARIABLE = "SHELL_SPLIT_TEST_HOME";
const UNSET_VARIABLE = "SHELL_SPLIT_TEST_UNSET";
const HOME_VALUE = "/test/home";
const HEREDOC_CAT = "cat <<EOF\n a | b\nEOF\necho x";
const HEREDOC_TABS = "cat <<-EOF\n\tx | y\n\tEOF\necho z";

interface Word {
  text: string;
  output: boolean;
  input: boolean;
}

const splitLine = (command: string) => parse(command) as Word[][][];

/** The words of each command of each pipeline, as text only. */
const texts = (command: string) =>
  splitLine(command).map((pipeline) => pipeline.map((words) => words.map((w) => w.text)));

describe("shell split", () => {
  test("splits pipelines on pipes and on list operators", () => {
    expect(texts("a | b")).toEqual([[["a"], ["b"]]]);
    expect(texts("a |& b")).toEqual([[["a"], ["b"]]]);
    expect(texts("a && b")).toEqual([[["a"]], [["b"]]]);
    expect(texts("a || b")).toEqual([[["a"]], [["b"]]]);
    expect(texts("a; b")).toEqual([[["a"]], [["b"]]]);
    expect(texts("a & b")).toEqual([[["a"]], [["b"]]]);
    expect(texts("a\nb")).toEqual([[["a"]], [["b"]]]);
  });

  test("keeps the pipes of one pipeline together", () => {
    expect(texts("a | b |& c")).toEqual([[["a"], ["b"], ["c"]]]);
  });

  test("reads a subshell's commands as their own pipelines", () => {
    expect(texts("(a; b)")).toEqual([[["a"]], [["b"]]]);
  });

  test("keeps operators inside quotes and removes the quotes", () => {
    expect(texts(`echo "a | b" 'c && d' e`)).toEqual([[["echo", "a | b", "c && d", "e"]]]);
  });

  test("resolves escapes", () => {
    expect(texts("echo e\\ f a\\|b")).toEqual([[["echo", "e f", "a|b"]]]);
  });

  test("expands variables, with defaults for unset ones", () => {
    process.env[HOME_VARIABLE] = HOME_VALUE;
    delete process.env[UNSET_VARIABLE];
    try {
      expect(
        texts(`echo $${HOME_VARIABLE} \${${HOME_VARIABLE}} \${${UNSET_VARIABLE}:-fallback}`),
      ).toEqual([[["echo", HOME_VALUE, HOME_VALUE, "fallback"]]]);
    } finally {
      delete process.env[HOME_VARIABLE];
    }
  });

  test("marks output and input redirect targets", () => {
    expect(splitLine("cmd > out 2> err &> both < in")).toEqual([
      [
        [
          { text: "cmd", output: false, input: false },
          { text: "out", output: true, input: false },
          { text: "err", output: true, input: false },
          { text: "both", output: true, input: false },
          { text: "in", output: false, input: true },
        ],
      ],
    ]);
  });

  test("does not produce a word for a descriptor duplicate", () => {
    expect(texts("cmd 2>&1 | tee log")).toEqual([[["cmd"], ["tee", "log"]]]);
  });

  test("reads a heredoc body as input, not as code", () => {
    expect(texts(HEREDOC_CAT)).toEqual([[["cat"]], [["echo", "x"]]]);
  });

  test("reads a <<- heredoc body with leading tabs as input, not as code", () => {
    expect(texts(HEREDOC_TABS)).toEqual([[["cat"]], [["echo", "z"]]]);
  });

  test("names a command without its directory, wrappers, or assignments", () => {
    const nameOf = (command: string) => commandName(splitLine(command)[0][0]);
    expect(nameOf("FOO=1 bar --x")).toBe("bar");
    expect(nameOf("env X=1 tee")).toBe("tee");
    expect(nameOf("command ls -la")).toBe("ls");
    expect(nameOf("sudo -n tee -a log")).toBe("tee");
    expect(nameOf("/usr/bin/tee log")).toBe("tee");
  });
});
