import type { AppConfig } from "../config";
import { toCsv } from "../csv";
import type { IssueView } from "../store";
import type { ActionItem, EditableField, PendingEdit } from "../types";

/**
 * Builds a CSV for Jira Server's importer (Administration → System →
 * External System Import → CSV) that UPDATES existing issues.
 *
 * Every row carries the full value of every included column (the staged value
 * if there is one, otherwise what Jira already has) because the importer can
 * blank a field when its cell is empty. Only columns that at least one edit
 * touches are included, plus "Issue Key" and "Summary" (always required).
 *
 * Dates are written as yyyy-MM-dd — set the importer's date format to match.
 * See docs/JIRA_IMPORT.md.
 */
export function buildUpdateCsv(
  edits: PendingEdit[],
  issues: IssueView[],
  cfg: AppConfig,
): { csv: string; rows: number; editIds: number[] } {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const touched = new Set<EditableField>(edits.map((e) => e.field));
  const keys = [...new Set(edits.map((e) => e.key))].filter((k) => byKey.has(k));

  const maxLabels = touched.has("labels")
    ? Math.max(1, ...keys.map((k) => byKey.get(k)!.labels.length))
    : 0;

  const header: string[] = ["Issue Key", "Summary"];
  if (touched.has("status")) header.push("Status");
  if (touched.has("assignee")) header.push("Assignee");
  if (touched.has("startDate")) header.push(cfg.csvColumns.startDate);
  if (touched.has("dueDate")) header.push(cfg.csvColumns.dueDate);
  for (let i = 0; i < maxLabels; i++) header.push("Labels");

  const rows = keys.map((k) => {
    const i = byKey.get(k)!; // IssueView already has pending edits applied
    const r: string[] = [i.key, i.summary];
    if (touched.has("status")) r.push(i.status);
    if (touched.has("assignee")) r.push(i.assignee ?? "");
    if (touched.has("startDate")) r.push(i.startDate ?? "");
    if (touched.has("dueDate")) r.push(i.dueDate ?? "");
    for (let n = 0; n < maxLabels; n++) r.push(i.labels[n] ?? "");
    return r;
  });

  return {
    csv: toCsv([header, ...rows]),
    rows: rows.length,
    editIds: edits.filter((e) => byKey.has(e.key)).map((e) => e.id),
  };
}

/** CSV to CREATE new Jira issues from local action items (no Jira key yet). */
export function buildActionItemCsv(items: ActionItem[], cfg: AppConfig, extraLabels: string[] = []) {
  const header = ["Summary", "Issue Type", "Assignee", cfg.csvColumns.dueDate, "Description", "Labels", "Labels", "Labels"];
  const issueType = cfg.issueTypes.action[0] ?? "Task";
  const rows = items.map((a) => {
    const labels = [cfg.labels.intake, ...extraLabels];
    if (a.subTrack) labels.push(`${cfg.labels.subTrackPrefix.replace(/[:\s]+$/, "")}:${a.subTrack.replace(/\s+/g, "_")}`);
    return [
      a.text.slice(0, 250),
      issueType,
      a.owner ?? "",
      a.dueDate ?? "",
      `Created from program notes (local action item #${a.id}).\n\n${a.text}`,
      labels[0] ?? "",
      labels[1] ?? "",
      labels[2] ?? "",
    ];
  });
  return toCsv([header, ...rows]);
}
