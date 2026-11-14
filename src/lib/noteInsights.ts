import { findDates } from "./notes";
import type { IssueView } from "./store";
import type { EditableField } from "./types";

/** A proposed Jira change found in meeting notes. Nothing is staged until the user accepts it. */
export type JiraSuggestion = {
  key: string;
  field: Extract<EditableField, "dueDate" | "startDate" | "status" | "comment">;
  value: string;
  /** Current value in Jira (with any pending edits), for comparison in the UI. */
  current: string | null;
  /** The line of the notes this came from. */
  evidence: string;
  reason: string;
};

const KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const DATE_VERBS =
  /\b(due|target(?:ing)?|eta|moved?|slip(?:s|ped)?|push(?:ed)?|pull(?:ed)? in|shift(?:ed)?|now|new date|lands?|landing|deliver(?:s|y|ed)?|complete by|finish(?:es)? by|launch(?:es)?|go[- ]live|by|re-?baselined?|re-?plan(?:ned)?)\b/i;
const START_WORDS = /\b(start(?:s|ing)?|kick(?:s|ing)? ?off|begin(?:s|ning)?)\b/i;
const NEGATION = /\b(not|isn't|isnt|won't|wont|no longer|never)\b/i;
const DONE_WORDS = /\b(done|completed?|closed|shipped|delivered|finished|resolved|launched|live in prod)\b/i;
const PROGRESS_WORDS = /\b(in progress|started|kicked off|underway|picking up|picked up)\b/i;

/**
 * Read meeting notes for Jira context, line by line:
 *  - a line naming exactly one known issue plus a date and a schedule word
 *    ("BIGP-31 slipped to 12/20") → due date (or start date if it says "start")
 *  - a line naming exactly one issue with "done/complete/shipped" → status Done,
 *    "started/in progress" → In Progress (negations are ignored)
 *  - every line naming a known issue → a comment on that issue quoting the line,
 *    so the discussion is visible in Jira
 * Suggestions that match what Jira already has are dropped.
 */
export function suggestJiraUpdates(
  body: string,
  meta: { title: string; meetingDate: string | null },
  issues: Map<string, IssueView>,
  opts: { doneStatus?: string; inProgressStatus?: string } = {},
): JiraSuggestion[] {
  const refYear = meta.meetingDate ? Number(meta.meetingDate.slice(0, 4)) : new Date().getFullYear();
  const out: JiraSuggestion[] = [];
  const seen = new Set<string>();
  const add = (s: JiraSuggestion) => {
    const id = `${s.key}|${s.field}|${s.value}`;
    if (seen.has(id)) return;
    if (s.field !== "comment" && (s.current ?? "") === s.value) return;
    seen.add(id);
    out.push(s);
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, "").trim();
    if (!line) continue;
    const keys = [...new Set(line.match(KEY_RE) ?? [])].filter((k) => issues.has(k));
    if (!keys.length) continue;

    if (keys.length === 1) {
      const issue = issues.get(keys[0])!;
      // Dates: ignore dates that are just the meeting date or that sit inside another key.
      const dates = findDates(line.replace(KEY_RE, " "), refYear).filter((d) => d !== meta.meetingDate);
      if (dates.length === 1 && DATE_VERBS.test(line)) {
        const field = START_WORDS.test(line) ? "startDate" : "dueDate";
        add({
          key: issue.key,
          field,
          value: dates[0],
          current: issue[field],
          evidence: line,
          reason: `Notes mention a ${field === "startDate" ? "start" : "target"} date for ${issue.key}`,
        });
      }
      if (!NEGATION.test(line)) {
        if (DONE_WORDS.test(line) && issue.statusCategory !== "done") {
          add({
            key: issue.key,
            field: "status",
            value: opts.doneStatus ?? "Done",
            current: issue.status,
            evidence: line,
            reason: "Notes say this is done",
          });
        } else if (PROGRESS_WORDS.test(line) && issue.statusCategory === "new") {
          add({
            key: issue.key,
            field: "status",
            value: opts.inProgressStatus ?? "In Progress",
            current: issue.status,
            evidence: line,
            reason: "Notes say work has started",
          });
        }
      }
    }

    for (const k of keys) {
      add({
        key: k,
        field: "comment",
        value: `From meeting notes "${meta.title}"${meta.meetingDate ? ` (${meta.meetingDate})` : ""}: ${line}`,
        current: null,
        evidence: line,
        reason: "Discussed in the meeting",
      });
    }
  }
  return out;
}
