import { describe, expect, test } from "vitest";
import { openDb } from "./db";
import { ancestry, buildInsights, headline } from "./insights";
import { groupReport, loadModel } from "./model";
import { seedDemo } from "./seed";
import { addActionItem, listActionItems } from "./store";

describe("insights", () => {
  const db = openDb(":memory:");
  seedDemo(db);
  const m = loadModel(db);

  test("ancestry walks up to the critical path milestone and outcome", () => {
    const { cpm, outcome } = ancestry(m)("BIGP-111");
    expect(cpm?.key).toBe("BIGP-10");
    expect(outcome?.key).toBe("BIGP-1");
  });

  test("dependency conflict is critical and names the milestone it threatens", () => {
    const ins = buildInsights(m, {});
    const dep = ins.find((i) => i.id === "dep-VIEW-50-BIGP-103")!;
    expect(dep.severity).toBe("critical");
    expect(dep.threatens?.key).toBe("BIGP-11");
    expect(ins[0].severity).toBe("critical"); // sorted most urgent first
  });

  test("detects plans that overrun their milestone, slips, risks, undated deps", () => {
    const ids = buildInsights(m, {}).map((i) => i.id);
    expect(ids).toContain("overrun-BIGP-20");
    expect(ids.some((i) => i.startsWith("slip-"))).toBe(true);
    expect(ids).toContain("risk-BIGP-203");
    expect(ids).toContain("depnodate-PLAT-7-BIGP-105");
  });

  test("filters by sub-track", () => {
    const pay = buildInsights(m, { subTrack: "Payments" });
    expect(pay.some((i) => i.id === "dep-VIEW-50-BIGP-103")).toBe(false);
    expect(pay.some((i) => i.id === "depnodate-PLAT-7-BIGP-105")).toBe(true);
  });

  test("overdue action items are summarised", () => {
    addActionItem(db, { text: "Old thing", dueDate: "2000-01-01" });
    const ins = buildInsights(loadModel(db), {}, listActionItems(db));
    expect(ins.find((i) => i.id === "actions-overdue")?.title).toMatch(/action items? overdue/);
  });

  test("headline names threatened milestones", () => {
    const ins = buildInsights(m, {});
    const text = headline(ins, groupReport(m, "x", {}).rag, "The Digital track");
    expect(text).toContain("needs attention");
    expect(text).toContain("BIGP-11");
  });
});
