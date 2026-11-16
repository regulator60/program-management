import { describe, expect, test } from "vitest";
import { buildBrief } from "./brief";
import { openDb } from "./db";
import { loadModel, type Filter } from "./model";
import { listProgramActions } from "./programActions";
import { seedDemo } from "./seed";
import { listActionItems, listItemUpdates, listNotes } from "./store";

function briefFor(f: Filter, subject: string) {
  const db = openDb(":memory:");
  seedDemo(db);
  const m = loadModel(db);
  const actions = listActionItems(db);
  const data = { actions, notes: listNotes(db), updates: listItemUpdates(db), programs: listProgramActions(db, m, actions) };
  return buildBrief(m, f, data, { rag: "red", subject });
}

describe("briefing", () => {
  test("headline names the threatened milestone and the cause, not just counts", () => {
    const b = briefFor({}, "the Digital track");
    expect(b.headline).toMatch(/^Off track for the Digital track: /);
    expect(b.summary).toMatch(/Account dashboard GA/);
    expect(b.summary).toMatch(/View Account/);
    expect(b.summary).not.toMatch(/needs attention/i);
    expect(b.headline.endsWith(b.summary)).toBe(true);
  });

  test("every callout is specific and linked; no item appears twice", () => {
    const b = briefFor({}, "the Digital track");
    const ids = b.callouts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mentions202 = b.callouts.filter((c) => c.title.includes("BIGP-202"));
    expect(mentions202.length).toBe(1);
    for (const c of b.callouts) {
      expect(c.href).toBeTruthy();
      expect(c.body.length).toBeGreaterThan(0);
      expect(c.title).not.toMatch(/\(\(|\)\)/);
    }
    expect(b.callouts.some((c) => c.kind === "attention")).toBe(true);
    expect(b.callouts.some((c) => c.kind === "help")).toBe(true);
  });

  test("past need-by dates say the work is already held up", () => {
    const b = briefFor({}, "the Digital track");
    const text = b.callouts.flatMap((c) => c.body).join("\n");
    expect(text).not.toMatch(/needed it by [^,]+, (?!so it's already holding up work)/);
  });

  test("a platform view does not blame that platform for another team's overrun", () => {
    const b = briefFor({ platform: "Android" }, "Android");
    for (const c of b.callouts.filter((x) => x.kind === "attention")) {
      expect(c.body.join(" ")).not.toMatch(/– iOS/);
    }
  });
});

test("progress column reports what moved forward", () => {
  const b = briefFor({}, "the Digital track");
  expect(b.callouts.some((c) => c.kind === "progress")).toBe(true);
});
