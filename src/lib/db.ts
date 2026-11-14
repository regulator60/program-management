import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  key TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  level TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  status_category TEXT NOT NULL,
  assignee TEXT,
  start_date TEXT,
  due_date TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  components TEXT NOT NULL DEFAULT '[]',
  sub_track TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',
  tier INTEGER,
  parent_key TEXT,
  in_scope INTEGER NOT NULL DEFAULT 1,
  is_intake INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  updated_at TEXT,
  synced_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'jira'
);
CREATE INDEX IF NOT EXISTS idx_issues_level ON issues(level);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_key);

CREATE TABLE IF NOT EXISTS links (
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  type_name TEXT NOT NULL,
  outward TEXT NOT NULL,
  inward TEXT NOT NULL,
  PRIMARY KEY (from_key, to_key, type_name)
);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_key);

-- Field changes detected between syncs (powers "dependency dates changed").
CREATE TABLE IF NOT EXISTS issue_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_changes_key ON issue_changes(key);

-- Local edits waiting to be pushed to Jira (CSV import or REST).
CREATE TABLE IF NOT EXISTS pending_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL,
  pushed_at TEXT,
  push_method TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  meeting_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  jira_key TEXT,
  sub_track TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
`;

export function openDb(path = process.env.DATABASE_PATH ?? "data/app.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

let shared: DatabaseSync | null = null;

/** Process-wide connection for server components / actions. */
export function getDb(): DatabaseSync {
  if (!shared) shared = openDb();
  return shared;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
