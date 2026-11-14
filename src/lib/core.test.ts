import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { importNoteText, sheetsCsvUrl, parseConfluencePageId } from "./connectors";
import { parseCsv } from "./csv";
import { openDb } from "./db";
import { linkDirection } from "./dependencies";
import { filterTree, flattenTree } from "./hierarchy";
import { classifyLevel, platformsFromLabels, toIsoDate } from "./jira/classify";
import { buildUpdateCsv } from "./jira/exportCsv";
import { csvToRaw } from "./jira/fileImport";
import { normalizeIssue } from "./jira/normalize";
import { groupReport, loadModel } from "./model";
import { confluenceStorageToText, extractActionItems } from "./notes";
import { seedDemo } from "./seed";
import { listActionItems, listChanges, listPendingEdits, markEditsPushed, stageEdit, upsertIssues, getIssue } from "./store";

const cfg = DEFAULT_CONFIG;

describe("classification", () => {
  test("interim milestones split on Intent label", () => {
    expect(classifyLevel("Interim Path Milestone", ["Intent"], cfg)).toBe("ipm_intent");
    expect(classifyLevel("Interim Path Milestone", [], cfg)).toBe("ipm");
    expect(classifyLevel("Critical Path Milestone", [], cfg)).toBe("cpm");
    expect(classifyLevel("Story", [], cfg)).toBe("story");
  });
  test("platforms from Domain labels", () => {
    expect(platformsFromLabels(["Domain:iOS", "Domain: Web", "domain-Card_Services", "other"], cfg)).toEqual([
      "iOS",
      "Web",
      "Card Services",
    ]);
  });
  test("dates in Jira formats", () => {
    expect(toIsoDate("14/Nov/26 10:00 AM")).toBe("2026-11-14");
    expect(toIsoDate("2026-03-02T10:00:00.000-0500")).toBe("2026-03-02");
    expect(toIsoDate("")).toBeNull();
  });
});

describe("jira normalisation", () => {
  test("links are stored in outward direction", () => {
    const { issue, links } = normalizeIssue(
      {
        key: "A-1",
        fields: {
          issuetype: { name: "Risk" },
          labels: ["Tier-2"],
          status: { name: "Open", statusCategory: { key: "new" } },
          issuelinks: [
            { type: { name: "Blocks", outward: "blocks", inward: "is blocked by" }, inwardIssue: { key: "B-1" } },
            { type: { name: "Milestone", outward: "contains", inward: "is contained by" }, outwardIssue: { key: "C-1" } },
          ],
        },
      },
      cfg,
      { inScope: true, syncedAt: "x" },
    );
    expect(issue.tier).toBe(2);
    expect(links).toEqual([
      { fromKey: "B-1", toKey: "A-1", typeName: "Blocks", outward: "blocks", inward: "is blocked by" },
      { fromKey: "A-1", toKey: "C-1", typeName: "Milestone", outward: "contains", inward: "is contained by" },
    ]);
  });

  test("link direction", () => {
    const l = (outward: string) => ({ fromKey: "A", toKey: "B", typeName: "X", outward, inward: "" });
    expect(linkDirection(l("blocks"))).toBe("from-first");
    expect(linkDirection(l("depends on"))).toBe("to-first");
    expect(linkDirection(l("relates to"))).toBeNull();
  });

  test("Jira CSV export maps repeated columns", () => {
    const csv = [
      "Summary,Issue key,Issue Type,Status,Labels,Labels,Due Date,Custom field (Start Date),Outward issue link (Blocks)",
      'Do thing,BIGP-9,Epic,In Progress,Domain:Web,Intent,14/Nov/26 10:00 AM,01/Nov/26,"VIEW-1"',
    ].join("\n");
    const [raw] = csvToRaw(csv, cfg);
    const { issue, links } = normalizeIssue(raw, cfg, { inScope: true, syncedAt: "x" });
    expect(issue).toMatchObject({ key: "BIGP-9", dueDate: "2026-11-14", startDate: "2026-11-01", platforms: ["Web"] });
    expect(links[0]).toMatchObject({ fromKey: "BIGP-9", toKey: "VIEW-1", outward: "blocks" });
  });
});

