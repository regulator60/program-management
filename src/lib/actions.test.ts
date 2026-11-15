import { describe, expect, test } from "vitest";
import { importNoteText } from "./connectors";
import { openDb } from "./db";
import { seedDemo } from "./seed";
import {
  ensureAutoAssignments,
  listActionItems,
  listAssignments,
  setAssignments,
  updateActionItem,
  updateAssignment,
} from "./store";

describe("program action items", () => {
  test("intake items labelled with platforms assign themselves to those platforms", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const a = listAssignments(db).filter((x) => x.parent === "jira:BIGP-303");
    expect(a.map((x) => x.scope.name).sort()).toEqual(["API", "Android", "Web", "iOS"]);
    expect(a.filter((x) => x.status === "done").map((x) => x.scope.name).sort()).toEqual(["API", "iOS"]);
    // idempotent
    ensureAutoAssignments(db);
    expect(listAssignments(db).filter((x) => x.parent === "jira:BIGP-303")).toHaveLength(4);
  });

  test("re-assigning keeps teams that already finished", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    setAssignments(db, "jira:BIGP-303", [{ kind: "platform", name: "Android" }]);
    const names = listAssignments(db)
      .filter((x) => x.parent === "jira:BIGP-303")
      .map((x) => `${x.scope.name}:${x.status}`)
      .sort();
    expect(names).toEqual(["API:done", "Android:open", "iOS:done"]);
    const android = listAssignments(db).find((x) => x.parent === "jira:BIGP-303" && x.scope.name === "Android")!;
    updateAssignment(db, android.id, { status: "done" });
    expect(listAssignments(db).find((x) => x.id === android.id)!.doneAt).toBeTruthy();
  });
});

describe("team action items", () => {
  test("notes link actions to mentioned Jira items and infer the team", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    importNoteText(db, {
      title: "Login sync",
      body: [
        "AI: Marcus to unblock BIGP-121 passkey enrollment on iOS by 12/1",
        "TODO: chase VIEW-60 handoff date",
        "AI: Ana to confirm devices for BIGP-201",
      ].join("\n"),
      meetingDate: "2026-11-14",
    });
    const items = listActionItems(db).filter((a) => a.text.includes("BIGP-121") || a.text.includes("VIEW-60") || a.text.includes("BIGP-201") && a.noteId);
    const ios = items.find((a) => a.text.includes("BIGP-121"))!;
    expect(ios).toMatchObject({ links: ["BIGP-121"], platform: "iOS", subTrack: "Login & Auth", owner: "Marcus" });
    expect(items.find((a) => a.text.includes("VIEW-60"))!.links).toEqual(["VIEW-60"]);
    const ana = items.find((a) => a.text.startsWith("Ana"))!;
    expect(ana).toMatchObject({ links: ["BIGP-201"], platform: "Android", subTrack: "Login & Auth" });
  });

  test("note's own team wins, and links can be edited", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    importNoteText(db, { title: "x", body: "TODO: review BIGP-121", platform: "Web", subTrack: "Payments" });
    const a = listActionItems(db).find((i) => i.text === "review BIGP-121")!;
    expect(a).toMatchObject({ platform: "Web", subTrack: "Payments", links: ["BIGP-121"] });
    updateActionItem(db, a.id, { links: ["bigp-31", "BIGP-31", " "] });
    expect(listActionItems(db).find((i) => i.id === a.id)!.links).toEqual(["BIGP-31"]);
  });
});

describe("team headings in notes", () => {
  test("actions under a sub-track or platform heading belong to that team", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    importNoteText(db, {
      title: "Weekly",
      body: ["Payments", "- AI: Sam to send payee test results", "", "Android:", "- TODO: fix crash on OTP screen", "", "General", "- TODO: book offsite"].join("\n"),
    });
    const by = (t: string) => listActionItems(db).find((a) => a.text.includes(t))!;
    expect(by("payee test results")).toMatchObject({ subTrack: "Payments", platform: null });
    expect(by("OTP screen")).toMatchObject({ platform: "Android" });
    expect(by("offsite")).toMatchObject({ subTrack: null, platform: null });
  });
});
