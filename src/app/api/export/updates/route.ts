import { connection } from "next/server";
import { getDb, todayIso } from "@/lib/db";
import { buildUpdateCsv } from "@/lib/jira/exportCsv";
import { loadModel } from "@/lib/model";
import { listPendingEdits } from "@/lib/store";

/** CSV of staged edits, for Jira's External System Import (update existing issues). */
export async function GET() {
  await connection();
  const db = getDb();
  const m = loadModel(db);
  const { csv } = buildUpdateCsv(listPendingEdits(db, { unpushedOnly: true }), m.issues, m.cfg);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jira-updates-${todayIso()}.csv"`,
    },
  });
}
