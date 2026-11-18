import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test } from "vitest";
import { openDb } from "../db";
import { loadModel } from "../model";
import { seedDemo } from "../seed";
import { getIssue, listActionItems, listItemUpdates, listPendingEdits } from "../store";
import { applyProposals } from "./apply";
import { getConfig, saveConfig } from "../config";
import { assistantConfig, assistantStatus } from "./config";
import { runTurn, type CallModel } from "./run";
import { runTool, type ProposedChange } from "./tools";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

function fresh() {
  const db = openDb(":memory:");
  seedDemo(db);
  return db;
}

const msg = (content: unknown[], stop_reason: string): Anthropic.Message =>
  ({ id: "msg", type: "message", role: "assistant", model: "test", content, stop_reason, stop_sequence: null, usage: {} }) as unknown as Anthropic.Message;

/** A scripted model: returns the given responses in order and records every request. */
function fake(responses: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const call: CallModel = async (p) => {
    calls.push(JSON.parse(JSON.stringify(p)));
    const r = responses.shift();
    if (!r) throw new Error("no more scripted responses");
    return r;
  };
  return { call, calls };
}

describe("assistant availability", () => {
  test("off by default; demo mode works on demo data and pauses once real data is loaded", () => {
    const db = fresh();
    delete process.env.ASSISTANT_ENABLED;
    expect(assistantStatus(db)).toMatchObject({ available: false, mode: "off" });

    process.env.ASSISTANT_ENABLED = "demo";
    expect(assistantStatus(db)).toMatchObject({ available: true, mode: "demo" });

    db.prepare("UPDATE issues SET source = 'jira' WHERE key = 'BIGP-11'").run();
    const paused = assistantStatus(db);
    expect(paused.available).toBe(false);
    expect(paused.reason).toMatch(/real data is loaded/);

    process.env.ASSISTANT_ENABLED = "on";
    expect(assistantStatus(db).available).toBe(true);
  });
});

describe("assistant settings", () => {
  test("Settings override the environment; real-data mode needs the approval box", () => {
    const db = fresh();
    process.env.ASSISTANT_ENABLED = "demo";
    process.env.ANTHROPIC_BASE_URL = "https://env-gateway.example.com";
    expect(assistantConfig(db)).toMatchObject({ mode: "demo", modeSource: "environment", baseURL: "https://env-gateway.example.com", baseURLFromSettings: null, fallbacks: false });

    const cfg = getConfig(db);
    saveConfig(db, { ...cfg, assistant: { ...cfg.assistant, mode: "off" } });
    expect(assistantStatus(db)).toMatchObject({ available: false, mode: "off" });

    saveConfig(db, {
      ...cfg,
      assistant: { mode: "on", approvedForRealData: false, baseUrl: "https://gw.example.com", model: "corp-claude", effort: "high", refusalFallback: "auto" },
    });
    const eff = assistantConfig(db);
    expect(eff).toMatchObject({ mode: "on", modeSource: "settings", baseURL: "https://gw.example.com", baseURLFromSettings: "https://gw.example.com", model: "corp-claude", effort: "high", fallbacks: false });
    expect(assistantStatus(db)).toMatchObject({ available: false });
    expect(assistantStatus(db).reason).toMatch(/approved/);

    saveConfig(db, { ...getConfig(db), assistant: { ...getConfig(db).assistant, approvedForRealData: true } });
    expect(assistantStatus(db)).toMatchObject({ available: true, mode: "on", endpoint: "https://gw.example.com", model: "corp-claude" });

    // Back to "follow the environment".
    saveConfig(db, { ...getConfig(db), assistant: { ...getConfig(db).assistant, mode: "", baseUrl: "", model: "" } });
    expect(assistantConfig(db)).toMatchObject({ mode: "demo", modeSource: "environment", model: "claude-opus-5-5" });
  });
});

describe("tools", () => {
  test("read tools answer from local data", () => {
    const db = fresh();
    const ctx = { db, m: loadModel(db), proposals: [] as ProposedChange[] };
    const found = runTool("search_items", { query: "balances api" }, ctx) as { results: { key: string }[] };
    expect(found.results.map((r) => r.key)).toContain("VIEW-50");
    const item = runTool("get_item", { key: "BIGP-103" }, ctx) as { item: { key: string }; dependencies: { health: string }[] };
    expect(item.item.key).toBe("BIGP-103");
    expect(item.dependencies.some((d) => d.health === "conflict")).toBe(true);
    expect(runTool("get_item", { key: "NOPE-1" }, ctx)).toHaveProperty("error");
    const b = runTool("get_briefing", { team: "Dashboard" }, ctx) as { summary: string };
    expect(b.summary).toMatch(/Account dashboard GA/);
  });

  test("propose_changes validates and never writes", () => {
    const db = fresh();
    const m = loadModel(db);
    const ctx = { db, m, proposals: [] as ProposedChange[] };
    const before = listPendingEdits(db).length;
    const out = runTool(
      "propose_changes",
      {
        summary: "x",
        changes: [
          { kind: "field", key: "VIEW-50", field: "dueDate", value: "2027-01-30", reason: "View Account said Jan 30" },
          { kind: "field", key: "VIEW-50", field: "dueDate", value: "Jan 30", reason: "bad date" },
          { kind: "field", key: "NOPE-9", field: "status", value: "Done", reason: "unknown key" },
          { kind: "action", body: "Book pilot readiness review", owner: "Ana Gomez", dueDate: "2026-11-30", team: "Dashboard", links: ["BIGP-11"], reason: "agreed" },
        ],
      },
      ctx,
    ) as { shownToUser: number; problems: string[] };
    expect(out.shownToUser).toBe(2);
    expect(out.problems).toHaveLength(2);
    expect(ctx.proposals.map((p) => p.kind)).toEqual(["field", "action"]);
    expect(listPendingEdits(db).length).toBe(before);
  });
});

