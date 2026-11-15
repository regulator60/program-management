import { toIsoDate } from "./jira/classify";

export type ExtractedAction = {
  text: string;
  owner: string | null;
  dueDate: string | null;
  /** Set when the item sits under a heading that names a known team (sub-track or platform). */
  team?: string;
};

const MARKERS = [
  /^\s*(?:[-*•]\s*)?\[\s?\]\s+(.+)$/i, // - [ ] do thing
  /^\s*(?:[-*•]\s*)?(?:AI|A\/I|action(?: item)?|todo|to-do|follow[- ]?up|next step)\s*[:\-–]\s*(.+)$/i,
  /^\s*(?:[-*•]\s*)?(@[\w.\-]+\s+(?:to|will|owns?)\s+.+)$/i, // @sam to send deck
  /^\s*(?:[-*•]\s*)?([A-Z][a-z]+(?: [A-Z][a-z]+)?\s+(?:to|will)\s+(?:send|share|follow|schedule|update|review|confirm|draft|create|set up|setup|provide|check|investigate|reach out|sync|align|book|own)\b.+)$/,
];

/** Headings whose following lines are all action items (incl. Gemini "Suggested next steps"). */
const SECTION_HEADING =
  /^\s*(?:#+\s*)?(?:suggested\s+)?(?:action items?|actions|next steps|follow[- ]?ups?|to-?dos?|takeaways and actions)\s*:?\s*$/i;

/** A line that starts a new section: markdown heading, or a short title-like line ending in ":" */
function isHeading(line: string) {
  const t = line.trim();
  if (!t) return false;
  if (/^#+\s/.test(t)) return true;
  if (/^[-*•☐☑✓\d]/.test(t)) return false;
  return /^[A-Z][^.!?]{0,48}:$/.test(t) || /^[A-Z][A-Za-z &/]{0,40}$/.test(t);
}

/** Normalise checkbox glyphs from Google Docs / Word exports to markdown checkboxes. */
function normaliseLine(line: string) {
  return line
    .replace(/^(\s*(?:[-*•]\s*)?)(?:☐|□|▢)\s*/, "$1[ ] ")
    .replace(/^(\s*(?:[-*•]\s*)?)(?:☑|☒|✅|✓|✔)\s*/, "$1[x] ");
}

/**
 * Pull action items out of free-form meeting notes. Recognises:
 *   - [ ] checkbox lines (and ☐ glyphs from Google Docs)
 *   AI: / Action: / TODO: / Follow-up: prefixes
 *   "@owner to ..." and "Name to/will <verb> ..."
 *   every line under an "Action items" / "Next steps" / "Suggested next steps" heading
 * Owners: "@name", "(owner: name)", "Name to ...". Dues: "by 12/5", "due 2026-12-05", "by Nov 30".
 */
export function extractActionItems(
  body: string,
  refYear = new Date().getFullYear(),
  /** Team names (sub-tracks, platforms); a heading naming one scopes the items under it. */
  teams: string[] = [],
): ExtractedAction[] {
  const out: ExtractedAction[] = [];
  const seen = new Set<string>();
  const teamByName = new Map(teams.map((t) => [t.toLowerCase(), t]));
  let inSection = false;
  let team: string | undefined;
  for (const raw of body.split(/\r?\n/)) {
    const line = normaliseLine(raw);
    if (SECTION_HEADING.test(line)) {
      inSection = true;
      continue;
    }
    if (isHeading(line)) {
      if (inSection) inSection = false;
      const name = line.trim().replace(/^#+\s*/, "").replace(/:$/, "").trim().toLowerCase();
      team = teamByName.get(name);
      if (team) continue;
    }
    if (/^\s*(?:[-*•]\s*)?\[x\]/i.test(line)) continue; // already done
    let text: string | null = null;
    for (const re of MARKERS) {
      const m = line.match(re);
      if (m) {
        text = m[1].trim();
        break;
      }
    }
    if (!text && inSection && line.trim()) {
      text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    }
    if (!text) continue;
    const clean = cleanText(text);
    const k = normaliseActionText(clean);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ text: clean, owner: findOwner(clean), dueDate: findDue(clean, refYear), ...(team ? { team } : {}) });
  }
  return out;
}

/** Key used to avoid re-adding the same action item when a running notes doc is re-imported. */
export function normaliseActionText(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanText(t: string) {
  return t.replace(/\s+/g, " ").trim();
}

function findOwner(t: string): string | null {
  let m = t.match(/\((?:owner|own|assignee)\s*[:=]\s*([^)]+)\)/i);
  if (m) return m[1].trim();
  m = t.match(/@([\w.\-]+)/);
  if (m) return m[1];
  m = t.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:to|will)\s/);
  if (m) return m[1];
  m = t.match(/[-–]\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*$/);
  return m ? m[1] : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function findDue(t: string, refYear: number): string | null {
  let m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
  if (m) return m[1];
  m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : refYear;
    return toIsoDate(`${m[1]}/${m[2]}/${y}`);
  }
  m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon >= 0) {
      const y = m[3] ? Number(m[3]) : refYear;
      return `${y}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * Every date mentioned in a line, as ISO strings: 2026-12-05, 12/5(/26), Dec 5(, 2026).
 * Used for Jira suggestions, where the date isn't necessarily preceded by "by".
 */
export function findDates(t: string, refYear: number): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) out.push(m[1]);
  for (const m of t.matchAll(/(?<![\d/-])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : refYear;
    const iso = toIsoDate(`${m[1]}/${m[2]}/${y}`);
    if (iso && Number(m[1]) <= 12) out.push(iso);
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi)) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const y = m[3] ? Number(m[3]) : refYear;
    out.push(`${y}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return [...new Set(out)];
}

/** Generic HTML (Google Docs export, Confluence storage format) → plain text with list markers. */
export function htmlToText(html: string): string {
  return confluenceStorageToText(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ""));
}

/**
 * Convert Confluence "storage format" XHTML to plain text, turning
 * <ac:task> items into "- [ ] ..." lines so the extractor picks them up.
 */
export function confluenceStorageToText(html: string): string {
  let s = html;
  s = s.replace(/<ac:task>([\s\S]*?)<\/ac:task>/g, (_, inner: string) => {
    const done = /<ac:task-status>\s*complete\s*<\/ac:task-status>/.test(inner);
    const body = (inner.match(/<ac:task-body>([\s\S]*?)<\/ac:task-body>/)?.[1] ?? "")
      .replace(/<ri:user[^>]*ri:username="([^"]+)"[^>]*\/>/g, "@$1")
      .replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, " by $1");
    return `\n- [${done ? "x" : " "}] ${body}\n`;
  });
  s = s
    .replace(/<ri:user[^>]*ri:username="([^"]+)"[^>]*\/>/g, "@$1")
    .replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, "$1")
    .replace(/<\/(p|li|h[1-6]|tr|div)>/g, "\n")
    .replace(/<li[^>]*>/g, "- ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/t[dh]>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&[rl]squo;/g, "'")
    .replace(/&[rl]dquo;/g, '"')
    .replace(/&[mn]dash;/g, "-");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, a) => l || (a[i - 1] ?? "") !== "")
    .join("\n")
    .trim();
}
