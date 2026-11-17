import { buildItemMatcher, noteSections, normText, type ItemMatcher } from "./noteMatch";
import { extractActionItems, findDates } from "./notes";
import type { IssueView } from "./store";
import type { EditableField } from "./types";

/** A proposed Jira change found in meeting notes. Nothing is staged until the user accepts it. */
export type JiraSuggestion = {
  key: string;
  field: Extract<EditableField, "dueDate" | "startDate" | "status" | "comment">;
  value: string;
  /** Current value in Jira (with any pending edits), for comparison in the UI. */
  current: string | null;
  /** The line(s) of the notes this came from. */
  evidence: string;
  reason: string;
  /** Ids recorded when this is staged or dismissed, so it isn't suggested again (even from another copy of the notes). */
  sigs: string[];
  /** For comments: the note lines quoted. */
  lines?: string[];
  /** Date of the meeting (section) the evidence came from, for running notes docs. */
  meetingDate?: string | null;
};

const DATE_VERBS =
  /\b(due|target(?:ing)?|eta|moved?|slip(?:s|ped)?|push(?:ed)?|pull(?:ed)? in|shift(?:ed)?|now|new date|lands?|landing|deliver(?:s|y|ed)?|complete by|finish(?:es)? by|launch(?:es)?|go[- ]live|by|re-?baselined?|re-?plan(?:ned)?)\b/i;
const START_WORDS = /\b(start(?:s|ing)?|kick(?:s|ing)? ?off|begin(?:s|ning)?)\b/i;
const NEGATION = /\b(not|isn't|isnt|won't|wont|no longer|never|still has no|no date)\b/i;
const DONE_WORDS = /\b(done|completed?|closed|shipped|delivered|finished|resolved|launched|live in prod)\b/i;
/** "shipped to QA", "delivered to UAT": a hand-off, not done. */
const NOT_YET_DONE = /\b(?:to|into|in) (?:qa|uat|test(?:ing)?|staging|stage|review|beta)\b/i;
/** "design review done", "testing complete": one step finished, not the whole item. */
const PART_DONE = /\b(review|design|spec|demo|planning|kick-?off|walkthrough|testing|discovery|estimate|estimation|grooming|refinement|sign-?off) (?:is |was )?(?:done|complete|completed|finished|closed)\b/i;
const PROGRESS_WORDS = /\b(in progress|started|kicked off|underway|picking up|picked up)\b/i;
const KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

export const lineSig = (key: string, line: string) => `c|${key}|${normText(line).trim()}`;
export const fieldSig = (key: string, field: string, value: string) => `f|${key}|${field}|${value}`;

/**
 * "Jan 25" written in a November meeting means next January. Dates without a
 * year are read in the meeting's year, so move ones that land well before the
 * meeting into the following year.
 */
export function rollForward(iso: string, ref: string | null) {
  if (!ref) return iso;
  const days = (Date.parse(ref) - Date.parse(iso)) / 86_400_000;
  return days > 120 ? `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}` : iso;
}

const fmtLong = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Read meeting notes for Jira changes. Each line is matched to the items it
 * talks about (by key or by name, see noteMatch.ts):
 *  - one item + a date + a schedule word ("Balances API v3 slipped to 12/20")
 *    → new due date (or start date if it says "start")
 *  - one item + "done/shipped" → Done; "started/in progress" → In Progress
 *  - every item discussed → one Jira comment quoting its lines, with a link to
 *    the full notes when they live in Google Docs or Confluence
 * In running notes docs the latest meeting wins: an older "moved to Dec 20"
 * is replaced by a newer "now Jan 10". Suggestions that match Jira already,
 * or that were staged or dismissed before (`handled`), are left out.
 */
