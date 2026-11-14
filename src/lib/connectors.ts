import type { DatabaseSync } from "node:sqlite";
import { getConfig, type AppConfig } from "./config";
import { csvRecords } from "./csv";
import { nowIso } from "./db";
import { toIsoDate } from "./jira/classify";
import { JiraClient } from "./jira/client";
import { normalizeIssue } from "./jira/normalize";
import { confluenceStorageToText, extractActionItems } from "./notes";
import { addActionItem, addNote, listLinks, logSync, upsertIssues } from "./store";

// ---------------- Jira ----------------

/**
 * Full pull: scope JQL (your track) + intake JQL (program action items),
 * then one hop of linked issues so dependencies on other tracks have dates.
 */
export async function syncJira(db: DatabaseSync): Promise<string> {
  const cfg = getConfig(db);
  const startedAt = nowIso();
  try {
    const client = JiraClient.fromConfig(cfg);
    const syncedAt = nowIso();
    const scope = await client.search(cfg.jira.scopeJql, cfg);
    const intake = cfg.jira.intakeJql.trim() ? await client.search(cfg.jira.intakeJql, cfg) : [];
    const scopeKeys = new Set(scope.map((i) => i.key));
    const items = [
      ...scope.map((r) => normalizeIssue(r, cfg, { inScope: true, syncedAt })),
      ...intake
        .filter((r) => !scopeKeys.has(r.key))
        .map((r) => normalizeIssue(r, cfg, { inScope: false, syncedAt })),
    ];
    const have = new Set(items.map((i) => i.issue.key));
    const linked = new Set<string>();
    for (const { issue, links } of items) {
      for (const l of links) for (const k of [l.fromKey, l.toKey]) if (!have.has(k)) linked.add(k);
      if (issue.parentKey && !have.has(issue.parentKey)) linked.add(issue.parentKey);
    }
    const external = linked.size ? await client.getByKeys([...linked], cfg) : [];
    items.push(...external.map((r) => normalizeIssue(r, cfg, { inScope: false, syncedAt })));
    const res = upsertIssues(db, items);
    const msg = `Jira sync: ${scope.length} in scope, ${intake.length} intake, ${external.length} linked. ${res.inserted} new, ${res.updated} updated, ${res.changes} field changes detected.`;
    logSync(db, "jira", true, msg, startedAt);
    return msg;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSync(db, "jira", false, msg, startedAt);
    throw e;
  }
}

/** Keys referenced by links/parents that we don't have locally (useful for a follow-up JQL). */
export function missingLinkedKeys(db: DatabaseSync): string[] {
  const keys = new Set(
    (db.prepare("SELECT key FROM issues").all() as { key: string }[]).map((r) => r.key),
  );
  const missing = new Set<string>();
  for (const l of listLinks(db)) for (const k of [l.fromKey, l.toKey]) if (!keys.has(k)) missing.add(k);
  return [...missing].sort();
}

// ---------------- Confluence ----------------

/** Accepts a page id or a URL containing pageId=123 or /pages/123/. */
export function parseConfluencePageId(input: string): string | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/pageId=(\d+)/) ?? s.match(/\/pages\/(\d+)/);
  return m ? m[1] : null;
}

export async function importConfluencePage(db: DatabaseSync, input: string, cfg: AppConfig = getConfig(db)) {
  const startedAt = nowIso();
  try {
    const id = parseConfluencePageId(input);
    if (!id) throw new Error("Couldn't find a page id. Paste the page id or a URL with ?pageId=…");
    if (!cfg.confluence.baseUrl) throw new Error("Confluence base URL is not set (Settings).");
    const token = process.env.CONFLUENCE_PAT ?? process.env.JIRA_PAT;
    if (!token) throw new Error("Set CONFLUENCE_PAT in .env.local.");
    const base = cfg.confluence.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/rest/api/content/${id}?expand=body.storage,version`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Confluence → ${res.status} ${res.statusText}`);
    const page = (await res.json()) as { title: string; body?: { storage?: { value?: string } } };
    const result = importNoteText(db, {
      title: page.title,
      body: confluenceStorageToText(page.body?.storage?.value ?? ""),
      source: `confluence:${id}`,
    });
    logSync(db, "confluence", true, `Imported "${page.title}" with ${result.actions} action items`, startedAt);
    return result;
  } catch (e) {
    logSync(db, "confluence", false, e instanceof Error ? e.message : String(e), startedAt);
    throw e;
  }
}

