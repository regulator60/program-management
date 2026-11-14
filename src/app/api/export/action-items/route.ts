import { connection } from "next/server";
import { getConfig } from "@/lib/config";
import { getDb, todayIso } from "@/lib/db";
import { buildActionItemCsv } from "@/lib/jira/exportCsv";
import { listActionItems } from "@/lib/store";

/** CSV to create Jira issues from open local action items that have no Jira key yet. */
export async function GET() {
  await connection();
  const db = getDb();
  const items = listActionItems(db).filter((a) => a.status === "open" && !a.jiraKey);
  const csv = buildActionItemCsv(items, getConfig(db));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jira-new-action-items-${todayIso()}.csv"`,
    },
  });
}