export function suggestJiraUpdates(
  body: string,
  meta: { title: string; meetingDate: string | null; sourceUrl?: string | null },
  issues: Map<string, IssueView>,
  opts: {
    doneStatus?: string;
    inProgressStatus?: string;
    match?: ItemMatcher;
    /** Items the user said this note is not about. */
    exclude?: Set<string>;
    handled?: Set<string>;
  } = {},
): JiraSuggestion[] {
  const refYear = meta.meetingDate ? Number(meta.meetingDate.slice(0, 4)) : new Date().getFullYear();
  const match = opts.match ?? buildItemMatcher([...issues.values()]);
  const handled = opts.handled ?? new Set<string>();
  const fields = new Map<string, JiraSuggestion & { order: string }>();
  const comments = new Map<string, { lines: string[]; dates: (string | null)[] }>();
  const lastMention = new Map<string, string>();

  noteSections(body, refYear).forEach(({ line, date, heading }, idx) => {
    if (heading) return;
    const keys = match(line)
      .map((x) => x.key)
      .filter((k) => issues.has(k) && !opts.exclude?.has(k));
    if (!keys.length) return;
    // Later meetings beat earlier ones; within a meeting, later lines win.
    const order = `${date ?? "0000-00-00"}|${String(idx).padStart(6, "0")}`;
    for (const k of keys) if ((lastMention.get(k) ?? "") < (date ?? "")) lastMention.set(k, date ?? "");
    // An action item ("Jordan to draft options by Nov 21") is a task, not news about the item's dates or status.
    const isAction = extractActionItems(line).length > 0;
    const propose = (s: Omit<JiraSuggestion, "sigs" | "meetingDate">) => {
      const id = `${s.key}|${s.field}`;
      const prev = fields.get(id);
      if (prev && prev.order > order) return;
      fields.set(id, { ...s, sigs: [fieldSig(s.key, s.field, s.value)], meetingDate: date, order });
    };

    if (keys.length === 1 && !isAction) {
      const issue = issues.get(keys[0])!;
      const ref = date ?? meta.meetingDate;
      const dates = findDates(line.replace(KEY_RE, " "), refYear)
        .map((d) => rollForward(d, ref))
        .filter((d) => d !== meta.meetingDate && d !== date);
      if (dates.length === 1 && DATE_VERBS.test(line)) {
        const field = START_WORDS.test(line) ? "startDate" : "dueDate";
        propose({
          key: issue.key,
          field,
          value: dates[0],
          current: issue[field],
          evidence: line,
          reason: `Notes give a new ${field === "startDate" ? "start" : "target"} date`,
        });
      }
      if (!NEGATION.test(line)) {
        if (DONE_WORDS.test(line) && !NOT_YET_DONE.test(line) && !PART_DONE.test(line) && issue.statusCategory !== "done") {
          propose({ key: issue.key, field: "status", value: opts.doneStatus ?? "Done", current: issue.status, evidence: line, reason: "Notes say this is done" });
        } else if (PROGRESS_WORDS.test(line) && issue.statusCategory === "new") {
          propose({
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
      if (handled.has(lineSig(k, line))) continue;
      const c = comments.get(k) ?? { lines: [], dates: [] };
      if (!c.lines.includes(line)) {
        c.lines.push(line);
        c.dates.push(date);
      }
      comments.set(k, c);
    }
  });

  const out: JiraSuggestion[] = [];
  for (const s of fields.values()) {
    if ((s.current ?? "") === s.value || s.sigs.some((x) => handled.has(x))) continue;
    // In running notes, a newer meeting that discussed the item supersedes an older date or status.
    if ((s.meetingDate ?? "") < (lastMention.get(s.key) ?? "")) continue;
    const { order: _order, ...rest } = s;
    void _order;
    out.push(rest);
  }
  for (const [key, c] of comments) {
    const latest = c.dates.filter((d): d is string => !!d).sort().pop() ?? meta.meetingDate;
    const when = latest ? ` (${fmtLong(latest)})` : "";
    const value = [
      `Discussed in meeting notes "${meta.title}"${when}:`,
      ...c.lines.map((l) => `- ${l}`),
      ...(meta.sourceUrl ? [`Full notes: ${meta.sourceUrl}`] : []),
    ].join("\n");
    out.push({
      key,
      field: "comment",
      value,
      current: null,
      evidence: c.lines.join("\n"),
      reason: `${c.lines.length} line${c.lines.length === 1 ? "" : "s"} about this item`,
      sigs: c.lines.map((l) => lineSig(key, l)),
      lines: c.lines,
      meetingDate: latest,
    });
  }
  return out;
}
