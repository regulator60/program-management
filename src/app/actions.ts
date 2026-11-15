"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_CONFIG, getConfig, saveConfig, type AppConfig } from "@/lib/config";
import {
  actionContext,
  fetchSheetCsv,
  importAttachedNote,
  importConfluencePage,
  importGoogleDoc,
  refreshNote,
  importNoteText,
  importSheetRows,
  syncJira,
  type SheetTarget,
} from "@/lib/connectors";
import { getDb, nowIso } from "@/lib/db";
import { editsToRestPayload, JiraClient } from "@/lib/jira/client";
import { importJiraFile } from "@/lib/jira/fileImport";
import { seedDemo } from "@/lib/seed";
import {
  addItemUpdate,
  deleteItemUpdate,
  getIssue,
  addActionItem,
  ensureAutoAssignments,
  listAssignments,
  setAssignments,
  updateAssignment,
  clearAllData,
  deleteActionItem,
  deleteNote,
  discardEdit,
  listPendingEdits,
  logSync,
  markEditsPushed,
  stageEdit,
  updateActionItem,
  upsertIssues,
} from "@/lib/store";
import { EDITABLE_FIELDS, PROGRESS_LABEL, parseScope, type EditableField, type Scope, type UpdateProgress } from "@/lib/types";

// NOTE: this app is meant to run locally (localhost) for a single user, so
// server actions don't authenticate. Add auth before hosting it anywhere shared.

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function done(target: string, msg: string, ok = true): never {
  revalidatePath("/", "layout");
  const [path, hash] = target.split("#");
  const q = `${ok ? "msg" : "err"}=${encodeURIComponent(msg)}`;
  redirect(`${path}${path.includes("?") ? "&" : "?"}${q}${hash ? `#${hash}` : ""}`);
}

async function attempt(path: string, fn: () => Promise<string> | string): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (e) {
    done(path, e instanceof Error ? e.message : String(e), false);
  }
  done(path, msg);
}

// ---------- Jira / data ----------

export async function syncJiraAction() {
  await attempt("/sync", () => syncJira(getDb()));
}

export async function importJiraFileAction(fd: FormData) {
  await attempt("/sync", async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to import.");
    const db = getDb();
    const startedAt = nowIso();
    const items = importJiraFile(await file.text(), file.name, getConfig(db), {
      inScope: str(fd, "scope") !== "external",
      syncedAt: nowIso(),
    });
    const r = upsertIssues(db, items);
    ensureAutoAssignments(db);
    const msg = `Imported ${items.length} issues from ${file.name}: ${r.inserted} new, ${r.updated} updated, ${r.changes} field changes.`;
    logSync(db, "file", true, msg, startedAt);
    return msg;
  });
}

export async function importSheetAction(fd: FormData) {
  await attempt("/sync", async () => {
    const target = (str(fd, "target") || "action_items") as SheetTarget;
    const file = fd.get("file");
    let csv: string;
    if (file instanceof File && file.size > 0) csv = await file.text();
    else {
      const url = str(fd, "url");
      if (!url) throw new Error("Paste a Google Sheets URL or upload a CSV.");
      csv = await fetchSheetCsv(url);
    }
    const n = importSheetRows(getDb(), csv, target);
    return `Imported ${n} rows from sheet.`;
  });
}

export async function seedDemoAction() {
  await attempt("/sync", () => {
    seedDemo(getDb());
    return "Demo data loaded.";
  });
}

export async function clearDataAction() {
  await attempt("/sync", () => {
    clearAllData(getDb());
    return "All local data cleared (settings kept).";
  });
}

// ---------- Edits ----------

