import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { assistantStatus } from "@/lib/assistant/config";
import { chatTurns, latestChatId, runTurn } from "@/lib/assistant/run";
import { getDb } from "@/lib/db";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Status, plus the latest (or requested) conversation for the chat panel. */
export async function GET(req: Request) {
  await connection();
  const db = getDb();
  const status = assistantStatus(db);
  const asked = Number(new URL(req.url).searchParams.get("chat"));
  const chatId = asked || latestChatId(db);
  return json({ status, chatId, turns: chatId ? chatTurns(db, chatId) : [] });
}

/** One message from the user: { chatId?, text, page? }. */
export async function POST(req: Request) {
  await connection();
  const db = getDb();
  const status = assistantStatus(db);
  if (!status.available) return json({ error: status.reason }, 403);
  const body = (await req.json().catch(() => ({}))) as { chatId?: number | null; text?: string; page?: string };
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "Type a question or an update." }, 400);
  if (text.length > 8000) return json({ error: "That message is too long (8,000 characters max)." }, 400);
  try {
    const out = await runTurn(db, { chatId: body.chatId ?? null, text, page: body.page?.slice(0, 200) ?? null });
    return json(out);
  } catch (e) {
    return json({ error: describe(e) }, 502);
  }
}

/** Errors in words the user can act on. */
function describe(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "The AI endpoint rejected the credentials. Check ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL if you use a gateway) in .env.local.";
  }
  if (e instanceof Anthropic.NotFoundError) return "The AI endpoint doesn't know that model. Check ASSISTANT_MODEL.";
  if (e instanceof Anthropic.RateLimitError) return "The AI endpoint is rate limiting requests. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `The AI endpoint rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI endpoint. Check your network or ANTHROPIC_BASE_URL.";
  if (e instanceof Anthropic.APIError) return `The AI endpoint returned an error (${e.status ?? "no status"}). Try again.`;
  if (e instanceof Error && /api key|apiKey|authToken|credentials/i.test(e.message)) {
    return "No API key is set. Add ANTHROPIC_API_KEY to .env.local and restart the app.";
  }
  return e instanceof Error ? e.message : String(e);
}
