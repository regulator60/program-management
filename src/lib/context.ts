import type { ActionItem, ItemUpdate, Note } from "./types";
import { PROGRESS_LABEL } from "./types";

/** What we know about an item from our own records: actions, meeting notes, updates. */
export type ItemContext = {
  /** Team action items linked to (or mentioning) the item. Open overdue first, then open by due date, then done. */
  actions: ActionItem[];
  /** Lines in meeting notes that mention the item, most recent meeting first. */
  mentions: { noteId: number; title: string; date: string; line: string }[];
  /** Status updates, newest first. */
  updates: ItemUpdate[];
};

export type ContextData = { actions: ActionItem[]; notes: Note[]; updates: ItemUpdate[] };

const mentionRe = (k: string) => new RegExp(`(^|[^A-Z0-9-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`);

/**
 * Gather context for one or more Jira keys (e.g. both sides of a dependency).
 * `extraUpdateKeys` adds updates stored under other ids (like "dep:A:B").
 */
export function itemContext(keys: string[], data: ContextData, today: string, extraUpdateKeys: string[] = []): ItemContext {
  const res = keys.map(mentionRe);
  const mentionsKey = (s: string) => res.some((r) => r.test(s));
  const actions = data.actions
    .filter((a) => a.kind === "team" && (a.links.some((l) => keys.includes(l)) || mentionsKey(a.text)))
    .sort((a, b) => {
      const rank = (x: ActionItem) =>
        x.status === "done" ? 3 : x.dueDate && x.dueDate < today ? 0 : x.dueDate ? 1 : 2;
      return rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.id - a.id;
    });
  const mentions: ItemContext["mentions"] = [];
  const keySet = new Set(keys);
  for (const n of data.notes) {
    const date = n.meetingDate ?? n.createdAt.slice(0, 10);
    const lines = new Set<string>();
    // Lines that name the item (found at import, by key or by name) …
    for (const r of n.refs ?? []) if (r.kind === "auto" && r.line && keySet.has(r.key)) lines.add(r.line);
    // … plus any line with the key, for notes imported before names were matched.
    for (const raw of n.body.split(/\r?\n/)) {
      const line = raw.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, "").trim();
      if (line && mentionsKey(line)) lines.add(line);
    }
    const excluded = (n.refs ?? []).some((r) => r.kind === "excluded" && keySet.has(r.key));
    if (excluded) continue;
    for (const line of lines) mentions.push({ noteId: n.id, title: n.title, date, line });
    if (!lines.size && (n.refs ?? []).some((r) => r.kind === "manual" && keySet.has(r.key))) {
      mentions.push({ noteId: n.id, title: n.title, date, line: "Linked to these meeting notes." });
    }
  }
  mentions.sort((a, b) => b.date.localeCompare(a.date));
  const updKeys = new Set([...keys, ...extraUpdateKeys]);
  const updates = data.updates.filter((u) => updKeys.has(u.key)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { actions, mentions, updates };
}

const fmt = (iso: string) =>
  new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const who = (s: string | null | undefined, fallback: string) => s || fallback;

export type SmartQuestion = { question: string; basis: string };

/**
 * Turn what we know into the question to ask in the call, grounded in the
 * most relevant record (an overdue action beats a blocked update beats an
 * open action beats a recent update beats a meeting-note mention). Returns
 * null when we have nothing to go on, so callers fall back to a generic ask.
 */
export function smartQuestion(ctx: ItemContext, today: string, owner?: string | null): SmartQuestion | null {
  const open = ctx.actions.filter((a) => a.status === "open");
  const overdue = open.find((a) => a.dueDate && a.dueDate < today);
  const last = ctx.updates[0];
  const lastNote = ctx.mentions[0];

  if (overdue) {
    return {
      question: `${who(overdue.owner, "Owner")}: "${clip(overdue.text)}" was due ${fmt(overdue.dueDate!)}. Is it done, and what did it turn up? If not, what's the new date?`,
      basis: `Overdue action item (due ${fmt(overdue.dueDate!)})`,
    };
  }
  if (last && (last.progress === "blocked" || last.progress === "stalled")) {
    return {
      question: `On ${fmt(last.createdAt)} this was ${PROGRESS_LABEL[last.progress].toLowerCase()}: "${clip(last.body)}". Is that still the case, and who can move it?`,
      basis: `Last update (${fmt(last.createdAt)}, ${PROGRESS_LABEL[last.progress]})`,
    };
  }
  const nextOpen = open[0];
  if (nextOpen) {
    return {
      question: `${who(nextOpen.owner, "Owner")}: how is "${clip(nextOpen.text)}" going${nextOpen.dueDate ? ` (due ${fmt(nextOpen.dueDate)})` : ""}? What's still needed?`,
      basis: `Open action item${nextOpen.dueDate ? ` due ${fmt(nextOpen.dueDate)}` : ""}`,
    };
  }
  const done = ctx.actions.find((a) => a.status === "done");
  if (done && (!last || last.progress !== "resolved")) {
    return {
      question: `"${clip(done.text)}" is done${done.owner ? ` (${done.owner})` : ""}. What did we learn, and what's the next step?`,
      basis: "Completed action item",
    };
  }
  if (last) {
    return {
      question: `Last update ${fmt(last.createdAt)}: "${clip(last.body)}". What's changed since${owner ? `, ${owner}` : ""}?`,
      basis: `Last update (${fmt(last.createdAt)})`,
    };
  }
  if (lastNote) {
    return {
      question: `In "${lastNote.title}" (${fmt(lastNote.date)}): "${clip(lastNote.line)}". What's happened since?`,
      basis: `Meeting notes, ${fmt(lastNote.date)}`,
    };
  }
  return null;
}

/**
 * One factual sentence on where things stand, from our records, for briefings.
 * Returns null when nothing is on record (callers say so explicitly).
 */
export function contextLine(ctx: ItemContext, today: string): string | null {
  const open = ctx.actions.filter((a) => a.status === "open");
  const overdue = open.find((a) => a.dueDate && a.dueDate < today);
  const last = ctx.updates[0];
  if (overdue) return `${who(overdue.owner, "The owner")}'s action "${clip(overdue.text, 70)}" was due ${fmt(overdue.dueDate!)} and is still open.`;
  if (last && (last.progress === "blocked" || last.progress === "stalled"))
    return `Marked ${PROGRESS_LABEL[last.progress].toLowerCase()} on ${fmt(last.createdAt)}: "${clip(last.body, 80)}"`;
  if (open[0]) return `${who(open[0].owner, "Someone")} is working on it: "${clip(open[0].text, 70)}"${open[0].dueDate ? ` (due ${fmt(open[0].dueDate)})` : ""}.`;
  if (last) return `Latest update (${fmt(last.createdAt)}): "${clip(last.body, 80)}"`;
  if (ctx.mentions[0]) return `Last discussed in "${ctx.mentions[0].title}" (${fmt(ctx.mentions[0].date)}): "${clip(ctx.mentions[0].line, 80)}"`;
  return null;
}
