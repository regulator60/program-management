import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { listIssues } from "@/lib/store";
import { LEVEL_SHORT } from "@/lib/types";

/** Compact search index for the ⌘K palette: key, summary, level, sub-track. */
export async function GET() {
  await connection();
  const items = listIssues(getDb())
    .sort((a, b) => Number(b.inScope) - Number(a.inScope) || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((i) => ({ k: i.key, s: i.summary, l: LEVEL_SHORT[i.level], t: i.subTrack ?? (i.inScope ? undefined : "other track") }));
  return Response.json(items, { headers: { "Cache-Control": "no-store" } });
}
