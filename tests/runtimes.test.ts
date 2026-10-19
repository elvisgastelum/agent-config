import { expect, test } from "vite-plus/test";
import { tomlMultiline } from "../src/runtimes.ts";

test("escapes backslashes, quote runs and control characters in TOML strings", () => {
  expect(tomlMultiline('a\\b """ c\r\u0001\td')).toBe('"""\na\\\\b ""\\" c\\r\\u0001\td"""');
});
