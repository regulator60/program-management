import { describe, expect, test } from "vitest";
import { importAttachedNote, importNoteText } from "./connectors";
import { openDb } from "./db";
import { itemContext } from "./context";
import { loadModel } from "./model";
import { buildItemMatcher, meetingDates } from "./noteMatch";
import { suggestJiraUpdates } from "./noteInsights";
import { seedDemo } from "./seed";
import { handledNoteSuggestions, listActionItems, listNoteImports, listNotes, markNoteSuggestions, setNoteLinks } from "./store";

const running = (extra: string[] = []) =>
  [
    "Dashboard weekly sync – running notes",
    "",
    ...extra,
    "Nov 9, 2026",
    "- Balances API v3 slipped to Jan 10",
    "- AI: Jordan to draft re-plan options by Nov 20",
    "- Token service is in progress, Priya on it",
    "",
  ].join("\n");

function fresh() {
  const db = openDb(":memory:");
  seedDemo(db);
  return db;
}

describe("matching notes to work", () => {
  test("finds items by name, not just by key, and ignores ambiguous names", () => {
    const db = fresh();
    const m = loadModel(db);
    const match = buildItemMatcher(m.issues);
    expect(match("View Account Balances API v3 moved out again").map((x) => x.key)).toEqual(["VIEW-50"]);
    expect(match("Token service slipped a week").map((x) => x.key)).toContain("BIGP-100");
    expect(match("BIGP-31 and the weather").map((x) => x.key)).toEqual(["BIGP-31"]);
    expect(match("General chat about nothing in particular")).toEqual([]);
  });

  test("older meetings, action items and finished sub-steps don't produce changes", () => {
    const m = loadModel(fresh());
    const body = [
      "Nov 16, 2026",
      "- Balances API v3: View Account still can't commit; escalating",
      "- AI: Jordan to draft re-plan options for Dashboard GA by Nov 21",
      "- Dashboard web experience design review done",
      "Nov 9, 2026",
      "- Balances API v3 slipped to Dec 31",
    ].join("\n");
    const s = suggestJiraUpdates(body, { title: "x", meetingDate: "2026-11-16" }, m.byKey);
    expect(s.filter((x) => x.field !== "comment")).toEqual([]);
    expect(s.filter((x) => x.field === "comment").map((x) => x.key).sort()).toEqual(["BIGP-104", "BIGP-11", "VIEW-50"]);
  });

  test("a hand-off to QA is not reported as done", () => {
    const m = loadModel(fresh());
    const s = suggestJiraUpdates("- Token service shipped to QA\n- Accounts aggregation API shipped", { title: "x", meetingDate: "2026-11-16" }, m.byKey);
    expect(s.find((x) => x.key === "BIGP-100" && x.field === "status")).toBeUndefined();
    expect(s.find((x) => x.key === "BIGP-103" && x.field === "status")?.value).toBe("Done");
  });

  test("suggests a date from a name match, and the newest meeting wins in running notes", () => {
    const db = fresh();
    const m = loadModel(db);
    const body = running(["Nov 16, 2026", "- Balances API v3 now Jan 30", ""]);
    expect(meetingDates(body, 2026)).toEqual(["2026-11-16", "2026-11-09"]);
    const s = suggestJiraUpdates(body, { title: "Running notes", meetingDate: "2026-11-16", sourceUrl: "https://docs.google.com/document/d/x/edit" }, m.byKey);
    const due = s.filter((x) => x.key === "VIEW-50" && x.field === "dueDate");
    expect(due).toHaveLength(1);
    expect(due[0].value).toBe("2027-01-30");
    const comment = s.find((x) => x.key === "VIEW-50" && x.field === "comment")!;
    expect(comment.lines).toHaveLength(2);
    expect(comment.value).toContain("Full notes: https://docs.google.com/document/d/x/edit");
  });

  test("staged or dismissed suggestions are not offered again", () => {
    const db = fresh();
    const m = loadModel(db);
    const meta = { title: "N", meetingDate: "2026-11-09" };
    const first = suggestJiraUpdates(running(), meta, m.byKey);
    const c = first.find((x) => x.key === "VIEW-50" && x.field === "comment")!;
    markNoteSuggestions(db, 1, c.sigs, "staged");
    const again = suggestJiraUpdates(running(["Nov 16, 2026", "- Balances API v3 needs an exec escalation", ""]), meta, m.byKey, {
      handled: handledNoteSuggestions(db),
    });
    const c2 = again.find((x) => x.key === "VIEW-50" && x.field === "comment")!;
    expect(c2.lines).toEqual(["Balances API v3 needs an exec escalation"]); // only the new line
  });
});