export async function stageEditsAction(fd: FormData) {
  const key = str(fd, "key");
  const back = str(fd, "back") || `/items/${encodeURIComponent(key)}`;
  await attempt(back, () => {
    const db = getDb();
    for (const field of EDITABLE_FIELDS) {
      if (!fd.has(field)) continue;
      let v: string | null = str(fd, field);
      if (field === "labels") {
        v = JSON.stringify(
          v
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      stageEdit(db, key, field as EditableField, v);
    }
    return `Saved locally. Changes show as "pending" until pushed to Jira.`;
  });
}

export async function discardEditAction(fd: FormData) {
  await attempt(str(fd, "back") || "/sync", () => {
    discardEdit(getDb(), Number(str(fd, "id")));
    return "Edit discarded.";
  });
}

export async function markExportedAction(fd: FormData) {
  await attempt("/sync", () => {
    const ids = str(fd, "ids").split(",").map(Number).filter(Boolean);
    markEditsPushed(getDb(), ids, "csv-import");
    return `Marked ${ids.length} edits as pushed via CSV import.`;
  });
}

export async function pushViaRestAction() {
  await attempt("/sync", async () => {
    const db = getDb();
    const cfg = getConfig(db);
    const client = JiraClient.fromConfig(cfg);
    const edits = listPendingEdits(db, { unpushedOnly: true });
    const byKey = new Map<string, typeof edits>();
    for (const e of edits) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
    const ok: number[] = [];
    const errors: string[] = [];
    for (const [key, list] of byKey) {
      try {
        const { fields, status, comments } = editsToRestPayload(list, cfg);
        if (Object.keys(fields).length) await client.updateFields(key, fields);
        if (status) await client.transitionTo(key, status);
        for (const c of comments) await client.addComment(key, c);
        ok.push(...list.map((e) => e.id));
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, cfg.jira.writeDelayMs));
    }
    markEditsPushed(db, ok, "rest");
    logSync(db, "jira-push", errors.length === 0, `${ok.length} pushed. ${errors.join(" | ")}`, nowIso());
    if (errors.length) throw new Error(`${ok.length} edits pushed; ${errors.length} issue(s) failed: ${errors.join(" | ")}`);
    return `Pushed ${ok.length} edits to Jira.`;
  });
}

// ---------- Notes & action items ----------

export async function addNoteAction(fd: FormData) {
  await attempt("/notes", () => {
    const body = str(fd, "body");
    if (!body) throw new Error("Note body is empty.");
    const r = importNoteText(getDb(), {
      title: str(fd, "title") || "Untitled notes",
      body,
      meetingDate: str(fd, "meetingDate") || null,
      subTrack: str(fd, "subTrack") || null,
      platform: str(fd, "platform") || null,
    });
    return `Note saved. Found ${r.actions} action item(s).`;
  });
}

export async function importGoogleDocAction(fd: FormData) {
  await attempt("/notes", async () => {
    const url = str(fd, "url");
    if (!url) throw new Error("Paste a Google Docs link.");
    const r = await importGoogleDoc(getDb(), url, { subTrack: str(fd, "subTrack") || null, platform: str(fd, "platform") || null });
    return `${r.updated ? "Refreshed" : "Imported"} "${r.title}". ${r.actions} new action item(s). Review suggested Jira updates below.`;
  });
}

export async function attachNoteAction(fd: FormData) {
  await attempt("/notes", async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a notes file to attach.");
    if (file.size > 20 * 1024 * 1024) throw new Error("That file is over 20 MB.");
    const r = importAttachedNote(getDb(), {
      name: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      title: str(fd, "title"),
      meetingDate: str(fd, "meetingDate") || null,
      subTrack: str(fd, "subTrack") || null,
      platform: str(fd, "platform") || null,
    });
    return `Attached ${file.name}. Found ${r.actions} action item(s). Review suggested Jira updates below.`;
  });
}

export async function refreshNoteAction(fd: FormData) {
  await attempt("/notes", async () => {
    const r = await refreshNote(getDb(), Number(str(fd, "id")));
    return `Refreshed. ${r.actions} new action item(s).`;
  });
}

/**
 * Stage the Jira suggestions the user ticked on a note. Each suggestion posts
 * k-<i>, f-<i>, v-<i> (value may have been edited) and the checkbox "pick"=<i>.
 */
export async function stageNoteSuggestionsAction(fd: FormData) {
  await attempt(`/notes#note-${str(fd, "noteId")}`, () => {
    const db = getDb();
    const picks = fd.getAll("pick").map(String);
    if (!picks.length) throw new Error("Tick at least one suggestion.");
    const allowed = new Set<EditableField>(["dueDate", "startDate", "status", "comment"]);
    let n = 0;
    for (const i of picks) {
      const key = str(fd, `k-${i}`);
      const field = str(fd, `f-${i}`) as EditableField;
      const value = str(fd, `v-${i}`);
      if (!key || !allowed.has(field) || !value) continue;
      stageEdit(db, key, field, value);
      n++;
    }
    return `Staged ${n} Jira update(s). Push them from Data & Jira sync.`;
  });
}

export async function importConfluenceAction(fd: FormData) {
  await attempt("/notes", async () => {
    const r = await importConfluencePage(getDb(), str(fd, "page"));
    return `Confluence page imported. Found ${r.actions} action item(s).`;
  });
}

export async function deleteNoteAction(fd: FormData) {
  await attempt("/notes", () => {
    deleteNote(getDb(), Number(str(fd, "id")));
    return "Note deleted (its action items were kept).";
  });
}

