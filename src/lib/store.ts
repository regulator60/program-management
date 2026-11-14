import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./db";
import type {
  ActionItem,
  EditableField,
  Issue,
  IssueChange,
  Link,
  Note,
  PendingEdit,
} from "./types";

type Row = Record<string, unknown>;

const json = (v: unknown) => JSON.stringify(v ?? []);
const parseArr = (v: unknown): string[] => {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

function rowToIssue(r: Row): Issue {
  return {
    key: String(r.key),
    issueType: String(r.issue_type),
    level: r.level as Issue["level"],
    summary: String(r.summary),
    status: String(r.status),
    statusCategory: r.status_category as Issue["statusCategory"],
    assignee: (r.assignee as string) ?? null,
    startDate: (r.start_date as string) ?? null,
    dueDate: (r.due_date as string) ?? null,
    labels: parseArr(r.labels),
    components: parseArr(r.components),
    subTrack: (r.sub_track as string) ?? null,
    platforms: parseArr(r.platforms),
    tier: r.tier == null ? null : Number(r.tier),
    parentKey: (r.parent_key as string) ?? null,
    inScope: Boolean(r.in_scope),
    isIntake: Boolean(r.is_intake),
    description: (r.description as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
    syncedAt: String(r.synced_at),
    source: r.source as Issue["source"],
  };
}

/** Fields whose changes between syncs are recorded in issue_changes. */
const TRACKED: { field: keyof Issue; col: string }[] = [
  { field: "startDate", col: "start_date" },
  { field: "dueDate", col: "due_date" },
  { field: "status", col: "status" },
  { field: "assignee", col: "assignee" },
  { field: "summary", col: "summary" },
];

/**
 * Insert or update issues. When an issue already exists, differences in
 * tracked fields are written to issue_changes so we can surface
 * "this dependency's dates moved since last sync".
 *
 * An issue that was already in scope stays in scope even if it is re-fetched
 * as someone else's dependency.
 */
export function upsertIssues(
  db: DatabaseSync,
  items: { issue: Issue; links: Link[] }[],
): { inserted: number; updated: number; changes: number } {
  const select = db.prepare("SELECT * FROM issues WHERE key = ?");
  const insertChange = db.prepare(
    "INSERT INTO issue_changes (key, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?)",
  );
  const upsert = db.prepare(`
    INSERT INTO issues (key, issue_type, level, summary, status, status_category, assignee,
      start_date, due_date, labels, components, sub_track, platforms, tier, parent_key,
      in_scope, is_intake, description, updated_at, synced_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      issue_type = excluded.issue_type, level = excluded.level, summary = excluded.summary,
      status = excluded.status, status_category = excluded.status_category,
      assignee = excluded.assignee, start_date = excluded.start_date, due_date = excluded.due_date,
      labels = excluded.labels, components = excluded.components, sub_track = excluded.sub_track,
      platforms = excluded.platforms, tier = excluded.tier, parent_key = excluded.parent_key,
      in_scope = MAX(issues.in_scope, excluded.in_scope),
      is_intake = excluded.is_intake, description = excluded.description,
      updated_at = excluded.updated_at, synced_at = excluded.synced_at, source = excluded.source
  `);
  const deleteLinks = db.prepare("DELETE FROM links WHERE from_key = ? OR to_key = ?");
  const insertLink = db.prepare(
    "INSERT OR REPLACE INTO links (from_key, to_key, type_name, outward, inward) VALUES (?, ?, ?, ?, ?)",
  );

  let inserted = 0;
  let updated = 0;
  let changes = 0;
  const detectedAt = nowIso();

  db.exec("BEGIN");
  try {
    for (const { issue: i } of items) {
      const prev = select.get(i.key) as Row | undefined;
      if (prev) {
        updated++;
        for (const t of TRACKED) {
          const oldV = (prev[t.col] as string | null) ?? null;
          const newV = (i[t.field] as string | null) ?? null;
          if (oldV !== newV) {
            insertChange.run(i.key, t.field, oldV, newV, detectedAt);
            changes++;
          }
        }
      } else {
        inserted++;
      }
      upsert.run(
        i.key, i.issueType, i.level, i.summary, i.status, i.statusCategory, i.assignee,
        i.startDate, i.dueDate, json(i.labels), json(i.components), i.subTrack,
        json(i.platforms), i.tier, i.parentKey, i.inScope ? 1 : 0, i.isIntake ? 1 : 0,
        i.description, i.updatedAt, i.syncedAt, i.source,
      );
    }
    // Replace links only for issues we actually received.
    for (const { issue } of items) deleteLinks.run(issue.key, issue.key);
    for (const { links } of items) {
      for (const l of links) insertLink.run(l.fromKey, l.toKey, l.typeName, l.outward, l.inward);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { inserted, updated, changes };
}

// ---------- Issues (with pending edits overlaid) ----------

export type IssueView = Issue & {
  /** Fields that have unpushed local edits; values above already reflect them. */
  pendingFields: EditableField[];
};

const FIELD_TO_PROP: Record<EditableField, keyof Issue> = {
  summary: "summary",
  status: "status",
  assignee: "assignee",
  startDate: "startDate",
  dueDate: "dueDate",
  labels: "labels",
};

export function listIssues(db: DatabaseSync): IssueView[] {
  const rows = db.prepare("SELECT * FROM issues ORDER BY key").all() as Row[];
  const edits = listPendingEdits(db, { unpushedOnly: true });
  const byKey = new Map<string, PendingEdit[]>();
  for (const e of edits) {
    const arr = byKey.get(e.key) ?? [];
    arr.push(e);
    byKey.set(e.key, arr);
  }
  return rows.map((r) => {
    const issue = rowToIssue(r) as IssueView;
    issue.pendingFields = [];
    for (const e of byKey.get(issue.key) ?? []) {
      const prop = FIELD_TO_PROP[e.field];
      if (e.field === "labels") {
        issue.labels = parseArr(e.newValue);
      } else {
        (issue as Record<string, unknown>)[prop] = e.newValue;
      }
      if (!issue.pendingFields.includes(e.field)) issue.pendingFields.push(e.field);
    }
    return issue;
  });
}

export function getIssue(db: DatabaseSync, key: string): IssueView | null {
  return listIssues(db).find((i) => i.key === key) ?? null;
}

export function listLinks(db: DatabaseSync): Link[] {
  return (db.prepare("SELECT * FROM links").all() as Row[]).map((r) => ({
    fromKey: String(r.from_key),
    toKey: String(r.to_key),
    typeName: String(r.type_name),
    outward: String(r.outward),
    inward: String(r.inward),
  }));
}

export function listChanges(
  db: DatabaseSync,
  opts: { sinceIso?: string; key?: string } = {},
): IssueChange[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.sinceIso) {
    where.push("detected_at >= ?");
    args.push(opts.sinceIso);
  }
  if (opts.key) {
    where.push("key = ?");
    args.push(opts.key);
  }
  const sql = `SELECT * FROM issue_changes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY detected_at DESC, id DESC`;
  return (db.prepare(sql).all(...args) as Row[]).map((r) => ({
    id: Number(r.id),
    key: String(r.key),
    field: String(r.field),
    oldValue: (r.old_value as string) ?? null,
    newValue: (r.new_value as string) ?? null,
    detectedAt: String(r.detected_at),
  }));
}

// ---------- Pending edits ----------

function rowToEdit(r: Row): PendingEdit {
  return {
    id: Number(r.id),
    key: String(r.key),
    field: r.field as EditableField,
    oldValue: (r.old_value as string) ?? null,
    newValue: (r.new_value as string) ?? null,
    createdAt: String(r.created_at),
    pushedAt: (r.pushed_at as string) ?? null,
    pushMethod: (r.push_method as string) ?? null,
  };
}

export function listPendingEdits(
  db: DatabaseSync,
  opts: { unpushedOnly?: boolean } = {},
): PendingEdit[] {
  const sql = opts.unpushedOnly
    ? "SELECT * FROM pending_edits WHERE pushed_at IS NULL ORDER BY id"
    : "SELECT * FROM pending_edits ORDER BY pushed_at IS NOT NULL, id DESC";
  return (db.prepare(sql).all() as Row[]).map(rowToEdit);
}

/**
 * Stage a local change. Only one unpushed edit per (key, field) is kept; if the
 * new value equals what Jira already has, the staged edit is dropped.
 */
export function stageEdit(
  db: DatabaseSync,
  key: string,
  field: EditableField,
  newValue: string | null,
) {
  const row = db.prepare("SELECT * FROM issues WHERE key = ?").get(key) as Row | undefined;
  if (!row) throw new Error(`Unknown issue ${key}`);
  const base = rowToIssue(row);
  const prop = FIELD_TO_PROP[field];
  const current =
    field === "labels" ? JSON.stringify(base.labels) : ((base[prop] as string | null) ?? null);
  const normalized = newValue === "" ? null : newValue;

  db.prepare("DELETE FROM pending_edits WHERE key = ? AND field = ? AND pushed_at IS NULL").run(
    key,
    field,
  );
  if (normalized === current) return;
  db.prepare(
    "INSERT INTO pending_edits (key, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(key, field, current, normalized, nowIso());
}

export function discardEdit(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM pending_edits WHERE id = ? AND pushed_at IS NULL").run(id);
}

/**
 * Mark edits pushed and write the new values into the local issue row, so the
 * app reflects them before the next sync confirms.
 */
export function markEditsPushed(db: DatabaseSync, ids: number[], method: string) {
  const at = nowIso();
  const get = db.prepare("SELECT * FROM pending_edits WHERE id = ?");
  const mark = db.prepare("UPDATE pending_edits SET pushed_at = ?, push_method = ? WHERE id = ?");
  const colFor: Record<EditableField, string> = {
    summary: "summary",
    status: "status",
    assignee: "assignee",
    startDate: "start_date",
    dueDate: "due_date",
    labels: "labels",
  };
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      const e = get.get(id) as Row | undefined;
      if (!e || e.pushed_at) continue;
      const col = colFor[e.field as EditableField];
      db.prepare(`UPDATE issues SET ${col} = ? WHERE key = ?`).run(
        (e.new_value as string) ?? null,
        String(e.key),
      );
      mark.run(at, method, id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------- Notes & action items ----------

export function listNotes(db: DatabaseSync): Note[] {
  return (db.prepare("SELECT * FROM notes ORDER BY COALESCE(meeting_date, created_at) DESC, id DESC").all() as Row[]).map(
    (r) => ({
      id: Number(r.id),
      title: String(r.title),
      body: String(r.body),
      meetingDate: (r.meeting_date as string) ?? null,
      source: String(r.source),
      createdAt: String(r.created_at),
    }),
  );
}

export function addNote(
  db: DatabaseSync,
  n: { title: string; body: string; meetingDate?: string | null; source?: string },
): number {
  const res = db
    .prepare("INSERT INTO notes (title, body, meeting_date, source, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(n.title, n.body, n.meetingDate ?? null, n.source ?? "manual", nowIso());
  return Number(res.lastInsertRowid);
}

export function deleteNote(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
}

export function listActionItems(db: DatabaseSync): ActionItem[] {
  return (db.prepare("SELECT * FROM action_items ORDER BY status, due_date IS NULL, due_date, id").all() as Row[]).map(
    (r) => ({
      id: Number(r.id),
      noteId: r.note_id == null ? null : Number(r.note_id),
      text: String(r.text),
      owner: (r.owner as string) ?? null,
      dueDate: (r.due_date as string) ?? null,
      status: r.status as ActionItem["status"],
      jiraKey: (r.jira_key as string) ?? null,
      subTrack: (r.sub_track as string) ?? null,
      createdAt: String(r.created_at),
    }),
  );
}

export function addActionItem(
  db: DatabaseSync,
  a: Pick<ActionItem, "text"> & Partial<Omit<ActionItem, "id" | "createdAt">>,
): number {
  const res = db
    .prepare(
      "INSERT INTO action_items (note_id, text, owner, due_date, status, jira_key, sub_track, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      a.noteId ?? null,
      a.text,
      a.owner ?? null,
      a.dueDate ?? null,
      a.status ?? "open",
      a.jiraKey ?? null,
      a.subTrack ?? null,
      nowIso(),
    );
  return Number(res.lastInsertRowid);
}

export function updateActionItem(
  db: DatabaseSync,
  id: number,
  patch: Partial<Pick<ActionItem, "status" | "owner" | "dueDate" | "jiraKey" | "text" | "subTrack">>,
) {
  const cols: Record<string, string> = {
    status: "status",
    owner: "owner",
    dueDate: "due_date",
    jiraKey: "jira_key",
    text: "text",
    subTrack: "sub_track",
  };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !cols[k]) continue;
    db.prepare(`UPDATE action_items SET ${cols[k]} = ? WHERE id = ?`).run(v === "" ? null : v, id);
  }
}

export function deleteActionItem(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM action_items WHERE id = ?").run(id);
}

// ---------- Sync log ----------

export function logSync(db: DatabaseSync, source: string, ok: boolean, message: string, startedAt: string) {
  db.prepare(
    "INSERT INTO sync_log (source, started_at, finished_at, ok, message) VALUES (?, ?, ?, ?, ?)",
  ).run(source, startedAt, nowIso(), ok ? 1 : 0, message);
}

export function recentSyncs(db: DatabaseSync, limit = 10) {
  return db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    source: string;
    started_at: string;
    finished_at: string;
    ok: number;
    message: string;
  }[];
}

export function clearAllData(db: DatabaseSync) {
  db.exec(
    "DELETE FROM issues; DELETE FROM links; DELETE FROM issue_changes; DELETE FROM pending_edits; DELETE FROM action_items; DELETE FROM notes; DELETE FROM sync_log;",
  );
}
