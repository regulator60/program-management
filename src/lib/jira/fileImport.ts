import type { AppConfig } from "../config";
import { csvRecords } from "../csv";
import type { Issue, Link } from "../types";
import { inferStatusCategory } from "./classify";
import { normalizeIssue, type RawIssueLink, type RawJiraIssue } from "./normalize";

/**
 * Offline import paths, for when the app can't reach Jira directly:
 *
 * 1. JSON: open `<jira>/rest/api/2/search?jql=...&maxResults=1000&fields=*all`
 *    in a browser where you're logged in, save the page, upload it.
 * 2. CSV: Jira issue navigator → Export → "CSV (All fields)".
 */
export function importJiraFile(
  text: string,
  filename: string,
  cfg: AppConfig,
  opts: { inScope: boolean; syncedAt: string },
): { issue: Issue; links: Link[] }[] {
  const trimmed = text.trim();
  if (filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    const issues: RawJiraIssue[] = Array.isArray(data) ? data : (data.issues ?? []);
    return issues.map((r) => normalizeIssue(r, cfg, { ...opts, source: "import" }));
  }
  return csvToRaw(text, cfg).map((r) => normalizeIssue(r, cfg, { ...opts, source: "import" }));
}

/** Map a Jira "CSV (All fields)" export to the REST shape so one normaliser handles both. */
export function csvToRaw(text: string, cfg: AppConfig): RawJiraIssue[] {
  const recs = csvRecords(text);
  const pick = (s: Record<string, string>, ...names: string[]) => {
    for (const n of names) if (s[n]) return s[n];
    return "";
  };
  // "Custom field (Start Date)" — the display name, not the id. We match on the
  // id's configured CSV column name, plus common names.
  const startCols = [
    `Custom field (${cfg.csvColumns.startDate})`,
    cfg.csvColumns.startDate,
    "Custom field (Start Date)",
    "Custom field (Start date)",
    "Start Date",
    "Start date",
  ];
  const dueCols =
    cfg.fields.dueDate === "duedate"
      ? ["Due Date", "Due date"]
      : [`Custom field (${cfg.csvColumns.dueDate})`, cfg.csvColumns.dueDate, "Due Date", "Due date"];

  return recs
    .map(({ single: s, multi: m }) => {
      const key = pick(s, "Issue key", "Issue Key", "Key");
      if (!key) return null;
      const links: RawIssueLink[] = [];
      for (const [col, vals] of Object.entries(m)) {
        // "Outward issue link (Blocks)" / "Inward issue link (Blocks)"
        const lm = col.match(/^(Inward|Outward) issue link \((.+)\)$/i);
        if (!lm) continue;
        const typeName = lm[2];
        for (const v of vals) {
          for (const k of v.split(/[,\s]+/).filter(Boolean)) {
            const type = { name: typeName, ...guessVerbs(typeName) };
            if (lm[1].toLowerCase() === "outward") links.push({ type, outwardIssue: { key: k } });
            else links.push({ type, inwardIssue: { key: k } });
          }
        }
      }
      const status = pick(s, "Status");
      const fields: RawJiraIssue["fields"] = {
        issuetype: { name: pick(s, "Issue Type", "Issue type") },
        summary: pick(s, "Summary"),
        status: { name: status, statusCategory: { key: inferStatusCategory(status) } },
        assignee: pick(s, "Assignee") ? { displayName: pick(s, "Assignee") } : null,
        labels: m["Labels"] ?? [],
        components: (m["Component/s"] ?? m["Components"] ?? []).map((name) => ({ name })),
        issuelinks: links,
        description: pick(s, "Description") || null,
        updated: pick(s, "Updated") || undefined,
      };
      fields[cfg.fields.startDate] = pick(s, ...startCols) || null;
      fields[cfg.fields.dueDate || "duedate"] = pick(s, ...dueCols) || null;
      const epic = pick(s, "Custom field (Epic Link)", "Epic Link", "Parent", "Parent key");
      if (epic) fields[cfg.fields.epicLink] = epic;
      if (cfg.fields.tier) fields[cfg.fields.tier] = pick(s, "Custom field (Tier)", "Tier") || null;
      return { key, fields } satisfies RawJiraIssue;
    })
    .filter((x): x is RawJiraIssue => x !== null);
}

/** CSV exports only carry the link type name; derive verbs for the common types. */
function guessVerbs(typeName: string): { outward: string; inward: string } {
  const t = typeName.toLowerCase();
  if (t.includes("block")) return { outward: "blocks", inward: "is blocked by" };
  if (t.includes("depend")) return { outward: "depends on", inward: "is depended on by" };
  if (t.includes("milestone") || t.includes("contain"))
    return { outward: "contains", inward: "is contained by" };
  if (t.includes("clone")) return { outward: "clones", inward: "is cloned by" };
  if (t.includes("duplicate")) return { outward: "duplicates", inward: "is duplicated by" };
  return { outward: "relates to", inward: "relates to" };
}
