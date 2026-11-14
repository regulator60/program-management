import { readFileSync } from "node:fs";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getNote } from "@/lib/store";

/** Download the original file attached to a note. */
export async function GET(_req: Request, ctx: RouteContext<"/api/notes/[id]/attachment">) {
  await connection();
  const { id } = await ctx.params;
  const note = getNote(getDb(), Number(id));
  if (!note?.attachmentPath || !note.attachmentName) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = readFileSync(note.attachmentPath);
  } catch {
    return new Response("Attachment file is missing on disk", { status: 410 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(note.attachmentName)}`,
    },
  });
}
