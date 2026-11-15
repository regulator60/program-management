import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedDemo } from "./seed";

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

-- Jira items an action item helps move forward (milestones, dependencies, risks...).
CREATE TABLE IF NOT EXISTS action_links (
  action_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (action_id, key)
);
CREATE INDEX IF NOT EXISTS idx_action_links_key ON action_links(key);

-- A program action item (Jira intake issue "jira:KEY" or local "local:ID")
-- assigned to a sub-track or platform, which completes its part independently.
CREATE TABLE IF NOT EXISTS program_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT,
  due_date TEXT,
  note TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (parent, scope_kind, scope_name)
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

/** Columns added after v1. Applied idempotently to existing databases. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "notes", column: "source_url", ddl: "ALTER TABLE notes ADD COLUMN source_url TEXT" },
  { table: "notes", column: "attachment_name", ddl: "ALTER TABLE notes ADD COLUMN attachment_name TEXT" },
  { table: "notes", column: "attachment_path", ddl: "ALTER TABLE notes ADD COLUMN attachment_path TEXT" },
  { table: "notes", column: "sub_track", ddl: "ALTER TABLE notes ADD COLUMN sub_track TEXT" },
  { table: "notes", column: "updated_at", ddl: "ALTER TABLE notes ADD COLUMN updated_at TEXT" },
  { table: "notes", column: "platform", ddl: "ALTER TABLE notes ADD COLUMN platform TEXT" },
  { table: "action_items", column: "platform", ddl: "ALTER TABLE action_items ADD COLUMN platform TEXT" },
  // "team": small action from notes / a call. "program": a high-level ask assigned out to teams.
  { table: "action_items", column: "kind", ddl: "ALTER TABLE action_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'team'" },
];

function migrate(db: DatabaseSync) {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
}

export const DEFAULT_DB_PATH = "data/app.db";

export function dbPath() {
  return process.env.DATABASE_PATH || DEFAULT_DB_PATH;
}

/**
 * Original meeting-note files (Google Docs exports, .docx, etc.) live next to
 * the database, never in git: this repository is public.
 */
export function attachmentsDir() {
  return join(dirname(dbPath()), "attachments");
}

export function openDb(path = dbPath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

let shared: DatabaseSync | null = null;

/** Process-wide connection for server components / actions. */
export function getDb(): DatabaseSync {
  if (!shared) {
    shared = openDb();
    // The public GitHub Pages demo runs on fictional data only.
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") {
      const n = (shared.prepare("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n;
      if (n === 0) seedDemo(shared);
    }
  }
  return shared;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
