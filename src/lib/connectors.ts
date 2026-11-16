import type { DatabaseSync } from "node:sqlite";
import { getConfig, type AppConfig } from "./config";
import { csvRecords } from "./csv";
import { nowIso, todayIso } from "./db";
import { dateFromTitle, documentToText, fetchGoogleDoc, storeAttachment } from "./documents";
import { toIsoDate } from "./jira/classify";
import { JiraClient } from "./jira/client";
import { normalizeIssue } from "./jira/normalize";
import { loadModel } from "./model";
import { createHash } from "node:crypto";
import { buildItemMatcher, contentLines, meetingDates, noteSections, normText } from "./noteMatch";
import { confluenceStorageToText, extractActionItems, normaliseActionText } from "./notes";
import type { Note } from "./types";
import {
  addActionItem,
  addNote,
  addNoteLinks,
  listNotes,
  logNoteImport,
  setAutoNoteRefs,
  setNoteHash,
  ensureAutoAssignments,
  findNoteBySource,
  getNote,
  listActionItems,
  listLinks,
  logSync,
  setNoteAttachment,
  updateNoteContent,
  upsertIssues,
  type NoteInput,
} from "./store";

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
    ensureAutoAssignments(db);
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
      meetingDate: dateFromTitle(page.title) ?? todayIso(),
      source: `confluence:${id}`,
      sourceUrl: `${base}/pages/viewpage.action?pageId=${id}`,
    });
    logSync(db, "confluence", true, `Imported "${page.title}" with ${result.actions} action items`, startedAt);
    return result;
  } catch (e) {
    logSync(db, "confluence", false, e instanceof Error ? e.message : String(e), startedAt);
    throw e;
  }
}

export type NoteImportResult = {
  noteId: number;
  /** created: new note. updated: an existing note grew (running doc, newer copy). duplicate: already had it. unchanged: same source, same text. */
  status: "created" | "updated" | "duplicate" | "unchanged";
  title: string;
  actions: number;
  found: number;
  /** Kept for older callers: true unless a new note was created. */
  updated: boolean;
};

/** Fingerprint of a note's text that ignores case, spacing and bullet styles. */
export function noteHash(body: string) {
  return createHash("sha256").update(normText(body.replace(/^\s*(?:[-*•☐☑]|\[[ x]\])\s*/gim, ""))).digest("hex");
}

/**
 * Find an existing note that this text is a copy or a newer version of.
 * - the same text (same file re-uploaded, or someone else's copy): duplicate
 * - this text contains nearly all of an existing note's lines and more
 *   (a running notes doc downloaded again later): newer version of it
 * - nearly all of this text is already in an existing note (an older copy): duplicate
 */
export function findSameNotes(notes: Note[], body: string): { note: Note; relation: "same" | "newer" | "older" } | null {
  const hash = noteHash(body);
  const exact = notes.find((n) => (n.contentHash ?? noteHash(n.body)) === hash);
  if (exact) return { note: exact, relation: "same" };
  const mine = contentLines(body);
  if (mine.size < 4) return null;
  let best: { note: Note; relation: "newer" | "older"; score: number } | null = null;
  for (const n of notes) {
    const theirs = contentLines(n.body);
    if (theirs.size < 4) continue;
    let shared = 0;
    for (const l of theirs) if (mine.has(l)) shared++;
    const ofTheirs = shared / theirs.size;
    const ofMine = shared / mine.size;
    if (ofMine >= 0.9 && ofMine >= ofTheirs) {
      if (!best || ofMine > best.score) best = { note: n, relation: "older", score: ofMine };
    } else if (ofTheirs >= 0.8) {
      if (!best || ofTheirs > best.score) best = { note: n, relation: "newer", score: ofTheirs };
    }
  }
  return best && { note: best.note, relation: best.relation };
}