describe("demo model", () => {
  const db = openDb(":memory:");
  seedDemo(db);
  const m = loadModel(db);

  test("hierarchy outcome → cpm → intent → ipm → epic → story", () => {
    const out = m.tree.find((n) => n.issue.key === "BIGP-1")!;
    const path = [out.issue.key];
    let n = out;
    for (const k of ["BIGP-10", "BIGP-20", "BIGP-30", "BIGP-100", "BIGP-111"]) {
      n = n.children.find((c) => c.issue.key === k)!;
      expect(n, k).toBeTruthy();
      path.push(n.issue.key);
    }
    expect(n.effectiveSubTrack).toBe("Login & Auth");
    // external issues are not roots
    expect(m.tree.some((t) => t.issue.key.startsWith("VIEW"))).toBe(false);
    // intake tasks aren't plan roots
    expect(m.tree.some((t) => t.issue.isIntake)).toBe(false);
  });

  test("filter keeps ancestors of matching nodes", () => {
    const f = flattenTree(filterTree(m.tree, { platform: "Android" })).map((n) => n.issue.key);
    expect(f).toContain("BIGP-1");
    expect(f).toContain("BIGP-102");
    expect(f).not.toContain("BIGP-101");
  });

  test("dependency analysis flags conflict and recent change", () => {
    const d = m.deps.find((x) => x.predecessor.key === "VIEW-50" && x.successor.key === "BIGP-103")!;
    expect(d.health).toBe("conflict");
    expect(d.direction).toBe("incoming");
    expect(d.recentChanges.map((c) => c.field)).toContain("dueDate");
    expect(m.deps.find((x) => x.predecessor.key === "PLAT-7")!.health).toBe("unknown");
    expect(m.deps.find((x) => x.predecessor.key === "BIGP-100" && x.successor.key === "VIEW-60")!.direction).toBe("outgoing");
    // milestones need dependencies by their due date, not their start
    expect(m.deps.find((x) => x.predecessor.key === "NDIG-12" && x.successor.key === "BIGP-10")!.health).toBe("ok");
  });

  test("exec report RAG", () => {
    const r = groupReport(m, "Dashboard", { subTrack: "Dashboard" });
    expect(r.rag).toBe("red");
    expect(r.deps.conflict).toBeGreaterThan(0);
  });

  test("notes produced action items", () => {
    const items = listActionItems(db);
    expect(items.length).toBe(4);
    expect(items.find((i) => i.text.startsWith("Priya"))?.owner).toBe("Priya");
  });
});

describe("edits and sync changes", () => {
  test("staged edits overlay, export, push, and change detection", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    stageEdit(db, "BIGP-100", "dueDate", "2030-01-15");
    stageEdit(db, "BIGP-101", "summary", "Renamed");
    expect(getIssue(db, "BIGP-100")).toMatchObject({ dueDate: "2030-01-15", pendingFields: ["dueDate"] });

    const m = loadModel(db);
    const { csv, rows, editIds } = buildUpdateCsv(listPendingEdits(db, { unpushedOnly: true }), m.issues, m.cfg);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toEqual(["Issue Key", "Summary", "Due Date"]);
    expect(rows).toBe(2);
    expect(parsed.find((r) => r[0] === "BIGP-101")![2]).toBe(m.byKey.get("BIGP-101")!.dueDate); // filled, not blank

    markEditsPushed(db, editIds, "csv");
    expect(listPendingEdits(db, { unpushedOnly: true })).toHaveLength(0);
    expect(getIssue(db, "BIGP-100")!.dueDate).toBe("2030-01-15");

    // staging the current value is a no-op
    stageEdit(db, "BIGP-100", "dueDate", "2030-01-15");
    expect(listPendingEdits(db, { unpushedOnly: true })).toHaveLength(0);

    const before = listChanges(db, { key: "VIEW-51" }).length;
    const base = getIssue(db, "VIEW-51")!;
    upsertIssues(db, [{ issue: { ...base, dueDate: "2031-01-01" }, links: [] }]);
    expect(listChanges(db, { key: "VIEW-51" }).length).toBe(before + 1);
  });
});

describe("notes & connectors", () => {
  test("extracts action items with owner and due", () => {
    const a = extractActionItems(
      [
        "- AI: Priya to confirm token format by 2026-12-01",
        "- [ ] @marcus send SDK notes due 12/5",
        "- [x] done already",
        "- just a discussion point",
        "Jordan will draft mitigation options by Nov 30",
      ].join("\n"),
      2026,
    );
    expect(a).toEqual([
      { text: "Priya to confirm token format by 2026-12-01", owner: "Priya", dueDate: "2026-12-01" },
      { text: "@marcus send SDK notes due 12/5", owner: "marcus", dueDate: "2026-12-05" },
      { text: "Jordan will draft mitigation options by Nov 30", owner: "Jordan", dueDate: "2026-11-30" },
    ]);
  });

  test("confluence tasks become checkbox lines", () => {
    const text = confluenceStorageToText(
      '<p>Notes</p><ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Send deck <ri:user ri:username="sam" /> <time datetime="2026-12-02" /></ac:task-body></ac:task></ac:task-list>',
    );
    expect(extractActionItems(text)).toEqual([
      { text: "Send deck @sam by 2026-12-02", owner: "sam", dueDate: "2026-12-02" },
    ]);
  });

  test("urls", () => {
    expect(sheetsCsvUrl("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42")).toBe(
      "https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=42",
    );
    expect(parseConfluencePageId("https://wiki.example.com/pages/viewpage.action?pageId=98765")).toBe("98765");
  });

  test("importNoteText stores note and items", () => {
    const db = openDb(":memory:");
    const r = importNoteText(db, { title: "x", body: "TODO: thing" });
    expect(r.actions).toBe(1);
  });
});