describe("conversation loop", () => {
  test("runs tools, keeps a valid append-only history, and returns proposals", async () => {
    const db = fresh();
    process.env.ASSISTANT_ENABLED = "demo";
    const { call, calls } = fake([
      msg([{ type: "tool_use", id: "t1", name: "search_items", input: { query: "Balances API v3" } }], "tool_use"),
      msg(
        [
          {
            type: "tool_use",
            id: "t2",
            name: "propose_changes",
            input: { summary: "New date", changes: [{ kind: "field", key: "VIEW-50", field: "dueDate", value: "2027-01-30", reason: "You said Jan 30" }] },
          },
        ],
        "tool_use",
      ),
      msg([{ type: "text", text: "I've proposed moving VIEW-50 to Jan 30, 2027." }], "end_turn"),
    ]);
    const out = await runTurn(db, { text: "View Account says Balances API v3 now lands Jan 30", page: "the S0 page", call });

    expect(calls).toHaveLength(3);
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].output_config).toEqual({ effort: "medium" });
    expect(JSON.stringify(calls[0].messages[0].content)).toContain("(The user is looking at the S0 page.)");
    // Second request carries the first tool call and its result, in order.
    const second = calls[1].messages;
    expect(second.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(second[2].content)).toContain("VIEW-50");

    expect(out.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(out.turns[0].text).toBe("View Account says Balances API v3 now lands Jan 30");
    expect(out.turns[1].proposals).toEqual([
      { kind: "field", key: "VIEW-50", field: "dueDate", value: "2027-01-30", current: getIssue(db, "VIEW-50")!.dueDate, reason: "You said Jan 30" },
    ]);

    // A follow-up turn resends the whole conversation unchanged, then the new message.
    const next = fake([msg([{ type: "text", text: "Sure." }], "end_turn")]);
    await runTurn(db, { chatId: out.chatId, text: "Thanks", call: next.call });
    const hist = next.calls[0].messages;
    expect(hist.slice(0, 6).map((x) => JSON.stringify(x))).toEqual(
      [...calls[2].messages, { role: "assistant", content: [{ type: "text", text: "I've proposed moving VIEW-50 to Jan 30, 2027." }] }].map((x) => JSON.stringify(x)),
    );
    expect(hist).toHaveLength(7);
  });

  test("a tool error is reported to the model, and a refusal gets a plain answer", async () => {
    const db = fresh();
    const { call, calls } = fake([
      msg([{ type: "tool_use", id: "t1", name: "get_item", input: { key: "NOPE-1" } }], "tool_use"),
      msg([], "refusal"),
    ]);
    const out = await runTurn(db, { text: "hi", call });
    const results = calls[1].messages[2].content as Anthropic.ToolResultBlockParam[];
    expect(results[0].is_error).toBe(true);
    expect(out.turns[1].text).toBe("I can't help with that request.");
  });
});

describe("staging proposals", () => {
  test("stages Jira edits, adds actions and updates, marks actions done, once each", async () => {
    const db = fresh();
    const open = listActionItems(db).find((a) => a.status === "open" && a.kind === "team")!;
    const { call } = fake([
      msg(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_changes",
            input: {
              summary: "x",
              changes: [
                { kind: "field", key: "VIEW-50", field: "dueDate", value: "2027-01-30", reason: "r" },
                { kind: "comment", key: "BIGP-103", body: "View Account committed to Jan 30.", reason: "r" },
                { kind: "update", key: "BIGP-202", progress: "moving", body: "Recovery plan received.", reason: "r" },
                { kind: "action", body: "Re-plan Accounts aggregation API against Jan 30", owner: "Priya Shah", team: "Dashboard", reason: "r" },
                { kind: "actionDone", id: open.id, reason: "r" },
              ],
            },
          },
        ],
        "tool_use",
      ),
      msg([{ type: "text", text: "Proposed." }], "end_turn"),
    ]);
    const out = await runTurn(db, { text: "update", call });
    const turn = out.turns[1];
    const actionsBefore = listActionItems(db).length;

    const r = applyProposals(db, turn.id, [0, 1, 2, 3]);
    expect(r).toMatchObject({ staged: 2, updates: 1, actions: 1, done: 0 });
    const edits = listPendingEdits(db, { unpushedOnly: true });
    expect(edits.some((e) => e.key === "VIEW-50" && e.field === "dueDate" && e.newValue === "2027-01-30")).toBe(true);
    expect(edits.some((e) => e.key === "BIGP-103" && e.field === "comment")).toBe(true);
    expect(listItemUpdates(db, "BIGP-202")[0]).toMatchObject({ progress: "moving", body: "Recovery plan received." });
    const added = listActionItems(db).find((a) => a.text.startsWith("Re-plan Accounts"))!;
    expect(added).toMatchObject({ owner: "Priya Shah", subTrack: "Dashboard" });
    expect(added.links).toContain("BIGP-103"); // linked by name
    expect(listActionItems(db).length).toBe(actionsBefore + 1);

    // Applying again does nothing; dismissing the last one doesn't mark the action done.
    expect(applyProposals(db, turn.id, [0, 1, 2, 3])).toMatchObject({ staged: 0, actions: 0, updates: 0 });
    expect(applyProposals(db, turn.id, [4], "dismiss")).toMatchObject({ dismissed: 1, applied: [0, 1, 2, 3, 4] });
    expect(listActionItems(db).find((a) => a.id === open.id)!.status).toBe("open");
  });
});