const keysFrom = (v: string) => v.split(/[\s,]+/).map((k) => k.trim().toUpperCase()).filter(Boolean);

export async function addActionItemAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    const text = str(fd, "text");
    if (!text) throw new Error("Action item text is empty.");
    const db = getDb();
    // Explicit fields win; otherwise infer team and links from the text, like notes do.
    const inferred = actionContext(db).scopeFor(text, { subTrack: str(fd, "subTrack"), platform: str(fd, "platform") });
    addActionItem(db, {
      text,
      owner: str(fd, "owner") || null,
      dueDate: str(fd, "dueDate") || null,
      subTrack: inferred.subTrack,
      platform: inferred.platform,
      links: [...new Set([...keysFrom(str(fd, "links")), ...inferred.links])],
    });
    return "Action item added.";
  });
}

// ---------- Item updates (S0 notes) ----------

export async function addItemUpdateAction(fd: FormData) {
  const back = str(fd, "back") || "/s0";
  const key = str(fd, "key");
  await attempt(back, () => {
    const db = getDb();
    const body = str(fd, "body");
    const progress = str(fd, "progress") as UpdateProgress | "";
    if (!body && !progress) throw new Error("Write an update or pick whether it's moving.");
    // A dependency update is stored as "dep:PRED:SUCC"; its Jira comment goes on `commentKey`.
    const dep = key.match(/^dep:([^:]+):([^:]+)$/);
    if (dep ? !getIssue(db, dep[1]) || !getIssue(db, dep[2]) : !getIssue(db, key)) throw new Error(`Unknown item ${key}.`);
    const commentKey = str(fd, "commentKey") || (dep ? dep[2] : key);
    const toJira = fd.get("toJira") === "on";
    const label = progress ? PROGRESS_LABEL[progress] : "";
    addItemUpdate(db, { key, body: body || label, progress: progress || null, scope: str(fd, "scope") || null, sentToJira: toJira });
    if (toJira) {
      const where = parseScope(str(fd, "scope"));
      stageEdit(
        db,
        commentKey,
        "comment",
        `${dep ? `Dependency ${dep[1]} → ${dep[2]} update` : "S0 update"}${where ? ` (${where.name})` : ""}, ${new Date().toISOString().slice(0, 10)}${label ? ` [${label}]` : ""}: ${body || label}`,
      );
    }
    const what = dep ? `${dep[1]} → ${dep[2]}` : key;
    return `Update saved for ${what}${toJira ? ` and staged as a Jira comment on ${commentKey}` : ""}.`;
  });
}

export async function deleteItemUpdateAction(fd: FormData) {
  await attempt(str(fd, "back") || "/s0", () => {
    deleteItemUpdate(getDb(), Number(str(fd, "id")));
    return "Update removed.";
  });
}

// ---------- Program action items ----------

const scopesFrom = (fd: FormData) =>
  fd
    .getAll("scope")
    .map((v) => parseScope(String(v)))
    .filter((s): s is Scope => !!s);

export async function addProgramActionAction(fd: FormData) {
  await attempt("/actions", () => {
    const text = str(fd, "text");
    if (!text) throw new Error("Describe the program action item.");
    const scopes = scopesFrom(fd);
    if (!scopes.length) throw new Error("Assign it to at least one sub-track or platform.");
    const db = getDb();
    const id = addActionItem(db, { text, kind: "program", owner: str(fd, "owner") || null, dueDate: str(fd, "dueDate") || null });
    setAssignments(db, `local:${id}`, scopes);
    return `Program action item added and assigned to ${scopes.length} team${scopes.length === 1 ? "" : "s"}.`;
  });
}

export async function setAssignmentsAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    const parent = str(fd, "parent");
    if (!/^(jira|local):.+/.test(parent)) throw new Error("Unknown program action item.");
    setAssignments(getDb(), parent, scopesFrom(fd));
    return "Assignments updated. Teams that already finished were kept.";
  });
}

export async function updateAssignmentAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    const patch: Parameters<typeof updateAssignment>[2] = {};
    if (fd.has("status")) patch.status = str(fd, "status") === "done" ? "done" : "open";
    if (fd.has("owner")) patch.owner = str(fd, "owner");
    if (fd.has("dueDate")) patch.dueDate = str(fd, "dueDate");
    if (fd.has("note")) patch.note = str(fd, "note");
    updateAssignment(getDb(), Number(str(fd, "id")), patch);
    return patch.status === "done" ? "Marked done for this team." : patch.status === "open" ? "Reopened for this team." : "Saved.";
  });
}

