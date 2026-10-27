import { describe, expect, test } from "vite-plus/test";
import { PYTHON_FALLBACK, STORE_MIGRATION, STORE_WRITE_PREFIX } from "../src/planning.ts";
import { MONTH_ORDER_EXAMPLE, STORE_GLOB, storeAccess } from "../src/store.ts";

const text = storeAccess("the scribe");

describe("storeAccess", () => {
  test("discovers written stores at the main checkout's absolute path", () => {
    expect(STORE_GLOB).toBe(".plans/*/*/plan.sqlite");
    expect(text).toContain(`\`${STORE_GLOB}\``);
    expect(text).toContain("Resolve the main checkout's root to an absolute path");
    expect(text).toContain("`status = 'written'`");
  });

  test("orders month folders by year then month, newest first, never as plain text", () => {
    expect(MONTH_ORDER_EXAMPLE).toBe("01-2027, 10-2026, 02-2026");
    expect(text).toContain(
      "order the `MM-yyyy` folders by year, then by month, newest first, never as plain text (01-2027, 10-2026, 02-2026)",
    );
  });

  test("takes one match silently and asks among several", () => {
    expect(text).toContain("One match is taken silently. Several matches ask the user which plan");
  });

  test("starts every write with the shared prefix and explains its echo", () => {
    expect(text).toContain(`Start every write with \`${STORE_WRITE_PREFIX}\``);
    expect(text).toContain(
      "a leading `5000` line from a write is the busy_timeout prefix echoing, not an error",
    );
    expect(text).not.toContain(".timeout");
  });

  test("migrates before the first write, including the update at pick", () => {
    expect(text).toContain(
      "Before the first write to a store, including the status update right after reading the ticket at pick",
    );
    expect(text).toContain(STORE_MIGRATION.check);
    expect(text).toContain(STORE_MIGRATION.addPrUrl);
    expect(text).toContain("CREATE TABLE IF NOT EXISTS ticket_sessions");
  });

  test("falls back to python3 -m sqlite3, never two statements on one line", () => {
    expect(text).toContain(PYTHON_FALLBACK);
    expect(text).toContain(
      "`python3 -m sqlite3 <store>` on stdin, never two statements on one line",
    );
  });

  test("falls back from Kaneo only on an explicit no-such-identifier after whoami", () => {
    expect(text).toContain(
      "Kaneo answers explicitly that no such identifier exists after `whoami` succeeded",
    );
    expect(text).toContain("Any other Kaneo error");
    expect(text).toContain("stops the run: report it, never fall back");
    expect(text).toContain("When the ID resolves in Kaneo, Kaneo wins");
    expect(text).toContain("`plan.tracker` is `kaneo`");
    expect(text).toContain("through their `tracker_id`");
    expect(text).toContain("the scribe");
  });

  test("names the session id rule and the writer that owns its session row", () => {
    expect(text).toContain(
      "the runtime's session id when the runtime exposes one, otherwise a UUID generated at the start of the run and kept for the whole run",
    );
    expect(text).toContain(
      "The session or orchestrator working a ticket writes the store itself, at the absolute path it was given, and owns its `ticket_sessions` row",
    );
    expect(text).toContain("Ended sessions never count as active");
  });
});