/** Save a note and auto-extract its action items. */
export function importNoteText(
  db: DatabaseSync,
  n: { title: string; body: string; meetingDate?: string | null; source?: string; subTrack?: string | null },
) {
  const noteId = addNote(db, n);
  const year = n.meetingDate ? Number(n.meetingDate.slice(0, 4)) : new Date().getFullYear();
  const found = extractActionItems(n.body, year);
  for (const a of found) addActionItem(db, { ...a, noteId, subTrack: n.subTrack ?? null });
  return { noteId, actions: found.length };
}

// ---------------- Google Sheets ----------------

/**
 * Turn a Google Sheets URL into its CSV export URL. Works when the sheet is
 * shared "anyone with the link" or published; otherwise download as CSV and upload.
 */
export function sheetsCsvUrl(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

export async function fetchSheetCsv(url: string): Promise<string> {
  const csvUrl = sheetsCsvUrl(url) ?? url;
  const res = await fetch(csvUrl, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`Google Sheets → ${res.status}. Is the sheet shared or published?`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("Got a login page instead of CSV. Share the sheet by link, or download as CSV and upload it.");
  }
  return text;
}

export type SheetTarget = "action_items" | "subtrack_map";

/**
 * Sheet imports:
 *  - action_items: columns Action/Item/Task, Owner, Due, Status, Sub-track, Jira
 *  - subtrack_map: columns Key (Jira key), Sub-track, Platform — overrides what Jira says
 */
export function importSheetRows(db: DatabaseSync, csv: string, target: SheetTarget) {
  const recs = csvRecords(csv);
  const get = (s: Record<string, string>, ...names: string[]) => {
    const lower = Object.fromEntries(Object.entries(s).map(([k, v]) => [k.toLowerCase().trim(), v]));
    for (const n of names) if (lower[n]) return lower[n];
    return "";
  };
  let count = 0;
  if (target === "action_items") {
    for (const { single: s } of recs) {
      const text = get(s, "action", "action item", "item", "task", "description", "summary");
      if (!text) continue;
      const status = get(s, "status").toLowerCase();
      addActionItem(db, {
        text,
        owner: get(s, "owner", "assignee", "who") || null,
        dueDate: toIsoDate(get(s, "due", "due date", "by", "when")),
        status: /done|closed|complete/.test(status) ? "done" : "open",
        subTrack: get(s, "sub-track", "subtrack", "sub track", "track") || null,
        jiraKey: get(s, "jira", "jira key", "key", "issue") || null,
      });
      count++;
    }
  } else {
    const upd = db.prepare("UPDATE issues SET sub_track = COALESCE(?, sub_track) WHERE key = ?");
    const updPlat = db.prepare("UPDATE issues SET platforms = ? WHERE key = ?");
    for (const { single: s } of recs) {
      const key = get(s, "key", "jira key", "issue key", "jira");
      if (!key) continue;
      const st = get(s, "sub-track", "subtrack", "sub track") || null;
      const r = upd.run(st, key);
      const plat = get(s, "platform", "domain");
      if (plat) updPlat.run(JSON.stringify(plat.split(/[;,]/).map((p) => p.trim()).filter(Boolean)), key);
      if (Number(r.changes) > 0) count++;
    }
  }
  logSync(db, "sheets", true, `Imported ${count} rows into ${target}`, nowIso());
  return count;
}
