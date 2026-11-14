"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_CONFIG, getConfig, saveConfig, type AppConfig } from "@/lib/config";
import {
  fetchSheetCsv,
  importConfluencePage,
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
  addActionItem,
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
import { EDITABLE_FIELDS, type EditableField } from "@/lib/types";

// NOTE: this app is meant to run locally (localhost) for a single user, so
// server actions don't authenticate. Add auth before hosting it anywhere shared.

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function done(path: string, msg: string, ok = true): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${ok ? "msg" : "err"}=${encodeURIComponent(msg)}`);
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
  const back = `/items/${encodeURIComponent(key)}`;
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
        const { fields, status } = editsToRestPayload(list, cfg);
        if (Object.keys(fields).length) await client.updateFields(key, fields);
        if (status) await client.transitionTo(key, status);
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
    });
    return `Note saved. Found ${r.actions} action item(s).`;
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

export async function addActionItemAction(fd: FormData) {
  await attempt("/actions", () => {
    const text = str(fd, "text");
    if (!text) throw new Error("Action item text is empty.");
    addActionItem(getDb(), {
      text,
      owner: str(fd, "owner") || null,
      dueDate: str(fd, "dueDate") || null,
      subTrack: str(fd, "subTrack") || null,
    });
    return "Action item added.";
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
    updateActionItem(getDb(), id, patch);
    return "Action item updated.";
  });
}

export async function deleteActionItemAction(fd: FormData) {
  await attempt("/actions", () => {
    deleteActionItem(getDb(), Number(str(fd, "id")));
    return "Action item deleted.";
  });
}

// ---------- Settings ----------

export async function saveSettingsAction(fd: FormData) {
  await attempt("/settings", () => {
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
  await attempt("/settings", () => {
    saveConfig(getDb(), DEFAULT_CONFIG);
    return "Settings reset to defaults.";
  });
}

export async function testJiraAction() {
  await attempt("/settings", async () => {
    const me = await JiraClient.fromConfig(getConfig(getDb())).myself();
    return `Connected to Jira as ${me.displayName} (${me.name}).`;
  });
}
