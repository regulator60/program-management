import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "../db";
import { loadModel, type Model } from "../model";
import { assistantConfig } from "./config";
import { runTool, TOOLS, type ProposedChange } from "./tools";

/** One Messages API call. Injected so tests can run the loop without the network. */
export type CallModel = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  proposals: ProposedChange[];
  applied: number[];
  at: string;
};

const MAX_STEPS = 10;

function systemPrompt(m: Model) {
  return [
    `You are the program assistant inside Track PM, the tool the ${m.cfg.trackName} track uses to run its part of a large program in Jira.`,
    "You help the people doing the work and the track leads understand what's going on, and turn news they tell you into proposed updates.",
    "",
    "How the plan is organised: Outcome → Critical Path Milestone (CPM) → Interim Milestone with the Intent label → Interim Milestone → Epic → Stories. Dependencies are blocks / depends-on links, some with other tracks. Risks and decisions have tiers (1 and 2 span tracks, 3 is this track). Action items are small follow-ups owned by a team; program asks are larger asks from the program assigned to teams.",
    `Teams: sub-tracks ${m.subTracks.join(", ") || "(none)"}; platforms ${m.platforms.join(", ") || "(none)"}.`,
    "",
    "Answering questions:",
    "- Look things up with the tools before answering. Base every statement on what the tools return, and say plainly when the data doesn't say.",
    "- Be specific and brief: name the item and key (e.g. BIGP-11), dates, owners, and why it matters. The panel turns keys into links.",
    "- Write for a professional audience. Short paragraphs or a few bullets; no headings for short answers.",
    "",
    "When the user tells you news (a date moved, something is done or blocked, a decision was made, someone will follow up):",
    "- Find the items involved, then call propose_changes with the updates that follow from what they said.",
    "- Nothing changes until the user reviews and stages the proposals in the panel, and Jira only changes after they push. Never say you have updated anything; say what you've proposed.",
    "- Don't invent dates, owners or statuses the user didn't give. If something important is ambiguous (which item, which date), ask one short question instead of guessing.",
    "",
    `Today is ${m.today}.`,
  ].join("\n");
}

function client() {
  // Credentials and base URL come from the environment (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL).
  return new Anthropic();
}

/** The real model call, with server-side refusal fallback where it's available. */
export function defaultCall(): CallModel {
  const cfg = assistantConfig();
  const c = client();
  if (!cfg.fallbacks) return (p) => c.messages.create(p);
  // On a policy decline, the API re-runs the request on a fallback model in the same call.
  return (p) =>
    c.beta.messages.create({
      ...(p as Anthropic.Beta.MessageCreateParamsNonStreaming),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }) as unknown as Promise<Anthropic.Message>;
}

// ------------------------------------------------------------------ storage

type Row = Record<string, unknown>;

function append(
  db: DatabaseSync,
  chatId: number,
  role: "user" | "assistant",
  api: unknown,
  display: string | null = null,
  proposals: ProposedChange[] | null = null,
) {
  const r = db
    .prepare("INSERT INTO assistant_messages (chat_id, role, api, display_text, proposals, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(chatId, role, JSON.stringify(api), display, proposals?.length ? JSON.stringify(proposals) : null, nowIso());
  return Number(r.lastInsertRowid);
}

function history(db: DatabaseSync, chatId: number): Anthropic.MessageParam[] {
  return (db.prepare("SELECT role, api FROM assistant_messages WHERE chat_id = ? ORDER BY id").all(chatId) as Row[]).map((r) => ({
    role: r.role as "user" | "assistant",
    content: JSON.parse(String(r.api)),
  }));
}

/** What the panel shows for a chat. */
export function chatTurns(db: DatabaseSync, chatId: number): ChatTurn[] {
  return (
    db
      .prepare("SELECT id, role, display_text, proposals, applied, created_at FROM assistant_messages WHERE chat_id = ? AND display_text IS NOT NULL ORDER BY id")
      .all(chatId) as Row[]
  ).map((r) => ({
    id: Number(r.id),
    role: r.role as "user" | "assistant",
    text: String(r.display_text),
    proposals: r.proposals ? JSON.parse(String(r.proposals)) : [],
    applied: r.applied ? JSON.parse(String(r.applied)) : [],
    at: String(r.created_at),
  }));
}

export function latestChatId(db: DatabaseSync): number | null {
  const r = db.prepare("SELECT id FROM assistant_chats ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  return r ? Number(r.id) : null;
}

// ------------------------------------------------------------------ the loop

/**
 * Run one user turn: send the message with the chat so far, run any tools the
 * model asks for, and repeat until it answers. Returns the new turns for the panel.
 */
export async function runTurn(
  db: DatabaseSync,
  opts: { chatId?: number | null; text: string; page?: string | null; call?: CallModel },
): Promise<{ chatId: number; turns: ChatTurn[] }> {
  const cfg = assistantConfig();
  const call = opts.call ?? defaultCall();
  const m = loadModel(db);
  let chatId = opts.chatId ?? null;
  if (!chatId || !db.prepare("SELECT 1 FROM assistant_chats WHERE id = ?").get(chatId)) {
    chatId = Number(db.prepare("INSERT INTO assistant_chats (title, created_at) VALUES (?, ?)").run(opts.text.slice(0, 80), nowIso()).lastInsertRowid);
  }
  const firstNew = Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM assistant_messages").get() as Row).n) + 1;

  const where = opts.page ? `(The user is looking at ${opts.page}.)\n\n` : "";
  append(db, chatId, "user", [{ type: "text", text: `${where}${opts.text}` }], opts.text);

  const proposals: ProposedChange[] = [];
  const system = systemPrompt(m);
  let final: Anthropic.Message | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await call({
      model: cfg.model,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages: history(db, chatId),
      output_config: { effort: cfg.effort },
      cache_control: { type: "ephemeral" },
    });

    if (res.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        let out: unknown;
        let isError = false;
        try {
          out = runTool(block.name, (block.input ?? {}) as Record<string, unknown>, { db, m, proposals });
          isError = !!(out && typeof out === "object" && "error" in out);
        } catch (e) {
          out = { error: e instanceof Error ? e.message : String(e) };
          isError = true;
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: isError || undefined });
      }
      // The assistant turn and its tool results are stored together, so the history is always valid.
      append(db, chatId, "assistant", res.content);
      append(db, chatId, "user", results);
      continue;
    }

    if (res.stop_reason === "pause_turn") {
      append(db, chatId, "assistant", res.content);
      continue;
    }

    final = res;
    break;
  }

  let text =
    final?.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim() ?? "";
  if (!final) text = "That took more steps than expected, so I stopped. Try asking a narrower question.";
  else if (final.stop_reason === "refusal") text = text || "I can't help with that request.";
  else if (final.stop_reason === "max_tokens") text = `${text}\n\n(My answer was cut off. Ask me to continue.)`.trim();
  if (!text && proposals.length) text = "Here's what I'd update. Review and stage what's right.";

  append(db, chatId, "assistant", final ? final.content : [{ type: "text", text }], text || "(no answer)", proposals);
  return { chatId, turns: chatTurns(db, chatId).filter((t) => t.id >= firstNew) };
}
