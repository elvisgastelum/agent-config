// Serves /planning plan stores as a read-only web page, for a reviewer on the same network.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, relative } from "node:path";
import {
  MissingPathError,
  findStores,
  readPlan,
  type PlanDetail,
  type PlanTicket,
} from "./plans.ts";

export type PlanServer = {
  port: number;
  urls: { local: string; network: string[] };
  close(): Promise<void>;
};

const TOKEN_BYTES = 18;
const PLAN_ID_LENGTH = 16;
const ALLOWED_METHODS = "GET, HEAD";
const PLAN_ROUTE = /^\/plan\/([^/]+)$/;
const STATUS_CLASS_UNSAFE = /[^a-z_]/g;
const HTML = "text/html; charset=utf-8";
const PLAIN = "text/plain; charset=utf-8";
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const planId = (storePath: string): string =>
  createHash("sha256").update(storePath).digest("base64url").slice(0, PLAN_ID_LENGTH);

const shown = (path: string): string => relative(process.cwd(), path) || ".";

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1c2026;--muted:#5d6672;--line:#dde1e6;--todo:#6b7280;--progress:#b45309;--done:#15803d;--open:#b91c1c;--link:#1d4ed8}
@media(prefers-color-scheme:dark){:root{--bg:#111418;--card:#1b2026;--fg:#e6e9ed;--muted:#9aa4b0;--line:#2d343c;--todo:#9ca3af;--progress:#fbbf24;--done:#4ade80;--open:#f87171;--link:#7aa7ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:56rem;margin:0 auto;padding:1rem}
a{color:var(--link)}
h1{font-size:1.5rem;margin:.5rem 0}h2{font-size:1.1rem;margin:0}h3{font-size:1rem;margin:.75rem 0 .25rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.75rem 1rem;margin:.75rem 0}
.meta{color:var(--muted);font-size:.9rem;overflow-wrap:anywhere}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:.25rem 0}
.label{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.badge{display:inline-block;padding:0 .5rem;border-radius:1rem;border:1px solid currentColor;font-size:.8rem}
.s-todo,.s-interview,.s-store,.s-resolved,.s-dismissed{color:var(--todo)}
.s-in_progress,.s-review,.s-ticketed{color:var(--progress)}
.s-done,.s-written{color:var(--done)}
.s-open{color:var(--open)}
progress{width:100%;height:.8rem}
details{margin:1rem 0}summary{cursor:pointer;font-weight:600}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

const badge = (status: string): string =>
  `<span class="badge s-${escapeHtml(status.replace(STATUS_CLASS_UNSAFE, ""))}">${escapeHtml(status)}</span>`;

const field = (label: string, value: string | null | undefined): string =>
  value
    ? `<div class="label">${escapeHtml(label)}</div><div class="text">${escapeHtml(value)}</div>`
    : "";

const section = (title: string, count: number, body: string): string =>
  `<details open><summary>${escapeHtml(title)} (${count})</summary>${body}</details>`;

const progressText = (p: PlanDetail["progress"]): string =>
  `${p.done}/${p.total} done, ${p.inProgress} in progress`;

const progressBar = (p: PlanDetail["progress"]): string =>
  `<progress max="${p.total}" value="${p.done}"></progress> <span class="meta">${escapeHtml(progressText(p))}</span>`;

function titleOf(detail: PlanDetail): string {
  return detail.plan?.title ?? basename(dirname(detail.path));
}

function indexPage(
  roots: string[],
  cards: (PlanDetail | { path: string; error: string })[],
): string {
  const rootText = roots.map(shown).join(", ");
  const body = cards.length
    ? cards
        .map((card) => {
          const id = planId(card.path);
          if ("error" in card) {
            return `<div class="card"><h2>${escapeHtml(shown(card.path))}</h2><div class="text">${escapeHtml(card.error)}</div></div>`;
          }
          const open = card.findings.filter((f) => f.status === "open").length;
          return `<div class="card"><h2><a href="plan/${id}">${escapeHtml(titleOf(card))}</a></h2>
<div>${card.plan ? `${escapeHtml(card.plan.kind)} ${badge(card.plan.status)} <span class="meta">tracker ${escapeHtml(card.plan.tracker)}, created ${escapeHtml(card.plan.createdAt)}</span>` : ""}</div>
<div>${progressBar(card.progress)}</div>
<div class="meta">${open} open findings</div>
<div class="meta">${escapeHtml(shown(card.path))}</div></div>`;
        })
        .join("")
    : `<div class="card">No plan stores found yet in ${escapeHtml(rootText)}. Ask your agent to run /planning, then reload this page.</div>`;
  return page(
    "Plans",
    `<h1>Plans</h1><div class="meta">Searched: ${escapeHtml(rootText)}</div>${body}`,
  );
}

const ticketAnchor = (id: string): string => escapeHtml(`ticket-${id}`);

function ticketCard(t: PlanTicket, anchored: boolean): string {
  const blockers = t.blockedBy
    .map((id) => `<a href="#${ticketAnchor(id)}">${escapeHtml(id)}</a>`)
    .join(", ");
  return `<div class="card"${anchored ? ` id="${ticketAnchor(t.id)}"` : ""}>
<h3>${escapeHtml(t.id)} ${escapeHtml(t.title)} ${badge(t.status)}</h3>
<div class="meta">${escapeHtml(t.kind)}, size ${escapeHtml(t.size)}, wave ${t.wave ?? "none"}${t.trackerId ? `, tracker ${escapeHtml(t.trackerId)}` : ""}</div>
${field("Outcome", t.outcome)}${field("Done when", t.doneWhen)}${field("Touches", t.touches)}
${blockers ? `<div class="label">Blocked by</div><div>${blockers}</div>` : ""}</div>`;
}

function planPage(d: PlanDetail): string {
  const byId = new Map(d.tickets.map((t) => [t.id, t]));
  const open = d.tickets.filter((t) => t.status !== "done");
  const waves = [...new Set(open.map((t) => t.wave).filter((w): w is number => w !== null))].sort(
    (a, b) => a - b,
  );
  const stuck = open.filter((t) => t.wave === null);
  const waveHtml =
    waves
      .map(
        (w) =>
          `<h3>Wave ${w}</h3>${open
            .filter((t) => t.wave === w)
            .map((t) => ticketCard(t, false))
            .join("")}`,
      )
      .join("") +
    (stuck.length
      ? `<h3>Stuck</h3><div class="meta">In or behind a dependency cycle.</div>${stuck.map((t) => ticketCard(t, false)).join("")}`
      : "");
  const epicIds = new Set(d.epics.map((e) => e.id));
  const loose = d.tickets.filter((t) => t.epicId === null || !epicIds.has(t.epicId));
  const epicHtml =
    d.epics
      .map(
        (e) =>
          `<div class="card"><h3>${escapeHtml(e.id)} ${escapeHtml(e.title)}${e.trackerId ? ` <span class="meta">tracker ${escapeHtml(e.trackerId)}</span>` : ""}</h3>${field("Goal", e.goal)}${field("Done when", e.doneWhen)}${d.tickets
            .filter((t) => t.epicId === e.id)
            .map((t) => ticketCard(t, true))
            .join("")}</div>`,
      )
      .join("") +
    (loose.length ? `<h3>No epic</h3>${loose.map((t) => ticketCard(t, true)).join("")}` : "");
  const findings = [...d.findings].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open") || a.id - b.id,
  );
  const findingHtml = findings
    .map(
      (f) =>
        `<div class="card"><h3>${escapeHtml(f.kind)} <span class="meta">${escapeHtml(f.lens)}</span> ${badge(f.status)}</h3>${field("Detail", f.detail)}${field("Why", f.why)}${field("Recommendation", f.recommendation)}${field("Resolution", f.resolution)}${f.ticketId && byId.has(f.ticketId) ? `<div><a href="#${ticketAnchor(f.ticketId)}">${escapeHtml(f.ticketId)}</a></div>` : ""}</div>`,
    )
    .join("");
  const decisionHtml = d.decisions
    .map(
      (x) =>
        `<div class="card"><h3>${escapeHtml(x.topic)}</h3>${field("Question", x.question)}${field("Answer", x.answer)}${field("Why", x.why)}<div class="meta">decided by ${escapeHtml(x.decidedBy)}</div></div>`,
    )
    .join("");
  const factHtml = d.facts
    .map(
      (x) =>
        `<div class="card"><h3>${escapeHtml(x.topic)}</h3>${field("Fact", x.fact)}${field("Source", x.source)}</div>`,
    )
    .join("");
  const p = d.plan;
  const head = `<p><a href="../">All plans</a></p><h1>${escapeHtml(titleOf(d))}</h1>
<div class="meta">${p ? `${escapeHtml(p.kind)} ${badge(p.status)} tracker ${escapeHtml(p.tracker)}, created ${escapeHtml(p.createdAt)}, ` : ""}schema v${d.version}</div>
<div class="meta">${escapeHtml(shown(d.path))}</div>${p ? field("Request", p.request) + field("Outcome", p.outcome) : ""}
<div class="card">${progressBar(d.progress)}</div>`;
  return page(
    titleOf(d),
    head +
      section("Waves", open.length, waveHtml) +
      section("Epics", d.epics.length, epicHtml) +
      section("Findings", d.findings.length, findingHtml) +
      section("Decisions", d.decisions.length, decisionHtml) +
      section("Facts", d.facts.length, factHtml),
  );
}

function send(res: ServerResponse, status: number, type: string, body: string, extra = {}): void {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

/** Every store under `roots`; a root that is gone contributes none. */
function discover(roots: string[]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    try {
      found.push(...findStores([root]));
    } catch (error) {
      if (!(error instanceof MissingPathError)) throw error;
    }
  }
  return [...new Set(found)];
}

async function route(
  roots: string[],
  token: Buffer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, PLAIN, "Method not allowed", { Allow: ALLOWED_METHODS });
  }
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const given = Buffer.from(pathname.split("/")[1] ?? "");
  if (given.length !== token.length || !timingSafeEqual(given, token)) {
    return send(res, 404, PLAIN, "Not found");
  }
  const rest = pathname.slice(1 + token.length);
  const stores = discover(roots);
  if (rest === "/") {
    const cards = await Promise.all(
      stores.map((path) =>
        readPlan(path).catch((error: unknown) => ({
          path,
          error: error instanceof Error ? error.message : String(error),
        })),
      ),
    );
    const created = (c: (typeof cards)[number]): string =>
      "error" in c ? "" : (c.plan?.createdAt ?? "");
    cards.sort(
      (a, b) =>
        (created(b) ? 1 : 0) - (created(a) ? 1 : 0) ||
        created(b).localeCompare(created(a)) ||
        a.path.localeCompare(b.path),
    );
    return send(res, 200, HTML, indexPage(roots, cards));
  }
  const id = PLAN_ROUTE.exec(rest)?.[1];
  const path = id === undefined ? undefined : stores.find((s) => planId(s) === id);
  if (path === undefined) return send(res, 404, HTML, page("Not found", "<h1>Not found</h1>"));
  try {
    return send(res, 200, HTML, planPage(await readPlan(path)));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return send(
      res,
      500,
      HTML,
      page(
        "Plan unreadable",
        `<p><a href="../">All plans</a></p><h1>Cannot read this plan</h1><div class="meta">${escapeHtml(shown(path))}</div><div class="text">${escapeHtml(msg)}</div>`,
      ),
    );
  }
}

/** Starts the server; `host` defaults to every interface. */
export async function servePlans(
  roots: string[],
  options: { host?: string } = {},
): Promise<PlanServer> {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const token = Buffer.from(secret);
  const server = createServer((req, res) => {
    route(roots, token, req, res).catch(() => {
      if (!res.headersSent) send(res, 500, PLAIN, "Internal error");
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, options.host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const network = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}/${secret}/`);
  return {
    port,
    urls: { local: `http://localhost:${port}/${secret}/`, network },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