/**
 * Save meeting notes, link them to the work they discuss, and extract action items.
 *
 * Notes are never stored twice:
 * - A Google Doc or Confluence page is matched on its id. Re-importing it (or
 *   Refresh) updates the note in place, which suits running notes docs.
 * - Uploaded or pasted notes are matched on their content, so the same file
 *   uploaded again, by you or someone else, is recognised. A later download of
 *   a running notes doc replaces the older copy instead of adding a second one.
 * - Action items are only added if the same item (by its wording) isn't
 *   already tracked, from this note or any other.
 */
export function importNoteText(db: DatabaseSync, n: NoteInput & { links?: string[]; via?: string }): NoteImportResult {
  const via = n.via ?? (n.source?.startsWith("gdoc:") ? "Google Doc" : n.source?.startsWith("confluence:") ? "Confluence" : n.source === "upload" ? "upload" : "pasted");
  const year = n.meetingDate ? Number(n.meetingDate.slice(0, 4)) : new Date().getFullYear();
  // A running notes doc's meeting date is its latest meeting.
  const meetingDate = meetingDates(n.body, year)[0] ?? n.meetingDate ?? null;
  const hash = noteHash(n.body);

  const bySource = n.source && !["manual", "upload"].includes(n.source) ? findNoteBySource(db, n.source) : null;
  const same = bySource ? null : findSameNotes(listNotes(db), n.body);

  let noteId: number;
  let status: NoteImportResult["status"];
  if (bySource) {
    noteId = bySource.id;
    status = (bySource.contentHash ?? noteHash(bySource.body)) === hash ? "unchanged" : "updated";
    if (status === "updated") updateNoteContent(db, noteId, { ...n, meetingDate });
  } else if (same && same.relation !== "newer") {
    noteId = same.note.id;
    status = "duplicate";
  } else if (same) {
    noteId = same.note.id;
    status = "updated";
    updateNoteContent(db, noteId, { ...n, title: same.note.title, meetingDate });
  } else {
    noteId = addNote(db, { ...n, meetingDate });
    status = "created";
  }
  if (status === "created" || status === "updated") setNoteHash(db, noteId, hash);
  const note = getNote(db, noteId)!;
  logNoteImport(
    db,
    noteId,
    via,
    status,
    status === "duplicate" ? `Matched existing notes "${note.title}"${same?.relation === "older" ? " (an older copy)" : ""}` : (n.attachmentName ?? null),
  );
  if (n.links?.length) addNoteLinks(db, noteId, n.links);
  if (status === "duplicate" || status === "unchanged") {
    return { noteId, status, title: note.title, actions: 0, found: 0, updated: true };
  }

  // What the notes are about.
  const ctx = actionContext(db);
  const refs: { key: string; line: string }[] = [];
  for (const s of noteSections(n.body, year)) {
    if (s.heading) continue;
    for (const mt of ctx.match(s.line)) refs.push({ key: mt.key, line: s.line });
  }
  setAutoNoteRefs(db, noteId, refs);

  // Action items, skipping any already tracked anywhere.
  const found = extractActionItems(n.body, year, ctx.teams);
  const have = new Set(listActionItems(db).map((a) => normaliseActionText(a.text)));
  let added = 0;
  for (const { team, ...a } of found) {
    const k = normaliseActionText(a.text);
    if (have.has(k)) continue;
    have.add(k);
    const given = {
      subTrack: n.subTrack || (team && ctx.isSubTrack(team) ? team : null),
      platform: n.platform || (team && !ctx.isSubTrack(team) ? team : null),
    };
    addActionItem(db, { ...a, noteId, ...ctx.scopeFor(a.text, given) });
    added++;
  }
  return { noteId, status, title: note.title, actions: added, found: found.length, updated: status !== "created" };
}

/**
 * Work out what an action item is about: the Jira keys it mentions (links),
 * and which platform / sub-track owns it. The note's own team wins; otherwise
 * a platform named in the text, otherwise the linked issue's team.
 */