describe("no duplicates", () => {
  test("the same file uploaded twice (or by someone else) is recognised", () => {
    const db = fresh();
    const before = listNotes(db).length;
    const a = importAttachedNote(db, { name: "sync.txt", bytes: Buffer.from(running()) });
    const b = importAttachedNote(db, { name: "my copy of sync.txt", bytes: Buffer.from(running().replace(/- /g, "* ")) });
    expect(a.status).toBe("created");
    expect(b.status).toBe("duplicate");
    expect(b.noteId).toBe(a.noteId);
    expect(listNotes(db).length).toBe(before + 1);
    expect(listNoteImports(db).get(a.noteId)!.map((i) => i.result)).toEqual(["duplicate", "created"]);
  });

  test("a running notes doc downloaded again later updates the same note and only adds new actions", () => {
    const db = fresh();
    const a = importNoteText(db, { title: "Dashboard sync", body: running(), source: "upload" });
    const actions = listActionItems(db).length;
    const newer = running(["Nov 16, 2026", "- Action: Ana to book the pilot readiness review by Nov 30", "- Balances API v3 needs an exec escalation", ""]);
    const b = importNoteText(db, { title: "Dashboard sync (1)", body: newer, source: "upload" });
    expect(b.status).toBe("updated");
    expect(b.noteId).toBe(a.noteId);
    expect(b.actions).toBe(1);
    expect(listActionItems(db).length).toBe(actions + 1);
    expect(listNotes(db).find((n) => n.id === a.noteId)!.meetingDate).toBe("2026-11-16");
    // The older copy uploaded afterwards is a duplicate.
    expect(importNoteText(db, { title: "old", body: running(), source: "upload" }).status).toBe("duplicate");
  });

  test("the same action item from two different people's notes is tracked once", () => {
    const db = fresh();
    importNoteText(db, { title: "Priya's notes", body: "Standup\n- AI: Jordan to draft re-plan options by Nov 20\n- misc" });
    const r = importNoteText(db, { title: "Sam's notes", body: "Different meeting\n- AI: Jordan to draft re-plan options by Nov 20\n- other" });
    expect(r.status).toBe("created");
    expect(r.actions).toBe(0);
  });

  test("a Google Doc re-imported without changes is reported as unchanged", () => {
    const db = fresh();
    const a = importNoteText(db, { title: "Doc", body: running(), source: "gdoc:abc", sourceUrl: "https://docs.google.com/document/d/abc/edit" });
    const b = importNoteText(db, { title: "Doc", body: running(), source: "gdoc:abc", sourceUrl: "https://docs.google.com/document/d/abc/edit" });
    expect([a.status, b.status]).toEqual(["created", "unchanged"]);
  });
});

describe("linked work", () => {
  test("notes link to items by name; removing a link sticks; item pages see the lines", () => {
    const db = fresh();
    const r = importNoteText(db, { title: "Sync", body: running(), links: ["BIGP-11"] });
    let note = listNotes(db).find((n) => n.id === r.noteId)!;
    const keys = (n: typeof note) => [...new Set(n.refs!.filter((x) => x.kind !== "excluded").map((x) => x.key))].sort();
    expect(keys(note)).toEqual(expect.arrayContaining(["BIGP-100", "BIGP-11", "VIEW-50"]));

    const ctx = itemContext(["VIEW-50"], { actions: [], notes: listNotes(db), updates: [] }, "2026-11-16");
    expect(ctx.mentions.some((x) => x.line === "Balances API v3 slipped to Jan 10")).toBe(true);

    setNoteLinks(db, r.noteId, ["BIGP-11", "VIEW-50"]); // drop BIGP-100
    importNoteText(db, { title: "Sync", body: running(["Nov 16, 2026", "- Token service done", ""]) });
    note = listNotes(db).find((n) => n.id === r.noteId)!;
    expect(keys(note)).not.toContain("BIGP-100");
  });
});
