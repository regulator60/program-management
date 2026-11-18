import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { applyProposals } from "@/lib/assistant/apply";
import { getDb } from "@/lib/db";

/** Stage or dismiss proposals: { messageId, picks: number[], intent: "stage" | "dismiss" }. */
export async function POST(req: Request) {
  await connection();
  const body = (await req.json().catch(() => ({}))) as { messageId?: number; picks?: number[]; intent?: string };
  try {
    const out = applyProposals(getDb(), Number(body.messageId), Array.isArray(body.picks) ? body.picks.map(Number) : [], body.intent === "dismiss" ? "dismiss" : "stage");
    revalidatePath("/", "layout");
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
