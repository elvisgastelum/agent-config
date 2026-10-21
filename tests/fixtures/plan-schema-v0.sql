PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fix', 'ticket', 'feat', 'epic', 'project')),
  request TEXT NOT NULL,
  outcome TEXT,
  status TEXT NOT NULL DEFAULT 'interview' CHECK (status IN ('interview', 'review', 'written')),
  tracker TEXT NOT NULL DEFAULT 'store' CHECK (tracker IN ('store', 'kaneo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  fact TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  why TEXT,
  decided_by TEXT NOT NULL CHECK (decided_by IN ('user', 'recommendation'))
);
CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  done_when TEXT NOT NULL,
  position INTEGER NOT NULL,
  tracker_id TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  epic_id TEXT REFERENCES epics(id),
  kind TEXT NOT NULL DEFAULT 'story' CHECK (kind IN ('story', 'gap')),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  done_when TEXT NOT NULL,
  size TEXT NOT NULL CHECK (size IN ('P1', 'P2', 'P3', 'P5')),
  touches TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  tracker_id TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker TEXT NOT NULL REFERENCES tickets(id),
  blocked TEXT NOT NULL REFERENCES tickets(id),
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gap', 'red_flag', 'smell', 'risk')),
  lens TEXT NOT NULL,
  detail TEXT NOT NULL,
  why TEXT NOT NULL,
  recommendation TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'ticketed')),
  resolution TEXT,
  ticket_id TEXT REFERENCES tickets(id)
);
CREATE VIEW IF NOT EXISTS waves AS
WITH RECURSIVE
open_blocks(blocker, blocked) AS (
  SELECT b.blocker, b.blocked FROM blocks b
  JOIN tickets p ON p.id = b.blocker
  JOIN tickets t ON t.id = b.blocked
  WHERE p.status <> 'done' AND t.status <> 'done'
),
reach(src, dst) AS (
  SELECT blocker, blocked FROM open_blocks
  UNION
  SELECT reach.src, o.blocked FROM reach JOIN open_blocks o ON o.blocker = reach.dst
),
stuck(id) AS (
  SELECT DISTINCT r.dst FROM reach r JOIN reach c ON c.src = r.src AND c.dst = c.src
),
layer(ticket_id, wave) AS (
  SELECT t.id, 1 FROM tickets t
  WHERE t.status <> 'done'
    AND NOT EXISTS (SELECT 1 FROM open_blocks o WHERE o.blocked = t.id)
  UNION
  SELECT o.blocked, layer.wave + 1 FROM layer
  JOIN open_blocks o ON o.blocker = layer.ticket_id
  WHERE o.blocked NOT IN (SELECT id FROM stuck)
)
SELECT t.epic_id, layer.ticket_id, MAX(layer.wave) AS wave
FROM layer JOIN tickets t ON t.id = layer.ticket_id
GROUP BY layer.ticket_id;