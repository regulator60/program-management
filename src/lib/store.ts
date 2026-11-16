import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./db";
import { scopeId } from "./types";
import type {
  ItemUpdate,
  UpdateProgress,
  ActionItem,
  ProgramAssignment,
  Scope,
  EditableField,
  Issue,
  IssueChange,
  Link,
  Note,
  NoteRef,
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

const FIELD_TO_PROP: Record<Exclude<EditableField, "comment">, keyof Issue> = {
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
      if (e.field === "comment") {
        if (!issue.pendingFields.includes("comment")) issue.pendingFields.push("comment");
        continue;
      }
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
  if (field === "comment") {
    if (!newValue?.trim()) return;
    // Comments append; skip exact duplicates already staged or pushed.
    const dup = db
      .prepare("SELECT 1 FROM pending_edits WHERE key = ? AND field = 'comment' AND new_value = ?")
      .get(key, newValue);
    if (dup) return;
    db.prepare(
      "INSERT INTO pending_edits (key, field, old_value, new_value, created_at) VALUES (?, 'comment', NULL, ?, ?)",
    ).run(key, newValue, nowIso());
    return;
  }
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
  const colFor: Record<EditableField, string | null> = {
    summary: "summary",
    status: "status",
    assignee: "assignee",
    startDate: "start_date",
    dueDate: "due_date",
    labels: "labels",
    comment: null, // comments live in Jira only
  };
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      const e = get.get(id) as Row | undefined;
      if (!e || e.pushed_at) continue;
      const col = colFor[e.field as EditableField];
      if (col) {
        db.prepare(`UPDATE issues SET ${col} = ? WHERE key = ?`).run(
          (e.new_value as string) ?? null,
          String(e.key),
        );
      }
      mark.run(at, method, id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------- Notes & action items ----------

function rowToNote(r: Row): Note {
  return {
    platform: (r.platform as string) ?? null,
    id: Number(r.id),
    title: String(r.title),
    body: String(r.body),
    meetingDate: (r.meeting_date as string) ?? null,
    source: String(r.source),
    sourceUrl: (r.source_url as string) ?? null,
    attachmentName: (r.attachment_name as string) ?? null,
    attachmentPath: (r.attachment_path as string) ?? null,
    subTrack: (r.sub_track as string) ?? null,
    createdAt: String(r.created_at),
    updatedAt: (r.updated_at as string) ?? null,
    contentHash: (r.content_hash as string) ?? null,
  };
}

export function listNotes(db: DatabaseSync): Note[] {
  const refs = listNoteRefs(db);
  return (
    db.prepare("SELECT * FROM notes ORDER BY COALESCE(meeting_date, created_at) DESC, id DESC").all() as Row[]
  ).map((r) => ({ ...rowToNote(r), refs: refs.get(Number(r.id)) ?? [] }));
}

// ---------- What notes are about, and what was done with their suggestions ----------

export function listNoteRefs(db: DatabaseSync): Map<number, NoteRef[]> {
  const m = new Map<number, NoteRef[]>();
  for (const r of db.prepare("SELECT note_id, key, line, kind FROM note_refs ORDER BY rowid").all() as Row[]) {
    const id = Number(r.note_id);
    m.set(id, [...(m.get(id) ?? []), { key: String(r.key), line: (r.line as string) ?? null, kind: r.kind as NoteRef["kind"] }]);
  }
  return m;
}

/** Replace the automatically found references for a note (manual links and exclusions are kept). */
export function setAutoNoteRefs(db: DatabaseSync, noteId: number, refs: { key: string; line: string }[]) {
  db.prepare("DELETE FROM note_refs WHERE note_id = ? AND kind = 'auto'").run(noteId);
  const excluded = new Set(
    (db.prepare("SELECT key FROM note_refs WHERE note_id = ? AND kind = 'excluded'").all(noteId) as Row[]).map((r) => String(r.key)),
  );
  const ins = db.prepare("INSERT INTO note_refs (note_id, key, line, kind) VALUES (?, ?, ?, 'auto')");
  for (const r of refs) if (!excluded.has(r.key)) ins.run(noteId, r.key, r.line.slice(0, 500));
}

/**
 * Set exactly which items a note is about. Items found in the text that the
 * user removes are remembered as excluded, so a refresh doesn't bring them back.
 */
export function setNoteLinks(db: DatabaseSync, noteId: number, keys: string[]) {
  const want = new Set(keys);
  const rows = db.prepare("SELECT key, kind FROM note_refs WHERE note_id = ?").all(noteId) as Row[];
  const auto = new Set(rows.filter((r) => r.kind === "auto").map((r) => String(r.key)));
  db.prepare("DELETE FROM note_refs WHERE note_id = ? AND kind IN ('manual', 'excluded')").run(noteId);
  const ins = db.prepare("INSERT INTO note_refs (note_id, key, line, kind) VALUES (?, ?, NULL, ?)");
  for (const k of want) if (!auto.has(k)) ins.run(noteId, k, "manual");
  for (const k of auto) {
    if (want.has(k)) continue;
    db.prepare("DELETE FROM note_refs WHERE note_id = ? AND key = ? AND kind = 'auto'").run(noteId, k);
    ins.run(noteId, k, "excluded");
  }
}

/** Add manual links without touching the rest (used when notes are attached from an item's page). */
export function addNoteLinks(db: DatabaseSync, noteId: number, keys: string[]) {
  const have = new Set(
    (db.prepare("SELECT key FROM note_refs WHERE note_id = ? AND kind != 'excluded'").all(noteId) as Row[]).map((r) => String(r.key)),
  );
  db.prepare(`DELETE FROM note_refs WHERE note_id = ? AND kind = 'excluded' AND key IN (${keys.map(() => "?").join(",") || "''"})`).run(
    noteId,
    ...keys,
  );
  const ins = db.prepare("INSERT INTO note_refs (note_id, key, line, kind) VALUES (?, ?, NULL, 'manual')");
  for (const k of keys) if (!have.has(k)) ins.run(noteId, k);
}

export function handledNoteSuggestions(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT sig FROM note_suggestions").all() as Row[]).map((r) => String(r.sig)));
}

export function markNoteSuggestions(db: DatabaseSync, noteId: number, sigs: string[], state: "staged" | "dismissed") {
  const st = db.prepare("INSERT OR REPLACE INTO note_suggestions (sig, note_id, state, at) VALUES (?, ?, ?, ?)");
  for (const s of sigs) st.run(s, noteId, state, nowIso());
}

export type NoteImport = { noteId: number; via: string; result: string; detail: string | null; at: string };

export function logNoteImport(db: DatabaseSync, noteId: number, via: string, result: string, detail: string | null = null) {
  db.prepare("INSERT INTO note_imports (note_id, via, result, detail, at) VALUES (?, ?, ?, ?, ?)").run(noteId, via, result, detail, nowIso());
}

export function listNoteImports(db: DatabaseSync): Map<number, NoteImport[]> {
  const m = new Map<number, NoteImport[]>();
  for (const r of db.prepare("SELECT * FROM note_imports ORDER BY at DESC, id DESC").all() as Row[]) {
    const id = Number(r.note_id);
    m.set(id, [
      ...(m.get(id) ?? []),
      { noteId: id, via: String(r.via), result: String(r.result), detail: (r.detail as string) ?? null, at: String(r.at) },
    ]);
  }
  return m;
}

export function setNoteHash(db: DatabaseSync, id: number, hash: string) {
  db.prepare("UPDATE notes SET content_hash = ? WHERE id = ?").run(hash, id);
}

export function getNote(db: DatabaseSync, id: number): Note | null {
  const r = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToNote(r) : null;
}

export function findNoteBySource(db: DatabaseSync, source: string): Note | null {
  const r = db.prepare("SELECT * FROM notes WHERE source = ? ORDER BY id DESC LIMIT 1").get(source) as Row | undefined;
  return r ? rowToNote(r) : null;
}

export type NoteInput = {
  platform?: string | null;
  title: string;
  body: string;
  meetingDate?: string | null;
  source?: string;
  sourceUrl?: string | null;
  attachmentName?: string | null;
  attachmentPath?: string | null;
  subTrack?: string | null;
};

export function addNote(db: DatabaseSync, n: NoteInput): number {
  const res = db
    .prepare(
      `INSERT INTO notes (title, body, meeting_date, source, source_url, attachment_name, attachment_path, sub_track, platform, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      n.title,
      n.body,
      n.meetingDate ?? null,
      n.source ?? "manual",
      n.sourceUrl ?? null,
      n.attachmentName ?? null,
      n.attachmentPath ?? null,
      n.subTrack ?? null,
      n.platform ?? null,
      nowIso(),
    );
  return Number(res.lastInsertRowid);
}

export function updateNoteContent(
  db: DatabaseSync,
  id: number,
  n: Pick<NoteInput, "title" | "body" | "meetingDate">,
) {
  db.prepare("UPDATE notes SET title = ?, body = ?, meeting_date = COALESCE(?, meeting_date), updated_at = ? WHERE id = ?").run(
    n.title,
    n.body,
    n.meetingDate ?? null,
    nowIso(),
    id,
  );
}

export function setNoteAttachment(db: DatabaseSync, id: number, name: string, path: string) {
  db.prepare("UPDATE notes SET attachment_name = ?, attachment_path = ? WHERE id = ?").run(name, path, id);
}

export function deleteNote(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
}

export function listActionItems(db: DatabaseSync): ActionItem[] {
  const links = new Map<number, string[]>();
  for (const r of db.prepare("SELECT action_id, key FROM action_links ORDER BY key").all() as Row[]) {
    const id = Number(r.action_id);
    links.set(id, [...(links.get(id) ?? []), String(r.key)]);
  }
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
      platform: (r.platform as string) ?? null,
      kind: (r.kind as ActionItem["kind"]) ?? "team",
      links: links.get(Number(r.id)) ?? [],
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
      "INSERT INTO action_items (note_id, text, owner, due_date, status, jira_key, sub_track, platform, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      a.noteId ?? null,
      a.text,
      a.owner ?? null,
      a.dueDate ?? null,
      a.status ?? "open",
      a.jiraKey ?? null,
      a.subTrack ?? null,
      a.platform ?? null,
      a.kind ?? "team",
      nowIso(),
    );
  const id = Number(res.lastInsertRowid);
  if (a.links?.length) setActionLinks(db, id, a.links);
  return id;
}

export function setActionLinks(db: DatabaseSync, id: number, keys: string[]) {
  db.prepare("DELETE FROM action_links WHERE action_id = ?").run(id);
  const ins = db.prepare("INSERT OR IGNORE INTO action_links (action_id, key) VALUES (?, ?)");
  for (const k of new Set(keys.map((x) => x.trim().toUpperCase()).filter(Boolean))) ins.run(id, k);
}

export function updateActionItem(
  db: DatabaseSync,
  id: number,
  patch: Partial<Pick<ActionItem, "status" | "owner" | "dueDate" | "jiraKey" | "text" | "subTrack" | "platform" | "links">>,
) {
  const cols: Record<string, string> = {
    status: "status",
    owner: "owner",
    dueDate: "due_date",
    jiraKey: "jira_key",
    text: "text",
    subTrack: "sub_track",
    platform: "platform",
  };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "links" && Array.isArray(v)) {
      setActionLinks(db, id, v);
      continue;
    }
    if (v === undefined || !cols[k]) continue;
    db.prepare(`UPDATE action_items SET ${cols[k]} = ? WHERE id = ?`).run(v === "" ? null : (v as string), id);
  }
}

// ---------- Item updates (S0 notes) ----------

export function addItemUpdate(
  db: DatabaseSync,
  u: { key: string; body: string; progress?: UpdateProgress | null; scope?: string | null; sentToJira?: boolean },
): number {
  const res = db
    .prepare("INSERT INTO item_updates (key, body, progress, scope, sent_to_jira, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(u.key, u.body, u.progress ?? null, u.scope ?? null, u.sentToJira ? 1 : 0, nowIso());
  return Number(res.lastInsertRowid);
}

/** Newest first. */
export function listItemUpdates(db: DatabaseSync, key?: string): ItemUpdate[] {
  const rows = (
    key
      ? db.prepare("SELECT * FROM item_updates WHERE key = ? ORDER BY created_at DESC, id DESC").all(key)
      : db.prepare("SELECT * FROM item_updates ORDER BY created_at DESC, id DESC").all()
  ) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    key: String(r.key),
    body: String(r.body),
    progress: (r.progress as UpdateProgress) ?? null,
    scope: (r.scope as string) ?? null,
    sentToJira: Boolean(r.sent_to_jira),
    createdAt: String(r.created_at),
  }));
}

export function deleteItemUpdate(db: DatabaseSync, id: number) {
  db.prepare("DELETE FROM item_updates WHERE id = ?").run(id);
}

// ---------- Program action items: per-team assignments ----------

function rowToAssignment(r: Row): ProgramAssignment {
  return {
    id: Number(r.id),
    parent: String(r.parent),
    scope: { kind: r.scope_kind as Scope["kind"], name: String(r.scope_name) },
    status: r.status as ProgramAssignment["status"],
    owner: (r.owner as string) ?? null,
    dueDate: (r.due_date as string) ?? null,
    note: (r.note as string) ?? null,
    doneAt: (r.done_at as string) ?? null,
    createdAt: String(r.created_at),
  };
}

export function listAssignments(db: DatabaseSync): ProgramAssignment[] {
  return (db.prepare("SELECT * FROM program_assignments ORDER BY parent, scope_kind DESC, scope_name").all() as Row[]).map(
    rowToAssignment,
  );
}

/** Make sure `parent` is assigned to exactly these scopes. Removing a scope keeps it if already done. */
export function setAssignments(db: DatabaseSync, parent: string, scopes: Scope[]) {
  const want = new Set(scopes.map(scopeId));
  for (const a of listAssignments(db).filter((x) => x.parent === parent)) {
    if (!want.has(scopeId(a.scope)) && a.status !== "done") db.prepare("DELETE FROM program_assignments WHERE id = ?").run(a.id);
  }
  for (const s of scopes) addAssignment(db, parent, s);
}

export function addAssignment(db: DatabaseSync, parent: string, s: Scope) {
  db.prepare(
    "INSERT OR IGNORE INTO program_assignments (parent, scope_kind, scope_name, created_at) VALUES (?, ?, ?, ?)",
  ).run(parent, s.kind, s.name, nowIso());
}

export function updateAssignment(
  db: DatabaseSync,
  id: number,
  patch: Partial<Pick<ProgramAssignment, "status" | "owner" | "dueDate" | "note">>,
) {
  if (patch.status) {
    db.prepare("UPDATE program_assignments SET status = ?, done_at = ? WHERE id = ?").run(
      patch.status,
      patch.status === "done" ? nowIso() : null,
      id,
    );
  }
  for (const [k, col] of [["owner", "owner"], ["dueDate", "due_date"], ["note", "note"]] as const) {
    if (patch[k] !== undefined) {
      db.prepare(`UPDATE program_assignments SET ${col} = ? WHERE id = ?`).run(patch[k] || null, id);
    }
  }
}

/**
 * Intake issues labelled with platforms (Domain:…) or a sub-track get those
 * teams assigned automatically. Never removes anything; safe to call after every load.
 */
export function ensureAutoAssignments(db: DatabaseSync) {
  for (const i of listIssues(db)) {
    if (!i.isIntake) continue;
    for (const p of i.platforms) addAssignment(db, `jira:${i.key}`, { kind: "platform", name: p });
    if (i.subTrack) addAssignment(db, `jira:${i.key}`, { kind: "subtrack", name: i.subTrack });
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
    "DELETE FROM issues; DELETE FROM links; DELETE FROM issue_changes; DELETE FROM pending_edits; DELETE FROM action_links; DELETE FROM program_assignments; DELETE FROM item_updates; DELETE FROM action_items; DELETE FROM notes; DELETE FROM sync_log;",
  );
}
