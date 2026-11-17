import { findDates } from "./notes";

/**
 * Work out which Jira items a line of meeting notes is about.
 *
 * People rarely write issue keys in notes; they write "Balances API v3 slipped"
 * or "token service is done". So besides explicit keys we match item names:
 * the summary (minus any "[Team]" prefix), the summary without trailing
 * filler words like "complete" or "ready", and, as a weaker match, the summary
 * without its first word ("Dashboard GA" for "Account dashboard GA"). A name
 * that could mean more than one item is ignored rather than guessed.
 */
export type MatchableIssue = { key: string; summary: string };
export type ItemMatch = { key: string; how: "key" | "name" };

const KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const FILLER = new Set(["complete", "completed", "ready", "done", "live", "launch", "launched", "build", "built", "integrated", "delivered", "finished", "started"]);
const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "v1", "v2", "v3", "new", "all", "api"]);

export const normText = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

function phrasesFor(summary: string): { strong: string[]; weak: string[] } {
  const name = summary.replace(/^\s*\[[^\]]+\]\s*/, "");
  const words = normText(name).trim().split(" ").filter(Boolean);
  const ok = (w: string[]) => w.length >= 2 && w.join(" ").length >= 8 && w.some((x) => !STOP.has(x) && !/^\d+$/.test(x));
  const strong = new Set<string>();
  if (ok(words)) strong.add(words.join(" "));
  const trimmed = [...words];
  while (trimmed.length > 2 && FILLER.has(trimmed[trimmed.length - 1])) trimmed.pop();
  if (ok(trimmed)) strong.add(trimmed.join(" "));
  const weak = new Set<string>();
  for (const w of [words, trimmed]) if (w.length >= 3 && ok(w.slice(1))) weak.add(w.slice(1).join(" "));
  return { strong: [...strong], weak: [...weak].filter((p) => !strong.has(p)) };
}

export function buildItemMatcher(issues: MatchableIssue[]) {
  const known = new Set(issues.map((i) => i.key));
  const strong = new Map<string, Set<string>>();
  const weak = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, p: string, k: string) => m.set(p, (m.get(p) ?? new Set()).add(k));
  for (const i of issues) {
    const p = phrasesFor(i.summary);
    p.strong.forEach((x) => put(strong, x, i.key));
    p.weak.forEach((x) => put(weak, x, i.key));
  }
  // Only unambiguous names.
  const table: { phrase: string; key: string; weak: boolean }[] = [];
  for (const [p, ks] of strong) if (ks.size === 1) table.push({ phrase: p, key: [...ks][0], weak: false });
  for (const [p, ks] of weak) if (ks.size === 1 && !strong.has(p)) table.push({ phrase: p, key: [...ks][0], weak: true });
  table.sort((a, b) => b.phrase.length - a.phrase.length);

  return function match(line: string): ItemMatch[] {
    const out = new Map<string, ItemMatch>();
    for (const k of line.match(KEY_RE) ?? []) if (known.has(k)) out.set(k, { key: k, how: "key" });
    let hay = normText(line.replace(KEY_RE, " "));
    for (const t of table) {
      const needle = ` ${t.phrase} `;
      if (!hay.includes(needle)) continue;
      if (!out.has(t.key)) out.set(t.key, { key: t.key, how: "name" });
      // Consume the text so a shorter name inside it doesn't also match.
      hay = hay.replace(needle, " ¦ ");
    }
    return [...out.values()];
  };
}

export type ItemMatcher = ReturnType<typeof buildItemMatcher>;

/** Strip bullets and checkboxes from a notes line. */
export const cleanLine = (raw: string) => raw.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, "").trim();

/**
 * Running notes docs hold many meetings, each under a dated heading
 * ("Nov 14, 2026", "2026-11-14 weekly sync"). Returns every non-empty line with
 * the date of the meeting it belongs to (null before the first dated heading).
 */
export function noteSections(body: string, refYear: number): { line: string; date: string | null; heading: boolean }[] {
  let current: string | null = null;
  const out: { line: string; date: string | null; heading: boolean }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const stripped = t.replace(/^#+\s*/, "");
    const bullet = /^\s*(?:[-*•☐☑]|\d+[.)]|\[[ x]\])/.test(t);
    const dates = findDates(stripped, refYear);
    if (!bullet && dates.length === 1 && stripped.split(/\s+/).length <= 9 && !/[.!?]$/.test(stripped)) {
      current = dates[0];
      out.push({ line: stripped, date: current, heading: true });
      continue;
    }
    out.push({ line: cleanLine(t), date: current, heading: false });
  }
  return out;
}

/** Dates of the meetings in a running notes doc, newest first. */
export function meetingDates(body: string, refYear: number) {
  return [...new Set(noteSections(body, refYear).filter((s) => s.heading && s.date).map((s) => s.date!))].sort().reverse();
}

/** Lines that carry content, normalised, for comparing two versions of the same notes. */
export function contentLines(body: string): Set<string> {
  return new Set(
    body
      .split(/\r?\n/)
      .map((l) => normText(cleanLine(l)).trim())
      .filter((l) => l.length >= 12),
  );
}
