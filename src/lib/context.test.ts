import { describe, expect, test } from "vitest";
import { itemContext, smartQuestion } from "./context";
import { openDb } from "./db";
import { loadModel } from "./model";
import { listProgramActions } from "./programActions";
import { buildS0 } from "./s0";
import { seedDemo } from "./seed";
import { addActionItem, addItemUpdate, listActionItems, listItemUpdates, listNotes } from "./store";
import type { ActionItem, ItemUpdate, Note } from "./types";

const today = "2026-11-15";
const action = (p: Partial<ActionItem>): ActionItem => ({
  id: 1, noteId: null, text: "x", owner: null, dueDate: null, status: "open", jiraKey: null,
  subTrack: null, platform: null, kind: "team", links: [], createdAt: "2026-11-01", ...p,
});
const update = (p: Partial<ItemUpdate>): ItemUpdate => ({
  id: 1, key: "A-1", body: "b", progress: null, scope: null, sentToJira: false, createdAt: "2026-11-10T10:00:00Z", ...p,
});
const note = (p: Partial<Note>): Note => ({
  id: 1, title: "Weekly", body: "", meetingDate: "2026-11-12", source: "manual", sourceUrl: null, attachmentName: null,
  attachmentPath: null, subTrack: null, platform: null, createdAt: "2026-11-12", updatedAt: null, ...p,
});

describe("smart questions", () => {
  test("an overdue linked action beats everything else", () => {
    const ctx = itemContext(["A-1"], {
      actions: [action({ id: 2, text: "Get committed date from Platform", owner: "Sam", dueDate: "2026-11-10", links: ["A-1"] })],
      notes: [note({ body: "- A-1 still has no date" })],
      updates: [update({ progress: "blocked", body: "waiting" })],
    }, today);
    expect(smartQuestion(ctx, today)).toMatchObject({
      question: expect.stringMatching(/^Sam: "Get committed date from Platform" was due Nov 10\. Is it done/),
      basis: "Overdue action item (due Nov 10)",
    });
  });

  test("blocked update, then open action, then last update, then meeting notes", () => {
    const blocked = itemContext(["A-1"], { actions: [action({ links: ["A-1"], dueDate: "2026-11-30", owner: "Jo", text: "Draft options" })], notes: [], updates: [update({ progress: "blocked", body: "No response from View Account" })] }, today);
    expect(smartQuestion(blocked, today)!.question).toMatch(/was blocked: "No response from View Account"\. Is that still the case/);

    const openAction = itemContext(["A-1"], { actions: [action({ links: ["A-1"], dueDate: "2026-11-30", owner: "Jo", text: "Draft options" })], notes: [], updates: [] }, today);
    expect(smartQuestion(openAction, today)!.question).toBe('Jo: how is "Draft options" going (due Nov 30)? What\'s still needed?');

    const onlyUpdate = itemContext(["A-1"], { actions: [], notes: [], updates: [update({ progress: "moving", body: "2 of 4 devices arrived" })] }, today);
    expect(smartQuestion(onlyUpdate, today, "Ana")!.question).toBe('Last update Nov 10: "2 of 4 devices arrived". What\'s changed since, Ana?');

    const onlyNote = itemContext(["A-1"], { actions: [], notes: [note({ body: "Payments\n- A-1 moved to 12/20, Sam owns" })], updates: [] }, today);
    expect(smartQuestion(onlyNote, today)).toMatchObject({ question: 'In "Weekly" (Nov 12): "A-1 moved to 12/20, Sam owns". What\'s happened since?', basis: "Meeting notes, Nov 12" });

    expect(smartQuestion(itemContext(["A-1"], { actions: [], notes: [], updates: [] }, today), today)).toBeNull();
  });

  test("mentions match whole keys only", () => {
    const ctx = itemContext(["A-1"], { actions: [], notes: [note({ body: "A-10 is fine\nXA-1 nope\nA-1: real" })], updates: [] }, today);
    expect(ctx.mentions.map((x) => x.line)).toEqual(["A-1: real"]);
  });
});

describe("S0 uses context", () => {
  test("review topics and dependency agenda items are grounded in notes, actions and updates", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    addActionItem(db, { text: "Confirm SDK date with vendor", owner: "Marcus Lee", dueDate: "2000-01-01", links: ["BIGP-200"] });
    const m = loadModel(db);
    const actions = listActionItems(db);
    const s0 = buildS0(m, { kind: "subtrack", name: "Login & Auth" }, { actions, programs: listProgramActions(db, m, actions), updates: listItemUpdates(db), notes: listNotes(db) });
    const t = s0.reviewTopics.find((x) => x.issue.key === "BIGP-200")!;
    expect(t.question).toMatch(/^Marcus Lee: "Confirm SDK date with vendor" was due/);
    expect(t.reasons.some((r) => r.startsWith('Action "Confirm SDK date'))).toBe(true);

    const dash = buildS0(m, { kind: "subtrack", name: "Dashboard" }, { actions, programs: listProgramActions(db, m, actions), updates: listItemUpdates(db), notes: listNotes(db) });
    const dep = dash.agenda.find((a) => a.id === "dep-VIEW-50-BIGP-103")!;
    expect(dep.basis).toBeTruthy(); // grounded: open action "Draft re-plan options…" is linked to VIEW-50 / BIGP-103
    expect(dep.question).toMatch(/Draft re-plan options/);
  });

  test("dependency-level updates count for the dependency", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    addItemUpdate(db, { key: "dep:PLAT-7:BIGP-105", body: "Platform says date by Friday", progress: "moving" });
    const ctx = itemContext(["PLAT-7", "BIGP-105"], { actions: [], notes: [], updates: listItemUpdates(db) }, today, ["dep:PLAT-7:BIGP-105"]);
    expect(ctx.updates[0].body).toBe("Platform says date by Friday");
  });
});
