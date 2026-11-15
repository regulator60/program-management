import { describe, expect, test } from "vitest";
import { openDb } from "./db";
import { loadModel } from "./model";
import { listProgramActions } from "./programActions";
import { buildS0 } from "./s0";
import { seedDemo } from "./seed";
import { addItemUpdate, listActionItems, listItemUpdates } from "./store";

function s0For(db: ReturnType<typeof openDb>, kind: "subtrack" | "platform", name: string) {
  const m = loadModel(db);
  const actions = listActionItems(db);
  return buildS0(m, { kind, name }, { actions, programs: listProgramActions(db, m, actions), updates: listItemUpdates(db) });
}

describe("S0 risk & decision review", () => {
  test("raises stale, stalled and due-soon items with reasons and a question", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const s0 = s0For(db, "subtrack", "Login & Auth");
    const byKey = new Map(s0.reviewTopics.map((t) => [t.issue.key, t]));
    expect(byKey.get("BIGP-200")!.reasons).toContain("No update in 12 days");
    expect(byKey.get("BIGP-200")!.question).toMatch(/Marcus Lee: what's the latest/);
    expect(byKey.get("BIGP-212")).toBeUndefined(); // tier 1, not this sub-track's label
    expect(byKey.get("BIGP-211")!.reasons.some((r) => r.startsWith("No update in 11 days"))).toBe(true);
    // recently updated & not due soon → quiet
    expect(s0.quietRaid.map((q) => q.issue.key)).not.toContain("BIGP-200");
    expect(s0.agenda.some((a) => a.section === "review" && a.id === "review-BIGP-200")).toBe(true);
  });

  test("blocked update is raised first; a fresh update quiets a stale item; resolved drops off", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const dash = s0For(db, "subtrack", "Dashboard");
    expect(dash.reviewTopics[0].issue.key).toBe("BIGP-202");
    expect(dash.reviewTopics[0].reasons[0]).toMatch(/^Blocked as of/);

    addItemUpdate(db, { key: "BIGP-200", body: "SDK beta landed, testing now", progress: "moving" });
    const auth = s0For(db, "subtrack", "Login & Auth");
    const t200 = auth.reviewTopics.find((t) => t.issue.key === "BIGP-200");
    expect(t200?.reasons.some((r) => r.startsWith("No update"))).toBeFalsy();
    expect(auth.latestUpdate.get("BIGP-200")!.body).toBe("SDK beta landed, testing now");

    addItemUpdate(db, { key: "BIGP-202", body: "Recovery plan agreed", progress: "resolved" });
    expect(s0For(db, "subtrack", "Dashboard").reviewTopics.some((t) => t.issue.key === "BIGP-202")).toBe(false);
  });
});