/** All teams finished: close the ask. Jira items get a staged status change + summary comment. */
export async function closeProgramActionAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    const db = getDb();
    const parent = str(fd, "parent");
    const done = listAssignments(db).filter((a) => a.parent === parent && a.status === "done");
    const summary = `Completed by all assigned teams: ${done
      .map((a) => `${a.scope.name}${a.owner ? ` (${a.owner})` : ""}${a.doneAt ? ` on ${a.doneAt.slice(0, 10)}` : ""}`)
      .join("; ")}.`;
    if (parent.startsWith("jira:")) {
      const key = parent.slice(5);
      stageEdit(db, key, "status", getConfig(db).jira.doneStatus || "Done");
      stageEdit(db, key, "comment", summary);
      return `Staged ${key} → Done with a summary comment. Push it from Data & Jira sync.`;
    }
    updateActionItem(db, Number(parent.slice(6)), { status: "done" });
    return "Program action item closed.";
  });
}

export async function updateActionItemAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    const id = Number(str(fd, "id"));
    const patch: Parameters<typeof updateActionItem>[2] = {};
    if (fd.has("status")) patch.status = str(fd, "status") === "done" ? "done" : "open";
    if (fd.has("owner")) patch.owner = str(fd, "owner");
    if (fd.has("dueDate")) patch.dueDate = str(fd, "dueDate");
    if (fd.has("jiraKey")) patch.jiraKey = str(fd, "jiraKey").toUpperCase();
    if (fd.has("subTrack")) patch.subTrack = str(fd, "subTrack");
    if (fd.has("platform")) patch.platform = str(fd, "platform");
    if (fd.has("links")) patch.links = keysFrom(str(fd, "links"));
    updateActionItem(getDb(), id, patch);
    return "Action item updated.";
  });
}

export async function deleteActionItemAction(fd: FormData) {
  await attempt(str(fd, "back") || "/actions", () => {
    deleteActionItem(getDb(), Number(str(fd, "id")));
    return "Action item deleted.";
  });
}

// ---------- Settings ----------

/**
 * Save one Settings section. Inputs are named `cfg.<type>.<path>`:
 * text → string, num → number, list → comma/newline separated array.
 */
export async function saveSettingsSectionAction(fd: FormData) {
  const section = str(fd, "section");
  await attempt(`/settings?section=${encodeURIComponent(section)}`, () => {
    const db = getDb();
    const next = structuredClone(getConfig(db)) as unknown as Record<string, unknown>;
    let n = 0;
    for (const [name, raw] of fd.entries()) {
      const m = name.match(/^cfg\.(text|num|list)\.(.+)$/);
      if (!m || typeof raw !== "string") continue;
      const [, type, path] = m;
      let value: unknown = raw.trim();
      if (type === "num") {
        value = Number(raw);
        if (!Number.isFinite(value as number) || (value as number) < 0) throw new Error(`"${path}" must be a positive number.`);
      } else if (type === "list") {
        value = raw.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
      }
      if (path === "labels.tierPattern") {
        try {
          new RegExp(value as string);
        } catch {
          throw new Error("Tier pattern isn't a valid regular expression.");
        }
      }
      const keys = path.split(".");
      let obj = next;
      for (const k of keys.slice(0, -1)) obj = (obj[k] ??= {}) as Record<string, unknown>;
      obj[keys[keys.length - 1]] = value;
      n++;
    }
    saveConfig(db, next as unknown as AppConfig);
    return `Saved ${n} setting${n === 1 ? "" : "s"}. Re-sync or re-import Jira data to re-classify issues.`;
  });
}

export async function saveSettingsAction(fd: FormData) {
  await attempt("/settings?section=advanced", () => {
    let parsed: AppConfig;
    try {
      parsed = JSON.parse(str(fd, "config"));
    } catch (e) {
      throw new Error(`Settings JSON is invalid: ${e instanceof Error ? e.message : e}`);
    }
    saveConfig(getDb(), parsed);
    return "Settings saved. Re-sync or re-import to re-classify issues.";
  });
}

export async function resetSettingsAction() {
  await attempt("/settings?section=advanced", () => {
    saveConfig(getDb(), DEFAULT_CONFIG);
    return "Settings reset to defaults.";
  });
}

export async function testJiraAction() {
  await attempt("/settings?section=jira", async () => {
    const me = await JiraClient.fromConfig(getConfig(getDb())).myself();
    return `Connected to Jira as ${me.displayName} (${me.name}).`;
  });
}