export function actionContext(db: DatabaseSync) {
  const m = loadModel(db);
  const platformNames = m.platforms;
  const match = buildItemMatcher(m.issues);
  return {
    teams: [...m.subTracks, ...m.platforms],
    isSubTrack: (name: string) => m.subTracks.includes(name),
    match,
    scopeFor(text: string, given: { subTrack?: string | null; platform?: string | null }) {
      const links = match(text).map((x) => x.key);
      const named = platformNames.filter((p) => new RegExp(`(^|[^A-Za-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(text));
      const fromLinks = (pick: (k: string) => string | null | undefined) => {
        const vals = [...new Set(links.map(pick).filter((v): v is string => !!v))];
        return vals.length === 1 ? vals[0] : null;
      };
      return {
        links,
        platform:
          given.platform ||
          (named.length === 1 ? named[0] : null) ||
          fromLinks((k) => {
            const ps = m.platformsOf.get(k) ?? [];
            return ps.length === 1 ? ps[0] : null;
          }),
        subTrack: given.subTrack || fromLinks((k) => m.subTrackOf.get(k)),
      };
    },
  };
}

// ---------------- Google Docs & attached files ----------------

export async function importGoogleDoc(
  db: DatabaseSync,
  url: string,
  opts: { subTrack?: string | null; platform?: string | null; links?: string[] } = {},
) {
  const startedAt = nowIso();
  try {
    const doc = await fetchGoogleDoc(url);
    const r = importNoteText(db, {
      title: doc.title,
      body: doc.text,
      meetingDate: dateFromTitle(doc.title) ?? doc.modifiedTime?.slice(0, 10) ?? todayIso(),
      source: `gdoc:${doc.id}`,
      sourceUrl: doc.url,
      subTrack: opts.subTrack ?? null,
      platform: opts.platform ?? null,
      links: opts.links,
    });
    logSync(db, "google-docs", true, `${r.status} "${doc.title}": ${r.actions} new action items`, startedAt);
    return r;
  } catch (e) {
    logSync(db, "google-docs", false, e instanceof Error ? e.message : String(e), startedAt);
    throw e;
  }
}

/** A downloaded notes file (.docx/.txt/.md/.html). The original is kept next to the database. */
export function importAttachedNote(
  db: DatabaseSync,
  f: {
    name: string;
    bytes: Buffer;
    title?: string;
    meetingDate?: string | null;
    subTrack?: string | null;
    platform?: string | null;
    links?: string[];
  },
): NoteImportResult {
  const body = documentToText(f.name, f.bytes);
  if (!body.trim()) throw new Error(`No text found in ${f.name}.`);
  const title = f.title?.trim() || f.name.replace(/\.[^.]+$/, "");
  const r = importNoteText(db, {
    title,
    body,
    meetingDate: f.meetingDate || dateFromTitle(title) || todayIso(),
    source: "upload",
    attachmentName: f.name,
    subTrack: f.subTrack ?? null,
    platform: f.platform ?? null,
    links: f.links,
  });
  // Keep the newest copy of the file; a duplicate upload stores nothing.
  if (r.status === "created" || r.status === "updated") {
    setNoteAttachment(db, r.noteId, f.name, storeAttachment(r.noteId, f.name, f.bytes));
  }
  logSync(db, "notes-upload", true, `${r.status} "${f.name}": ${r.actions} action items`, nowIso());
  return r;
}

/** Re-pull a note from its Google Doc or Confluence page. */
export async function refreshNote(db: DatabaseSync, id: number) {
  const note = getNote(db, id);
  if (!note) throw new Error("Note not found.");
  if (note.source.startsWith("gdoc:")) {
    return importGoogleDoc(db, note.sourceUrl ?? note.source.slice(5), { subTrack: note.subTrack, platform: note.platform });
  }
  if (note.source.startsWith("confluence:")) return importConfluencePage(db, note.source.slice(11));
  throw new Error("This note wasn't imported from a linked source, so there's nothing to refresh.");
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
