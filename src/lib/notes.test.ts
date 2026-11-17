import { deflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { importAttachedNote, importNoteText } from "./connectors";
import { openDb } from "./db";
import { dateFromTitle, docxToText, documentToText, parseGoogleDocId } from "./documents";
import { buildUpdateCsv } from "./jira/exportCsv";
import { editsToRestPayload } from "./jira/client";
import { loadModel } from "./model";
import { suggestJiraUpdates } from "./noteInsights";
import { extractActionItems, findDates } from "./notes";
import { seedDemo } from "./seed";
import { getIssue, getNote, listActionItems, listPendingEdits, markEditsPushed, stageEdit } from "./store";

/** Minimal zip writer (no CRC checks needed by our reader). */
function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const DOCX_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Weekly sync</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">BIGP-31 slipped to </w:t></w:r><w:r><w:t>12/20/2026 &amp; rebaselined</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Action items</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Priya Shah will confirm token format</w:t></w:r></w:p>
</w:body></w:document>`;

describe("documents", () => {
  test("docx (deflated and stored) → text with headings and bullets", () => {
    for (const deflate of [true, false]) {
      const text = docxToText(zip({ "[Content_Types].xml": "<x/>", "word/document.xml": DOCX_XML }, deflate));
      expect(text).toBe("# Weekly sync\nBIGP-31 slipped to 12/20/2026 & rebaselined\n# Action items\n- Priya Shah will confirm token format");
      expect(extractActionItems(text)).toEqual([
        { text: "Priya Shah will confirm token format", owner: "Priya Shah", dueDate: null },
      ]);
    }
  });

  test("google doc ids, html export, title dates", () => {
    expect(parseGoogleDocId("https://docs.google.com/document/d/1AbC_dEfGhIjKlMnOpQrStUvWxYz012345/edit?tab=t.0")).toBe(
      "1AbC_dEfGhIjKlMnOpQrStUvWxYz012345",
    );
    expect(parseGoogleDocId("https://example.com/x")).toBeNull();
    expect(documentToText("n.html", Buffer.from("<html><body><h2>Next steps</h2><ul><li>Sam to send deck</li></ul></body></html>"))).toBe(
      "Next steps\n- Sam to send deck",
    );
    expect(dateFromTitle("Digital sync - 2026/11/12 10:00 EST - Notes by Gemini")).toBe("2026-11-12");
    expect(dateFromTitle("Standup Nov 3, 2026")).toBe("2026-11-03");
    expect(dateFromTitle("Standup")).toBeNull();
  });
});

describe("extraction", () => {
  test("Gemini-style next steps section and checkbox glyphs", () => {
    const body = [
      "Summary",
      "We talked about stuff.",
      "",
      "Suggested next steps",
      "☐ Jordan Kim will draft mitigation options",
      "☐ Ask finance about devices by 12/1",
      "☑ Already handled",
      "",
      "Details",
      "Not an action item",
    ].join("\n");
    expect(extractActionItems(body, 2026)).toEqual([
      { text: "Jordan Kim will draft mitigation options", owner: "Jordan Kim", dueDate: null },
      { text: "Ask finance about devices by 12/1", owner: null, dueDate: "2026-12-01" },
    ]);
  });

  test("finds dates in several formats", () => {
    expect(findDates("moved from 12/5 to Jan 10th, 2027 (was 2026-11-30)", 2026).sort()).toEqual([
      "2026-11-30",
      "2026-12-05",
      "2027-01-10",
    ]);
  });
});

describe("jira suggestions from notes", () => {
  const db = openDb(":memory:");
  seedDemo(db);
  const m = loadModel(db);

  test("dates, status and comments", () => {
    const s = suggestJiraUpdates(
      [
        "- BIGP-31 slipped to 2027-02-01",
        "- BIGP-30 start moved to 2026-12-01",
        "- BIGP-112 load testing kicked off",
        "- BIGP-160 is not done yet, target 2027-01-05",
        "- BIGP-110 shipped", // already done in Jira → no status suggestion
        "- Discussed BIGP-100 and VIEW-50 together",
        "- NOPE-1 is unknown and ignored",
      ].join("\n"),
      { title: "Sync", meetingDate: "2026-11-14" },
      m.byKey,
    );
    const pick = (key: string, field: string) => s.find((x) => x.key === key && x.field === field);
    expect(pick("BIGP-31", "dueDate")?.value).toBe("2027-02-01");
    expect(pick("BIGP-30", "startDate")?.value).toBe("2026-12-01");
    expect(pick("BIGP-112", "status")?.value).toBe("In Progress");
    expect(pick("BIGP-160", "status")).toBeUndefined(); // negated
    expect(pick("BIGP-160", "dueDate")?.value).toBe("2027-01-05");
    expect(pick("BIGP-110", "status")).toBeUndefined();
    expect(pick("BIGP-100", "dueDate")).toBeUndefined(); // two keys on the line → comments only
    expect(pick("VIEW-50", "comment")?.value).toContain('Discussed in meeting notes "Sync" (Nov 14, 2026):\n- Discussed BIGP-100 and VIEW-50 together');
    expect(s.some((x) => x.key === "NOPE-1")).toBe(false);
  });

  test("comments stage, export as Comment Body, push via REST, never overwrite fields", () => {
    stageEdit(db, "BIGP-31", "comment", "hello");
    stageEdit(db, "BIGP-31", "comment", "hello"); // duplicate ignored
    stageEdit(db, "BIGP-31", "dueDate", "2027-02-01");
    const edits = listPendingEdits(db, { unpushedOnly: true });
    expect(edits.filter((e) => e.field === "comment")).toHaveLength(1);
    expect(getIssue(db, "BIGP-31")!.pendingFields.sort()).toEqual(["comment", "dueDate"]);

    const { csv } = buildUpdateCsv(edits, loadModel(db).issues, m.cfg);
    expect(csv.split("\r\n")[0]).toBe("Issue Key,Summary,Due Date,Comment Body");
    expect(editsToRestPayload(edits, m.cfg)).toMatchObject({ comments: ["hello"], fields: { duedate: "2027-02-01" } });

    const summary = getIssue(db, "BIGP-31")!.summary;
    markEditsPushed(db, edits.map((e) => e.id), "csv");
    expect(getIssue(db, "BIGP-31")!.summary).toBe(summary);
    stageEdit(db, "BIGP-31", "comment", "hello"); // already pushed → still not re-added
    expect(listPendingEdits(db, { unpushedOnly: true })).toHaveLength(0);
  });
});

describe("note import", () => {
  test("re-importing a linked doc updates it and only adds new action items", () => {
    const db = openDb(":memory:");
    const a = importNoteText(db, { title: "Running notes", body: "AI: one", source: "gdoc:abc", sourceUrl: "u" });
    const b = importNoteText(db, { title: "Running notes", body: "AI: one\nAI: two", source: "gdoc:abc", sourceUrl: "u" });
    expect(b).toMatchObject({ noteId: a.noteId, actions: 1, updated: true });
    expect(listActionItems(db).map((x) => x.text)).toEqual(["one", "two"]);
    expect(getNote(db, a.noteId)!.body).toContain("two");
  });

  test("attached file is stored next to the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(dir, "app.db");
    try {
      const db = openDb(":memory:");
      const r = importAttachedNote(db, { name: "Sync 2026-11-12.txt", bytes: Buffer.from("TODO: thing") });
      const note = getNote(db, r.noteId)!;
      expect(note).toMatchObject({ title: "Sync 2026-11-12", meetingDate: "2026-11-12", attachmentName: "Sync 2026-11-12.txt" });
      expect(note.attachmentPath!.startsWith(join(dir, "attachments"))).toBe(true);
      expect(readFileSync(note.attachmentPath!, "utf8")).toBe("TODO: thing");
    } finally {
      process.env.DATABASE_PATH = prev;
    }
  });
});
